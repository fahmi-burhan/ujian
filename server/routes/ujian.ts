// server/routes/ujian.ts — ujian milik guru: daftar, buat, detail, ubah, tampilan, hapus, serta transisi
// "Buka ujian" (draf → menunggu) dan "Kembali ke draf" (menunggu → draf).
// Dipanggil oleh: server/app.ts (dipasang di bawah /api; sesi guru dicek di app.ts untuk /api/ujian).
// Memanggil: shared/ujian.ts (skema & cek kelengkapan), server/routes/milik.ts, server/berkas-pdf.ts, database.
// Kontrak: docs/DESAIN.md §3 (transisi) dan §8 (endpoint). Transisi lain (mulai, jeda, akhiri, …) dibuat
// di Fase 4–6.
import { Router } from 'express';
import type { Response } from 'express';
import { PANJANG_KODE_UJIAN } from '../../shared/alfabet.ts';
import type { StatusUjian } from '../../shared/auth.ts';
import {
  masalahUjian,
  RUBRIK_KOSONG,
  RubrikSchema,
  TampilanSchema,
  UjianBaruSchema,
  UjianUbahSchema,
} from '../../shared/ujian.ts';
import type { PdfInfo, SoalGuru, UjianDetail, UjianRingkas } from '../../shared/ujian.ts';
import { kodeAcak } from '../acak.ts';
import { sesiDari } from '../auth/penjaga.ts';
import { hapusBerkas } from '../berkas-pdf.ts';
import { GalatHttp, validasi } from '../http.ts';
import type { Konteks } from '../konteks.ts';
import { catatAksiGuru, ParamUjian, ujianMilik, ujianMilikDiStatus } from './milik.ts';

type BarisSoal = Omit<SoalGuru, 'rubrik'> & { rubrik_json: string };

// Rubrik di DB selalu ditulis setelah lolos Zod; bila tetap rusak (mis. diedit manual), ditampilkan
// kosong agar guru bisa memperbaikinya, bukan membuat halaman error.
function bacaRubrik(json: string): SoalGuru['rubrik'] {
  try {
    const hasil = RubrikSchema.safeParse(JSON.parse(json));
    return hasil.success ? hasil.data : RUBRIK_KOSONG;
  } catch {
    return RUBRIK_KOSONG;
  }
}

export function muatSoalGuru(k: Konteks, ujianId: number): SoalGuru[] {
  const baris = k.db
    .prepare(
      `SELECT id, urutan, judul, teks, bobot, rubrik_json, jawaban_acuan, pdf_id, pdf_halaman
       FROM soal WHERE ujian_id = ? ORDER BY urutan, id`,
    )
    .all(ujianId) as BarisSoal[];
  return baris.map(({ rubrik_json, ...s }) => ({ ...s, rubrik: bacaRubrik(rubrik_json) }));
}

export function muatUjianDetail(k: Konteks, ujianId: number): UjianDetail {
  const ujian = k.db
    .prepare('SELECT id, judul, petunjuk, kode, durasi_menit, status, mode_tampil, dibuka_at FROM ujian WHERE id = ?')
    .get(ujianId) as Omit<UjianDetail, 'soal' | 'pdf' | 'jumlah_peserta'> | undefined;
  if (!ujian) throw new GalatHttp(404, 'tidak_ditemukan');
  const pdf = k.db
    .prepare('SELECT id, nama_tampil, ukuran_byte, diunggah_at FROM pdf WHERE ujian_id = ? ORDER BY id')
    .all(ujianId) as PdfInfo[];
  const jumlahPeserta = k.db.prepare('SELECT COUNT(*) FROM peserta WHERE ujian_id = ?').pluck().get(ujianId) as number;
  return {
    id: ujian.id,
    judul: ujian.judul,
    petunjuk: ujian.petunjuk,
    kode: ujian.kode,
    durasi_menit: ujian.durasi_menit,
    status: ujian.status,
    mode_tampil: ujian.mode_tampil,
    dibuka_at: ujian.dibuka_at,
    soal: muatSoalGuru(k, ujianId),
    pdf,
    jumlah_peserta: jumlahPeserta,
  };
}

export function ujianRouter(k: Konteks): Router {
  const router = Router();

  router.get('/ujian', (_req, res) => {
    const daftar = k.db
      .prepare(
        `SELECT u.id, u.judul, u.kode, u.status, u.durasi_menit, u.diubah_at,
           (SELECT COUNT(*) FROM soal s WHERE s.ujian_id = u.id) AS jumlah_soal,
           (SELECT COUNT(*) FROM peserta p WHERE p.ujian_id = u.id) AS jumlah_peserta
         FROM ujian u WHERE u.penguji_id = ? ORDER BY u.diubah_at DESC, u.id DESC`,
      )
      .all(sesiDari(res).pengujiId) as UjianRingkas[];
    res.json(daftar);
  });

  router.post('/ujian', (req, res) => {
    const input = validasi(UjianBaruSchema, req.body);
    const sekarang = k.jam();
    const sisip = k.db.prepare(
      `INSERT INTO ujian (penguji_id, judul, kode, durasi_menit, dibuat_at, diubah_at)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (kode) DO NOTHING RETURNING id`,
    );
    // Kode ujian acak & unik. Bentrok sangat jarang (887 juta kemungkinan); dicoba ulang beberapa kali.
    let id: number | undefined;
    for (let coba = 0; coba < 10 && id === undefined; coba++) {
      id = sisip
        .pluck()
        .get(sesiDari(res).pengujiId, input.judul, kodeAcak(PANJANG_KODE_UJIAN), input.durasi_menit, sekarang, sekarang) as
        | number
        | undefined;
    }
    if (id === undefined) throw new Error('Gagal membuat kode ujian unik setelah 10 kali mencoba');
    res.status(201).json(muatUjianDetail(k, id));
  });

  router.get('/ujian/:id', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilik(k, res, id);
    res.json(muatUjianDetail(k, id));
  });

  router.patch('/ujian/:id', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilikDiStatus(k, res, id, ['draf']);
    const input = validasi(UjianUbahSchema, req.body);
    const ujian = muatUjianDetail(k, id);
    k.db
      .prepare('UPDATE ujian SET judul = ?, petunjuk = ?, durasi_menit = ?, diubah_at = ? WHERE id = ?')
      .run(
        input.judul ?? ujian.judul,
        input.petunjuk ?? ujian.petunjuk,
        input.durasi_menit ?? ujian.durasi_menit,
        k.jam(),
        id,
      );
    res.json(muatUjianDetail(k, id));
  });

  // Mode tampil nama di proyektor boleh diganti kapan saja (mis. di tengah ujian).
  router.patch('/ujian/:id/tampilan', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilik(k, res, id);
    const { mode_tampil } = validasi(TampilanSchema, req.body);
    k.db.transaction(() => {
      k.db.prepare('UPDATE ujian SET mode_tampil = ?, diubah_at = ? WHERE id = ?').run(mode_tampil, k.jam(), id);
      catatAksiGuru(k, res, id, 'ubah_tampilan', { mode_tampil });
    })();
    res.json(muatUjianDetail(k, id));
  });

  // Hanya saat draf. Semua data ujian ikut terhapus (FK ON DELETE CASCADE), lalu berkas PDF-nya di disk.
  router.delete('/ujian/:id', async (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilikDiStatus(k, res, id, ['draf']);
    const berkas = k.db.transaction(() => {
      const nama = k.db.prepare('SELECT nama_berkas FROM pdf WHERE ujian_id = ?').pluck().all(id) as string[];
      // Soal dihapus lebih dulu: FK soal → pdf tidak ber-CASCADE (menghapus PDF yang dirujuk ditolak).
      k.db.prepare('DELETE FROM soal WHERE ujian_id = ?').run(id);
      k.db.prepare("DELETE FROM ujian WHERE id = ? AND status = 'draf'").run(id);
      return nama;
    })();
    for (const nama of berkas) await hapusBerkas(k.uploadDir, nama);
    res.status(204).end();
  });

  // Transisi dijalankan dengan "WHERE status = <asal>" di dalam transaksi, jadi dua klik bersamaan
  // tidak berefek ganda (docs/DESAIN.md §3); yang kalah mendapat 409 transisi_tidak_sah.
  function transisi(res: Response, id: number, asal: StatusUjian, sql: string, param: unknown[], aksi: string): void {
    const berubah = k.db.prepare(`${sql} WHERE id = ? AND status = ?`).run(...param, id, asal).changes;
    if (berubah === 0) throw new GalatHttp(409, 'transisi_tidak_sah');
    catatAksiGuru(k, res, id, aksi);
  }

  // draf → menunggu. Syarat kelengkapan sama persis dengan daftar periksa di halaman guru.
  router.post('/ujian/:id/buka', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    const ujian = ujianMilik(k, res, id);
    if (ujian.status !== 'draf') throw new GalatHttp(409, 'transisi_tidak_sah');
    k.db.transaction(() => {
      const masalah = masalahUjian(muatUjianDetail(k, id));
      if (masalah.length > 0) throw new GalatHttp(409, 'belum_lengkap', { masalah });
      const sekarang = k.jam();
      transisi(res, id, 'draf', "UPDATE ujian SET status = 'menunggu', dibuka_at = ?, diubah_at = ?", [sekarang, sekarang], 'buka');
    })();
    res.json(muatUjianDetail(k, id));
  });

  // menunggu → draf (belum dimulai). Sesi peserta TIDAK dicabut: ruang tunggu mereka menampilkan
  // "Ujian ditutup kembali" (docs/DESAIN.md §3) dan otomatis lanjut bila guru membukanya lagi.
  // Endpoint peserta yang membawa isi ujian menolak fase draf.
  router.post('/ujian/:id/kembali-draf', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilik(k, res, id);
    k.db.transaction(() => {
      transisi(res, id, 'menunggu', "UPDATE ujian SET status = 'draf', dibuka_at = NULL, diubah_at = ?", [k.jam()], 'kembali_draf');
    })();
    res.json(muatUjianDetail(k, id));
  });

  return router;
}
