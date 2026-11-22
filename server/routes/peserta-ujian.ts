// server/routes/peserta-ujian.ts — endpoint siswa setelah masuk: data ujian (ruang tunggu/pengerjaan), PDF buku,
// klaim tab aktif, aliran SSE, dan Kumpulkan. Simpan jawaban ada di server/routes/jawaban.ts.
// Dipanggil oleh: server/app.ts (dipasang di bawah /api).
// Memanggil: server/auth/penjaga.ts, server/waktu-ujian.ts, server/siaran.ts, server/sse.ts,
//            server/berkas-pdf.ts, shared/peserta.ts, database.
// Aturan keras #1: teks/judul soal dan rujukan PDF per soal HANYA dikirim saat ujian berlangsung/dijeda.
// Payload dirakit field demi field (daftar putih docs/DESAIN.md §8.1), tidak pernah "SELECT *".
import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import type { StatusUjian } from '../../shared/auth.ts';
import { KumpulkanSchema, TabSchema } from '../../shared/peserta.ts';
import type { JawabanPeserta, SoalPeserta, UjianPeserta } from '../../shared/peserta.ts';
import { sesiDari, wajibSesi } from '../auth/penjaga.ts';
import type { SesiAktif } from '../auth/sesi.ts';
import { kirimPdf } from '../berkas-pdf.ts';
import { GalatHttp, validasi } from '../http.ts';
import type { Konteks } from '../konteks.ts';
import { beritahuPantau } from '../pantau.ts';
import { kirimStatusPeserta, sambutKoneksi } from '../siaran.ts';
import type { PesertaWaktu, UjianWaktu } from '../waktu-ujian.ts';
import { bacaPesertaWaktu, bacaUjianWaktu, kumpulkanPeserta, waktuPeserta } from '../waktu-ujian.ts';
import { muatRujukan } from './ujian.ts';

export type KonteksPeserta = { sesi: SesiAktif; peserta: PesertaWaktu; ujian: UjianWaktu };

// Peserta & ujian dari sesi. Sesi peserta selalu menunjuk peserta yang ada (FK cascade), tapi tetap dicek.
export function pesertaDariSesi(k: Konteks, res: Response): KonteksPeserta {
  const sesi = sesiDari(res);
  const peserta = sesi.pesertaId === null ? undefined : bacaPesertaWaktu(k.db, sesi.pesertaId);
  const ujian = peserta ? bacaUjianWaktu(k.db, peserta.ujian_id) : undefined;
  if (!peserta || !ujian) throw new GalatHttp(401, 'belum_masuk');
  return { sesi, peserta, ujian };
}

// Aturan satu tab aktif (docs/DESAIN.md §5): kiriman wajib membawa X-Tab-Id = sesi.tab_aktif.
export function wajibTabAktif(k: Konteks, sesi: SesiAktif, tabId: string | undefined): void {
  const aktif = k.db.prepare('SELECT tab_aktif FROM sesi WHERE id_hash = ?').pluck().get(sesi.idHash) as string | null;
  if (!tabId || aktif === null || tabId !== aktif) throw new GalatHttp(409, 'tab_tidak_aktif');
}

// Kiriman simpan/kumpul sebelum ujian dimulai: klien normal tidak pernah mengirimnya, jadi dicatat untuk
// guru (hanya dasbor guru), paling banyak 1 event per peserta per menit agar log tidak dibanjiri.
export function tolakSebelumMulai(k: Konteks, kp: KonteksPeserta): never {
  const t = k.jam();
  const baru = k.db
    .prepare("SELECT 1 FROM event_integritas WHERE peserta_id = ? AND jenis = 'akses_sebelum_mulai' AND mulai_at > ?")
    .get(kp.peserta.id, t - 60_000);
  if (!baru) {
    k.db
      .prepare("INSERT INTO event_integritas (ujian_id, peserta_id, jenis, mulai_at) VALUES (?, ?, 'akses_sebelum_mulai', ?)")
      .run(kp.ujian.id, kp.peserta.id, t);
    beritahuPantau(k, kp.ujian.id);
  }
  throw new GalatHttp(409, 'belum_mulai');
}

const SOAL_TERLIHAT: readonly StatusUjian[] = ['berlangsung', 'dijeda'];
const JAWABAN_TERLIHAT: readonly StatusUjian[] = ['berlangsung', 'dijeda', 'selesai'];
const PDF_TERLIHAT: readonly StatusUjian[] = ['menunggu', 'berlangsung', 'dijeda'];

const ParamPdfPeserta = z.object({ pdfId: z.coerce.number().int().positive() });
const QueryStream = z.object({ tab: z.uuid() });

export function pesertaUjianRouter(k: Konteks): Router {
  const router = Router();
  // Endpoint masuk/daftar nama di peserta-auth.ts sudah menjawab lebih dulu; sisanya wajib sesi peserta.
  router.use('/peserta', wajibSesi(k.db, k.jam, 'peserta'));

  router.get('/peserta/ujian', (_req, res) => {
    const { peserta, ujian } = pesertaDariSesi(k, res);
    // Ujian yang ditutup kembali (draf): tidak ada isi ujian apa pun; layar siswa memakai /peserta/saya.
    if (ujian.status === 'draf') throw new GalatHttp(409, 'status_tidak_sesuai');
    const info = k.db
      .prepare('SELECT judul, petunjuk FROM ujian WHERE id = ?')
      .get(ujian.id) as { judul: string; petunjuk: string };
    const nama = k.db.prepare('SELECT nama FROM peserta WHERE id = ?').pluck().get(peserta.id) as string;
    const pdf = k.db
      .prepare('SELECT id, nama_tampil FROM pdf WHERE ujian_id = ? ORDER BY id')
      .all(ujian.id) as UjianPeserta['pdf'];
    const jumlahSoal = k.db.prepare('SELECT COUNT(*) FROM soal WHERE ujian_id = ?').pluck().get(ujian.id) as number;
    const body: UjianPeserta = {
      id: ujian.id,
      status: ujian.status,
      waktu: waktuPeserta(ujian, peserta, k.jam()),
      judul: info.judul,
      petunjuk: info.petunjuk,
      durasi_menit: ujian.durasi_menit,
      jumlah_soal: jumlahSoal,
      pdf,
      saya: { id: peserta.id, nama, status: peserta.status, cara_kumpul: peserta.cara_kumpul },
    };
    if (SOAL_TERLIHAT.includes(ujian.status)) {
      // Kolom dipilih satu per satu: rubrik_json & jawaban_acuan tidak pernah ikut terbaca.
      const rujukan = muatRujukan(k, ujian.id);
      body.soal = (
        k.db
          .prepare('SELECT id, urutan, judul, teks, bobot FROM soal WHERE ujian_id = ? ORDER BY urutan, id')
          .all(ujian.id) as Omit<SoalPeserta, 'rujukan'>[]
      ).map((s) => ({ ...s, rujukan: rujukan.get(s.id) ?? [] }));
    }
    if (JAWABAN_TERLIHAT.includes(ujian.status)) {
      const baris = k.db
        .prepare('SELECT soal_id, isi, versi, ditandai FROM jawaban WHERE peserta_id = ? ORDER BY soal_id')
        .all(peserta.id) as (Omit<JawabanPeserta, 'ditandai'> & { ditandai: number })[];
      body.jawaban = baris.map((j) => ({ soal_id: j.soal_id, isi: j.isi, versi: j.versi, ditandai: j.ditandai === 1 }));
    }
    res.json(body);
  });

  // PDF buku boleh dibaca sejak ruang tunggu (keputusan pemilik), hanya PDF milik ujian peserta ini.
  router.get('/peserta/pdf/:pdfId', (req, res, next) => {
    const { pdfId } = validasi(ParamPdfPeserta, req.params);
    const { ujian } = pesertaDariSesi(k, res);
    if (!PDF_TERLIHAT.includes(ujian.status)) throw new GalatHttp(409, 'status_tidak_sesuai');
    const namaBerkas = k.db
      .prepare('SELECT nama_berkas FROM pdf WHERE id = ? AND ujian_id = ?')
      .pluck()
      .get(pdfId, ujian.id) as string | undefined;
    if (!namaBerkas) throw new GalatHttp(404, 'tidak_ditemukan');
    kirimPdf(k.uploadDir, namaBerkas, res, next);
  });

  // Tab baru mengklaim diri sebagai tab aktif SEBELUM membuka SSE; aliran tab lain milik peserta ini
  // menerima `tab_lain_aktif` lalu ditutup (docs/DESAIN.md §5). Tidak membawa isi ujian, jadi boleh di
  // semua fase (termasuk draf, agar layar "ditutup kembali" tetap tersambung).
  router.post('/peserta/tab', (req, res) => {
    const { tab_id } = validasi(TabSchema, req.body);
    const { sesi, peserta } = pesertaDariSesi(k, res);
    k.db.prepare('UPDATE sesi SET tab_aktif = ? WHERE id_hash = ?').run(tab_id, sesi.idHash);
    k.sse.tutupPeserta((kon) => kon.pesertaId === peserta.id && kon.tabId !== tab_id, 'tab_lain_aktif', {});
    res.status(204).end();
  });

  router.get('/peserta/stream', (req, res) => {
    const { tab } = validasi(QueryStream, req.query);
    const { sesi, peserta, ujian } = pesertaDariSesi(k, res);
    k.sse.bukaAliran(req, res);
    const aktif = k.db.prepare('SELECT tab_aktif FROM sesi WHERE id_hash = ?').pluck().get(sesi.idHash) as string | null;
    if (aktif !== tab) {
      // Tab lama yang tersambung ulang: diberi tahu lalu ditutup (tidak menyambung ulang otomatis).
      k.sse.kirim(res, 'tab_lain_aktif', {});
      res.end();
      return;
    }
    const kon = { res, pesertaId: peserta.id, ujianId: ujian.id, sesiHash: sesi.idHash, tabId: tab };
    k.sse.daftarPeserta(req, kon);
    // Koneksi baru langsung menerima keadaan terkini, supaya event yang terlewat saat offline tidak
    // membuat tampilan basi (docs/DESAIN.md §8.1).
    sambutKoneksi(k, kon);
    // Kolom "tersambung" di dasbor guru.
    beritahuPantau(k, ujian.id);
    req.on('close', () => beritahuPantau(k, ujian.id));
  });

  // Kumpulkan (docs/DESAIN.md §5): hanya bila versi semua jawaban di klien = versi di server, jadi tidak ada
  // ketikan yang tertinggal di laptop. Mengumpulkan dua kali dijawab 204 (klik ganda tidak menjadi galat).
  router.post('/peserta/kumpulkan', (req, res) => {
    const input = validasi(KumpulkanSchema, req.body);
    const kp = pesertaDariSesi(k, res);
    const { peserta, ujian, sesi } = kp;
    if (ujian.status === 'draf' || ujian.status === 'menunggu') tolakSebelumMulai(k, kp);
    if (ujian.status === 'dijeda') throw new GalatHttp(409, 'dijeda');
    if (ujian.status !== 'berlangsung') throw new GalatHttp(409, 'status_tidak_sesuai');
    wajibTabAktif(k, sesi, req.get('x-tab-id'));
    if (peserta.status === 'dikumpulkan') {
      res.status(204).end();
      return;
    }
    if (peserta.status !== 'mengerjakan') throw new GalatHttp(409, 'status_tidak_sesuai');
    const berubah = k.db.transaction(() => {
      const versiServer = k.db
        .prepare(
          `SELECT s.id AS soal_id, COALESCE(j.versi, 0) AS versi FROM soal s
           LEFT JOIN jawaban j ON j.soal_id = s.id AND j.peserta_id = ?
           WHERE s.ujian_id = ?`,
        )
        .all(peserta.id, ujian.id) as { soal_id: number; versi: number }[];
      for (const { soal_id, versi } of versiServer) {
        if ((input.versi[String(soal_id)] ?? 0) !== versi) throw new GalatHttp(409, 'belum_tersimpan');
      }
      return kumpulkanPeserta(k.db, peserta.id, 'manual', k.jam());
    })();
    if (berubah) kirimStatusPeserta(k, peserta.id);
    res.status(204).end();
  });

  return router;
}
