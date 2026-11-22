// server/routes/penilaian.ts — penilaian MANUAL oleh guru (Fase 6, sebelum AI): keputusan jawaban terlambat, mulai
// penilaian, beri/ubah skor per kriteria + catatan, setujui (satu atau semua per soal), rilis & tarik rilis,
// dan unduh nilai (Excel/CSV). Data halaman juga memuat saran AI terbaru (server/routes/penilaian-ai.ts mengatur antreannya).
// Dipanggil oleh: server/app.ts (dipasang di bawah /api; sesi guru dicek di app.ts untuk /api/ujian).
// Memanggil: shared/nilai.ts (rumus & validasi), server/routes/ujian.ts (muatSoalGuru), server/routes/milik.ts,
//            server/siaran.ts, database.
// Aturan (docs/DESAIN.md §3, §9, §12):
// - selesai → penilaian: tidak boleh ada jawaban terlambat yang belum diputuskan. Jawaban kosong siswa yang hadir
//   langsung diberi 0 (disetujui). Siswa yang tidak hadir (tidak pernah mengumpulkan) tidak dinilai.
// - Skor wajib lengkap & sah untuk rubrik (setiap kriteria, salah satu level). Angka nilai dihitung, tidak disimpan.
// - penilaian → dirilis: semua jawaban siswa yang hadir sudah disetujui (aturan keras #8).
// - Unduhan CSV: UTF-8 BOM, pemisah ';', sel berbahaya diberi awalan ' (aturan keras #10).
//   Unduhan utama .xlsx (server/xlsx.ts): angka tersimpan sebagai angka, nomor "01" tetap teks, dan teks tidak
//   pernah menjadi rumus. CSV tetap ada sebagai alternatif; di CSV, Excel membaca "01" sebagai 1.
// - Mulai penilaian baru boleh setelah toleransi 10 dtk sesudah Akhiri lewat (simpanan terakhir masih diterima).
import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { HasilAiSchema } from '../../shared/ai.ts';
import type { SaranAi } from '../../shared/ai.ts';
import { angka, KeputusanTerlambatSchema, masalahSkor, nilaiSoal, nilaiUjian, persenSoal, selCsv, SimpanNilaiSchema, skorNol } from '../../shared/nilai.ts';
import { TOLERANSI_MS } from '../../shared/peserta.ts';
import type { NilaiJawaban, PenilaianGuru, Skor } from '../../shared/nilai.ts';
import type { SoalGuru } from '../../shared/ujian.ts';
import { GalatHttp, validasi } from '../http.ts';
import type { Konteks } from '../konteks.ts';
import { beritahuPantau } from '../pantau.ts';
import { kirimStatusPeserta, siarkanStatus } from '../siaran.ts';
import { catatAksiGuru, ParamPeserta, ParamUjian, ujianMilik, ujianMilikDiStatus } from './milik.ts';
import { buatXlsx } from '../xlsx.ts';
import { muatSoalGuru } from './ujian.ts';

const ParamNilai = ParamPeserta.extend({ soalId: z.coerce.number().int().positive() });
const ParamSoalNilai = ParamUjian.extend({ soalId: z.coerce.number().int().positive() });
const ParamTerlambat = ParamUjian.extend({ tid: z.coerce.number().int().positive() });

type BarisPeserta = { id: number; nama: string; nomor: string; status: string };
type BarisNilai = { peserta_id: number; soal_id: number; skor_json: string; catatan: string; sumber: NilaiJawaban['sumber']; status: NilaiJawaban['status'] };

function bacaSkor(json: string): Skor {
  try {
    const nilai: unknown = JSON.parse(json);
    if (!nilai || typeof nilai !== 'object' || Array.isArray(nilai)) return {};
    return Object.fromEntries(Object.entries(nilai).filter((e): e is [string, number] => typeof e[1] === 'number'));
  } catch {
    return {};
  }
}

// Hadir = sudah mengumpulkan (setelah Akhiri, semua yang pernah mengerjakan berstatus dikumpulkan).
export function pesertaUjian(k: Konteks, ujianId: number): { hadir: BarisPeserta[]; tidakHadir: BarisPeserta[] } {
  const semua = k.db
    .prepare('SELECT id, nama, nomor, status FROM peserta WHERE ujian_id = ? ORDER BY nama COLLATE NOCASE, nomor, id')
    .all(ujianId) as BarisPeserta[];
  return { hadir: semua.filter((p) => p.status === 'dikumpulkan'), tidakHadir: semua.filter((p) => p.status !== 'dikumpulkan') };
}

export function bacaNilai(k: Konteks, ujianId: number): NilaiJawaban[] {
  const baris = k.db
    .prepare('SELECT peserta_id, soal_id, skor_json, catatan, sumber, status FROM penilaian WHERE ujian_id = ?')
    .all(ujianId) as BarisNilai[];
  return baris.map((b) => ({ peserta_id: b.peserta_id, soal_id: b.soal_id, skor: bacaSkor(b.skor_json), catatan: b.catatan, sumber: b.sumber, status: b.status }));
}

function muatPenilaian(k: Konteks, ujianId: number): PenilaianGuru {
  const u = k.db.prepare('SELECT id, judul, status FROM ujian WHERE id = ?').get(ujianId) as PenilaianGuru['ujian'];
  const { hadir, tidakHadir } = pesertaUjian(k, ujianId);
  const ringkas = (p: BarisPeserta) => ({ id: p.id, nama: p.nama, nomor: p.nomor });
  return {
    ujian: { id: u.id, judul: u.judul, status: u.status },
    soal: muatSoalGuru(k, ujianId),
    peserta: hadir.map(ringkas),
    tidak_hadir: tidakHadir.map(ringkas),
    jawaban: k.db
      .prepare('SELECT peserta_id, soal_id, isi FROM jawaban WHERE ujian_id = ? ORDER BY peserta_id, soal_id')
      .all(ujianId) as PenilaianGuru['jawaban'],
    nilai: bacaNilai(k, ujianId),
    terlambat: k.db
      .prepare(
        `SELECT id, peserta_id, soal_id, isi, diterima_at, alasan FROM jawaban_terlambat
         WHERE ujian_id = ? AND keputusan = 'menunggu' ORDER BY diterima_at, id`,
      )
      .all(ujianId) as PenilaianGuru['terlambat'],
    saran_ai: bacaSaranAi(k, ujianId),
  };
}

// Hasil AI terbaru (berhasil atau "perlu dinilai manual") untuk setiap jawaban. Tetap tampil setelah guru mengubah
// nilainya, supaya guru bisa membandingkan.
function bacaSaranAi(k: Konteks, ujianId: number): SaranAi[] {
  const baris = k.db
    .prepare(
      `SELECT t.peserta_id, t.soal_id, t.status, t.hasil_json, t.galat, r.model
       FROM ai_tugas t JOIN ai_run r ON r.id = t.run_id
       WHERE t.ujian_id = ? AND t.status IN ('selesai', 'perlu_manual')
         AND t.id = (SELECT MAX(t2.id) FROM ai_tugas t2
                     WHERE t2.peserta_id = t.peserta_id AND t2.soal_id = t.soal_id AND t2.status IN ('selesai', 'perlu_manual'))`,
    )
    .all(ujianId) as { peserta_id: number; soal_id: number; status: 'selesai' | 'perlu_manual'; hasil_json: string | null; galat: string | null; model: string }[];
  return baris.map((b) => {
    let hasil: SaranAi['hasil'] = null;
    if (b.hasil_json !== null) {
      const p = HasilAiSchema.safeParse(JSON.parse(b.hasil_json));
      hasil = p.success ? p.data : null;
    }
    return { peserta_id: b.peserta_id, soal_id: b.soal_id, model: b.model, status: b.status, hasil, galat: b.galat };
  });
}

// Daftar hal yang menghalangi rilis (kosong = boleh dirilis).
function masalahRilis(k: Konteks, ujianId: number): string[] {
  const soal = muatSoalGuru(k, ujianId);
  const { hadir } = pesertaUjian(k, ujianId);
  const rubrik = new Map(soal.map((s) => [s.id, s.rubrik]));
  // Disetujui DAN skornya sah untuk rubrik (pengaman untuk draf AI kelak): nilai tebakan tidak pernah dirilis.
  const disetujui = new Set(
    bacaNilai(k, ujianId)
      .filter((n) => {
        const r = rubrik.get(n.soal_id);
        return n.status === 'disetujui' && r !== undefined && nilaiSoal(r, n.skor) !== null;
      })
      .map((n) => `${n.peserta_id}:${n.soal_id}`),
  );
  const masalah: string[] = [];
  for (const s of soal) {
    const kurang = hadir.filter((p) => !disetujui.has(`${p.id}:${s.id}`)).length;
    if (kurang > 0) masalah.push(`Soal ${s.urutan} "${s.judul}": ${kurang} jawaban belum dinilai/disetujui`);
  }
  return masalah;
}

export function penilaianRouter(k: Konteks): Router {
  const router = Router();

  router.get('/ujian/:id/penilaian', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilikDiStatus(k, res, id, ['selesai', 'penilaian', 'dirilis']);
    res.set('Cache-Control', 'private, no-store');
    res.json(muatPenilaian(k, id));
  });

  // Keputusan atas kiriman yang tiba setelah batas waktu (DESAIN §4). Diterima = menjadi versi baru jawaban
  // (riwayat alasan 'terlambat'). Hanya sebelum penilaian dimulai, supaya jawaban yang dinilai tidak berubah.
  router.patch('/ujian/:id/terlambat/:tid', (req, res) => {
    const { id, tid } = validasi(ParamTerlambat, req.params);
    ujianMilikDiStatus(k, res, id, ['berlangsung', 'dijeda', 'selesai']);
    const { keputusan } = validasi(KeputusanTerlambatSchema, req.body);
    const t = k.jam();
    const pesertaId = k.db.transaction(() => {
      const kiriman = k.db
        .prepare(
          `SELECT peserta_id, soal_id, isi, id_simpan FROM jawaban_terlambat
           WHERE id = ? AND ujian_id = ? AND keputusan = 'menunggu'`,
        )
        .get(tid, id) as { peserta_id: number; soal_id: number; isi: string; id_simpan: string } | undefined;
      if (!kiriman) throw new GalatHttp(404, 'tidak_ditemukan');
      k.db.prepare('UPDATE jawaban_terlambat SET keputusan = ?, diputuskan_at = ? WHERE id = ?').run(keputusan, t, tid);
      if (keputusan === 'diterima') {
        const versi = k.db
          .prepare(
            `INSERT INTO jawaban (ujian_id, peserta_id, soal_id, isi, versi, id_simpan_terakhir, diubah_at)
             VALUES (?, ?, ?, ?, 1, ?, ?)
             ON CONFLICT (peserta_id, soal_id) DO UPDATE SET isi = excluded.isi, versi = jawaban.versi + 1,
               id_simpan_terakhir = excluded.id_simpan_terakhir, diubah_at = excluded.diubah_at
             RETURNING versi`,
          )
          .pluck()
          .get(id, kiriman.peserta_id, kiriman.soal_id, kiriman.isi, kiriman.id_simpan, t) as number;
        k.db
          .prepare(
            `INSERT INTO jawaban_versi (peserta_id, soal_id, versi, isi, alasan, disimpan_at) VALUES (?, ?, ?, ?, 'terlambat', ?)
             ON CONFLICT (peserta_id, soal_id, versi) DO NOTHING`,
          )
          .run(kiriman.peserta_id, kiriman.soal_id, versi, kiriman.isi, t);
      }
      catatAksiGuru(k, res, id, 'putuskan_terlambat', { terlambat_id: tid, keputusan, peserta_id: kiriman.peserta_id });
      return kiriman.peserta_id;
    })();
    // Siswa (bila masih tersambung, mis. dibuka kembali) memuat ulang jawabannya; dasbor guru diperbarui.
    kirimStatusPeserta(k, pesertaId);
    beritahuPantau(k, id);
    res.status(204).end();
  });

  // selesai → penilaian.
  router.post('/ujian/:id/mulai-penilaian', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilik(k, res, id);
    const t = k.jam();
    k.db.transaction(() => {
      const u = k.db.prepare('SELECT status, diakhiri_at FROM ujian WHERE id = ?').get(id) as { status: string; diakhiri_at: number | null };
      if (u.status !== 'selesai') throw new GalatHttp(409, 'transisi_tidak_sah');
      // Simpanan masih diterima sampai 10 dtk setelah Akhiri (DESAIN §4). Penilaian baru boleh dimulai setelah
      // toleransi itu lewat (+2 dtk cadangan), supaya ketikan terakhir siswa tidak ditolak lalu dinilai 0.
      const bolehPada = (u.diakhiri_at ?? 0) + TOLERANSI_MS + 2000;
      if (t < bolehPada) {
        throw new GalatHttp(409, 'belum_lengkap', {
          masalah: [`Tunggu ${Math.ceil((bolehPada - t) / 1000)} detik lagi: jawaban terakhir siswa masih bisa masuk setelah Akhiri.`],
        });
      }
      const menunggu = k.db
        .prepare("SELECT COUNT(*) FROM jawaban_terlambat WHERE ujian_id = ? AND keputusan = 'menunggu'")
        .pluck()
        .get(id) as number;
      if (menunggu > 0) {
        throw new GalatHttp(409, 'belum_lengkap', { masalah: [`Ada ${menunggu} kiriman terlambat yang belum diputuskan (terima/tolak).`] });
      }
      const berubah = k.db
        .prepare("UPDATE ujian SET status = 'penilaian', diubah_at = ? WHERE id = ? AND status = 'selesai'")
        .run(t, id).changes;
      if (berubah === 0) throw new GalatHttp(409, 'transisi_tidak_sah');
      // Jawaban kosong (atau tidak ada) siswa yang hadir: 0 di semua kriteria, langsung disetujui (keputusan
      // pemilik 22 Nov). Guru tetap bisa mengubahnya.
      const soal = muatSoalGuru(k, id);
      const { hadir } = pesertaUjian(k, id);
      const isi = k.db.prepare('SELECT isi, versi FROM jawaban WHERE peserta_id = ? AND soal_id = ?');
      const sisip = k.db.prepare(
        `INSERT INTO penilaian (ujian_id, peserta_id, soal_id, skor_json, sumber, status, versi_jawaban, dinilai_at, disetujui_at)
         VALUES (?, ?, ?, ?, 'otomatis_kosong', 'disetujui', ?, ?, ?) ON CONFLICT (peserta_id, soal_id) DO NOTHING`,
      );
      let kosong = 0;
      for (const p of hadir) {
        for (const s of soal) {
          const j = isi.get(p.id, s.id) as { isi: string; versi: number } | undefined;
          if (j && j.isi.trim() !== '') continue;
          kosong += sisip.run(id, p.id, s.id, JSON.stringify(skorNol(s.rubrik)), j?.versi ?? 0, t, t).changes;
        }
      }
      catatAksiGuru(k, res, id, 'mulai_penilaian', { jawaban_kosong: kosong });
    })();
    siarkanStatus(k, id);
    res.json(muatPenilaian(k, id));
  });

  // Simpan skor satu jawaban (draf atau langsung disetujui).
  router.put('/ujian/:id/penilaian/:pid/:soalId', (req, res) => {
    const { id, pid, soalId } = validasi(ParamNilai, req.params);
    ujianMilikDiStatus(k, res, id, ['penilaian']);
    const input = validasi(SimpanNilaiSchema, req.body);
    const soal = muatSoalGuru(k, id).find((s) => s.id === soalId);
    const peserta = k.db.prepare('SELECT status FROM peserta WHERE id = ? AND ujian_id = ?').get(pid, id) as { status: string } | undefined;
    if (!soal || !peserta) throw new GalatHttp(404, 'tidak_ditemukan');
    if (peserta.status !== 'dikumpulkan') throw new GalatHttp(409, 'status_tidak_sesuai');
    const masalah = masalahSkor(soal.rubrik, input.skor);
    if (masalah) throw new GalatHttp(400, 'input_tidak_valid', { masalah: [masalah] });
    const t = k.jam();
    const versi = (k.db.prepare('SELECT versi FROM jawaban WHERE peserta_id = ? AND soal_id = ?').pluck().get(pid, soalId) as number | undefined) ?? 0;
    k.db
      .prepare(
        `INSERT INTO penilaian (ujian_id, peserta_id, soal_id, skor_json, catatan, sumber, status, versi_jawaban, dinilai_at, disetujui_at)
         VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?)
         ON CONFLICT (peserta_id, soal_id) DO UPDATE SET skor_json = excluded.skor_json, catatan = excluded.catatan,
           sumber = 'manual', status = excluded.status, versi_jawaban = excluded.versi_jawaban,
           dinilai_at = excluded.dinilai_at, disetujui_at = excluded.disetujui_at`,
      )
      .run(id, pid, soalId, JSON.stringify(input.skor), input.catatan, input.setujui ? 'disetujui' : 'draf', versi, t, input.setujui ? t : null);
    const baris = bacaNilai(k, id).find((n) => n.peserta_id === pid && n.soal_id === soalId);
    res.json(baris);
  });

  // "Setujui semua" draf untuk satu soal (aturan keras #8 mengizinkan persetujuan per soal). Draf AI yang jawabannya
  // ditandai AI berisi instruksi untuk penilai (kemungkinan upaya prompt injection) DILEWATI: guru wajib membukanya
  // dan menyetujuinya satu per satu.
  router.post('/ujian/:id/penilaian/setujui/:soalId', (req, res) => {
    const { id, soalId } = validasi(ParamSoalNilai, req.params);
    ujianMilikDiStatus(k, res, id, ['penilaian']);
    const t = k.jam();
    const DITANDAI = `penilaian.sumber = 'ai' AND EXISTS (
        SELECT 1 FROM ai_tugas a WHERE a.peserta_id = penilaian.peserta_id AND a.soal_id = penilaian.soal_id
          AND a.status = 'selesai' AND json_extract(a.hasil_json, '$.indikasi_instruksi.ada') = 1)`;
    const hasil = k.db.transaction(() => {
      const jumlah = k.db
        .prepare(`UPDATE penilaian SET status = 'disetujui', disetujui_at = ? WHERE ujian_id = ? AND soal_id = ? AND status = 'draf' AND NOT (${DITANDAI})`)
        .run(t, id, soalId).changes;
      const dilewati = k.db
        .prepare(`SELECT COUNT(*) FROM penilaian WHERE ujian_id = ? AND soal_id = ? AND status = 'draf' AND ${DITANDAI}`)
        .pluck()
        .get(id, soalId) as number;
      catatAksiGuru(k, res, id, 'setujui_soal', { soal_id: soalId, jumlah, dilewati });
      return { jumlah, dilewati };
    })();
    res.json(hasil);
  });

  function transisi(res: Response, id: number, aksi: string, ubah: (t: number) => number): void {
    const t = k.jam();
    k.db.transaction(() => {
      if (ubah(t) === 0) throw new GalatHttp(409, 'transisi_tidak_sah');
      catatAksiGuru(k, res, id, aksi);
    })();
    // Siswa yang sedang membuka halaman ujian memuat ulang (nilai tampil / tertutup lagi).
    siarkanStatus(k, id);
    res.json(muatPenilaian(k, id));
  }

  router.post('/ujian/:id/rilis', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilik(k, res, id);
    transisi(res, id, 'rilis', (t) => {
      const status = k.db.prepare('SELECT status FROM ujian WHERE id = ?').pluck().get(id) as string;
      if (status !== 'penilaian') return 0;
      const masalah = masalahRilis(k, id);
      if (masalah.length > 0) throw new GalatHttp(409, 'belum_lengkap', { masalah });
      return k.db
        .prepare("UPDATE ujian SET status = 'dirilis', dirilis_at = ?, diubah_at = ? WHERE id = ? AND status = 'penilaian'")
        .run(t, t, id).changes;
    });
  });

  router.post('/ujian/:id/tarik-rilis', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilik(k, res, id);
    transisi(res, id, 'tarik_rilis', (t) =>
      k.db
        .prepare("UPDATE ujian SET status = 'penilaian', dirilis_at = NULL, diubah_at = ? WHERE id = ? AND status = 'dirilis'")
        .run(t, id).changes,
    );
  });

  // Tabel nilai untuk unduhan: satu baris per siswa. Nilai per soal dalam persen (0–100) + nilai akhir, sebagai
  // ANGKA (null = sel teks keterangan). Belum disetujui → "belum dinilai"; tidak hadir → "tidak hadir".
  function tabelNilai(id: number): { judul: string; kepala: string[]; baris: (string | number)[][] } {
    const judul = k.db.prepare('SELECT judul FROM ujian WHERE id = ?').pluck().get(id) as string;
    const soal = muatSoalGuru(k, id);
    const { hadir, tidakHadir } = pesertaUjian(k, id);
    const nilai = new Map(bacaNilai(k, id).map((n) => [`${n.peserta_id}:${n.soal_id}`, n]));
    const kepala = ['Nama', 'Nomor', ...soal.map((s) => `Soal ${s.urutan} ${s.judul} (bobot ${s.bobot})`), 'Nilai akhir (0-100)'];
    const baris: (string | number)[][] = [];
    for (const p of [...hadir, ...tidakHadir].sort((x, y) => x.nama.localeCompare(y.nama, 'id'))) {
      if (p.status !== 'dikumpulkan') {
        baris.push([p.nama, p.nomor, ...soal.map(() => ''), 'tidak hadir']);
        continue;
      }
      const perSoal = soal.map((s) => nilaiTersetujui(s, nilai.get(`${p.id}:${s.id}`)));
      const lengkap = perSoal.every((n) => n !== null);
      baris.push([
        p.nama,
        p.nomor,
        ...perSoal.map((n) => (n === null ? 'belum dinilai' : persenSoal(n))),
        lengkap ? nilaiUjian(soal.map((s, i) => ({ nilai: perSoal[i] as number, bobot: s.bobot }))) : 'belum lengkap',
      ]);
    }
    return { judul, kepala, baris };
  }

  function namaBerkas(judul: string, ekstensi: string): string {
    return `nilai-${judul.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'ujian'}.${ekstensi}`;
  }

  function lampiran(res: Response, nama: string, tipe: string): void {
    res.set({
      'Content-Type': tipe,
      // filename (ASCII) untuk browser lama, filename* (UTF-8) untuk nama dengan huruf non-ASCII.
      'Content-Disposition': `attachment; filename="nilai.${nama.split('.').pop() ?? 'bin'}"; filename*=UTF-8''${encodeURIComponent(nama)}`,
      'Cache-Control': 'private, no-store',
    });
  }

  // Unduhan utama: Excel .xlsx (rapi di pengaturan wilayah Windows mana pun; keputusan pemilik 22 Nov).
  router.get('/ujian/:id/nilai.xlsx', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilikDiStatus(k, res, id, ['penilaian', 'dirilis']);
    const t = tabelNilai(id);
    const berkas = buatXlsx({
      nama: 'Nilai',
      kolom: t.kepala.map((judul, i) => ({ judul, lebar: i === 0 ? 28 : i === 1 ? 10 : Math.min(40, Math.max(14, judul.length + 2)) })),
      baris: t.baris,
    });
    lampiran(res, namaBerkas(t.judul, 'xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(berkas);
  });

  // Alternatif CSV format Indonesia (';', desimal koma, UTF-8 BOM). Di Windows berformat en-US, Excel tidak memecah
  // kolomnya; karena itu .xlsx menjadi unduhan utama.
  router.get('/ujian/:id/nilai.csv', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilikDiStatus(k, res, id, ['penilaian', 'dirilis']);
    const t = tabelNilai(id);
    const isi = [t.kepala, ...t.baris]
      .map((b) => b.map((v) => selCsv(typeof v === 'number' ? angka(v) : v)).join(';'))
      .join('\r\n');
    lampiran(res, namaBerkas(t.judul, 'csv'), 'text/csv; charset=utf-8');
    res.send(`﻿${isi}\r\n`);
  });

  return router;
}

function nilaiTersetujui(s: SoalGuru, n: NilaiJawaban | undefined): number | null {
  if (!n || n.status !== 'disetujui') return null;
  return nilaiSoal(s.rubrik, n.skor);
}
