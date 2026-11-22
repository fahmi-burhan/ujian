// shared/nilai.ts — rumus nilai (docs/DESAIN.md §9), validasi skor terhadap rubrik, kontrak endpoint penilaian
// (guru) dan nilai siswa, serta sel CSV yang aman untuk Excel.
// Dipanggil oleh: server/routes/penilaian.ts, server/routes/peserta-nilai.ts, halaman penilaian guru & halaman
//                 nilai siswa di client/src/, tes.
// Memanggil: zod, shared/auth.ts, shared/ujian.ts.
// Rumus (satu-satunya tempat; server & klien memakai fungsi yang sama):
// - nilai soal  = Σ(skor ÷ skor_maks_kriteria × bobot_kriteria) ÷ Σ bobot_kriteria → 0–1
// - nilai ujian = Σ(nilai_soal × bobot_soal) ÷ Σ bobot_soal × 100 → 0–100, dibulatkan 1 desimal
import { z } from 'zod';
import { STATUS_PESERTA, STATUS_UJIAN } from './auth.ts';
import type { Kriteria, Rubrik } from './ujian.ts';
import { SoalGuruSchema } from './ujian.ts';

export type Skor = Record<string, number>;

export function skorMaks(k: Pick<Kriteria, 'level'>): number {
  return Math.max(0, ...k.level.map((l) => l.skor));
}

// null bila skor tidak lengkap/tidak sah untuk rubrik ini.
export function nilaiSoal(rubrik: Rubrik, skor: Skor): number | null {
  if (masalahSkor(rubrik, skor) !== null) return null;
  let jumlah = 0;
  let totalBobot = 0;
  for (const k of rubrik.kriteria) {
    const maks = skorMaks(k);
    jumlah += maks > 0 ? ((skor[k.id] ?? 0) / maks) * k.bobot : 0;
    totalBobot += k.bobot;
  }
  return totalBobot > 0 ? jumlah / totalBobot : 0;
}

export function nilaiUjian(daftar: { nilai: number; bobot: number }[]): number {
  const totalBobot = daftar.reduce((n, s) => n + s.bobot, 0);
  if (totalBobot === 0) return 0;
  const jumlah = daftar.reduce((n, s) => n + s.nilai * s.bobot, 0);
  return Math.round((jumlah / totalBobot) * 1000) / 10;
}

// Pesan masalah, atau null bila setiap kriteria rubrik punya skor yang merupakan salah satu levelnya.
export function masalahSkor(rubrik: Rubrik, skor: Skor): string | null {
  const ids = new Set(rubrik.kriteria.map((k) => k.id));
  for (const id of Object.keys(skor)) if (!ids.has(id)) return `kriteria "${id}" tidak ada di rubrik`;
  for (const k of rubrik.kriteria) {
    const s = skor[k.id];
    if (s === undefined) return `kriteria "${k.nama}" belum diberi skor`;
    if (!k.level.some((l) => l.skor === s)) return `skor ${s} bukan level kriteria "${k.nama}"`;
  }
  return null;
}

export function skorNol(rubrik: Rubrik): Skor {
  return Object.fromEntries(rubrik.kriteria.map((k) => [k.id, 0]));
}

// Nilai soal 0–1 → persen dibulatkan 1 desimal. SATU-SATUNYA pembulatan persen soal: halaman guru, CSV, dan
// halaman siswa memakai fungsi ini, jadi angka yang dibahas bersama siswa selalu sama.
export function persenSoal(nilai: number): number {
  return Math.round(nilai * 1000) / 10;
}

// 85,5 (desimal koma, untuk tampilan & CSV Excel Indonesia).
export function angka(n: number, desimal = 1): string {
  return n.toFixed(desimal).replace('.', ',');
}

// Sel CSV untuk Excel (aturan keras #10): sel yang diawali = + - @ (atau tab/CR) diberi awalan ' agar tidak
// dijalankan sebagai rumus (CSV injection); sel berisi pemisah, kutip, atau baris baru dikutip.
export function selCsv(nilai: string | number): string {
  let teks = String(nilai);
  if (/^[=+\-@\t\r]/.test(teks)) teks = `'${teks}`;
  return /[;"\n\r]/.test(teks) ? `"${teks.replaceAll('"', '""')}"` : teks;
}

// ---- Permintaan (guru) ----
export const SimpanNilaiSchema = z
  .object({
    skor: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,20}$/), z.number().int().min(0).max(10)),
    catatan: z.string().trim().max(2000),
    setujui: z.boolean(),
  })
  .strict();
export type SimpanNilai = z.infer<typeof SimpanNilaiSchema>;

export const KeputusanTerlambatSchema = z.object({ keputusan: z.enum(['diterima', 'ditolak']) }).strict();

// ---- Respons guru: GET /api/ujian/:id/penilaian ----
export const SUMBER_NILAI = ['manual', 'otomatis_kosong', 'ai'] as const;
export const NilaiJawabanSchema = z
  .object({
    peserta_id: z.number().int(),
    soal_id: z.number().int(),
    skor: z.record(z.string(), z.number().int()),
    catatan: z.string(),
    sumber: z.enum(SUMBER_NILAI),
    status: z.enum(['draf', 'disetujui']),
  })
  .strict();
export type NilaiJawaban = z.infer<typeof NilaiJawabanSchema>;

export const PenilaianGuruSchema = z
  .object({
    ujian: z.object({ id: z.number().int(), judul: z.string(), status: z.enum(STATUS_UJIAN) }).strict(),
    soal: z.array(SoalGuruSchema),
    // Siswa yang hadir (sudah mengumpulkan) saja; yang tidak hadir tidak dinilai.
    peserta: z.array(z.object({ id: z.number().int(), nama: z.string(), nomor: z.string() }).strict()),
    tidak_hadir: z.array(z.object({ id: z.number().int(), nama: z.string(), nomor: z.string() }).strict()),
    jawaban: z.array(z.object({ peserta_id: z.number().int(), soal_id: z.number().int(), isi: z.string() }).strict()),
    nilai: z.array(NilaiJawabanSchema),
    terlambat: z.array(
      z
        .object({
          id: z.number().int(),
          peserta_id: z.number().int(),
          soal_id: z.number().int(),
          isi: z.string(),
          diterima_at: z.number().int(),
          alasan: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export type PenilaianGuru = z.infer<typeof PenilaianGuruSchema>;

// ---- Respons siswa: GET /api/peserta/nilai (hanya setelah dirilis) ----
// Keputusan pemilik 22 Nov (aturan keras #1 diubah): setelah dirilis, siswa melihat kriteria, level yang dicapai
// beserta deskriptornya, catatan guru, dan jawaban acuan (`acuan`) untuk ujiannya sendiri.
export const NilaiPesertaSchema = z
  .object({
    judul: z.string(),
    status: z.enum(STATUS_PESERTA),
    hadir: z.boolean(),
    // null bila tidak hadir.
    nilai_akhir: z.number().nullable(),
    soal: z.array(
      z
        .object({
          urutan: z.number().int(),
          judul: z.string(),
          teks: z.string(),
          bobot: z.number().int(),
          porsi_persen: z.number(),
          nilai_persen: z.number(),
          jawaban: z.string(),
          acuan: z.string(),
          catatan: z.string(),
          kriteria: z.array(
            z
              .object({
                nama: z.string(),
                bobot: z.number().int(),
                skor: z.number().int(),
                skor_maks: z.number().int(),
                deskriptor: z.string(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export type NilaiPeserta = z.infer<typeof NilaiPesertaSchema>;
