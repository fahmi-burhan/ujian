// shared/ujian.ts — kontrak penyusunan ujian oleh guru (ujian, soal, rubrik, PDF, peserta), dipakai
// server DAN klien, plus pengecekan kelengkapan sebelum ujian dibuka.
// Dipanggil oleh: server/routes/ujian.ts, soal.ts, pdf.ts, peserta-guru.ts; halaman guru di client/src/.
// Memanggil: zod, shared/auth.ts (daftar status).
// Kontrak lengkap: docs/DESAIN.md §8 (endpoint) dan §9 (rubrik). Payload ini HANYA untuk guru pemilik:
// berisi rubrik & jawaban acuan, jadi tidak boleh dipakai untuk respons peserta/proyektor (§8.1).
import { z } from 'zod';
import { STATUS_PESERTA, STATUS_UJIAN } from './auth.ts';
import type { StatusUjian } from './auth.ts';
import { WaktuSchema } from './peserta.ts';

export const BATAS = {
  judul: 200,
  petunjuk: 5000,
  teks: 50_000,
  jawabanAcuan: 50_000,
  namaKriteria: 200,
  deskriptor: 1000,
  poinWajib: 500,
  jumlahPoinWajib: 20,
  jumlahKriteria: 10,
  jumlahLevel: 6,
  jumlahSoal: 100,
  jumlahPdf: 20,
  nama: 100,
  nomor: 20,
  barisImpor: 200,
  csvKarakter: 100_000,
  pdfByte: 30 * 1024 * 1024,
  namaPdf: 200,
  // Buku rujukan per soal (migrasi 0005).
  rujukanSoal: 5,
} as const;

// Teks bebas: spasi di awal/akhir dibuang supaya isian "  " dianggap kosong saat cek kelengkapan.
const teks = (maks: number) => z.string().trim().max(maks);

// ---- Rubrik (docs/DESAIN.md §9) ----
// Skema ini sengaja LONGGAR (boleh belum lengkap) agar guru bisa menyimpan pekerjaan setengah jadi.
// Aturan lengkap §9 dicek oleh masalahRubrik() saat ujian dibuka.
export const LevelSchema = z
  .object({ skor: z.number().int().min(0).max(10), deskriptor: teks(BATAS.deskriptor) })
  .strict();
export const KriteriaSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/),
    nama: teks(BATAS.namaKriteria),
    bobot: z.number().int().min(1).max(100),
    level: z.array(LevelSchema).max(BATAS.jumlahLevel),
  })
  .strict();
export const RubrikSchema = z
  .object({
    kriteria: z.array(KriteriaSchema).max(BATAS.jumlahKriteria),
    // Poin kosong dibuang saat disimpan (tidak bermakna, dan jangan sampai masuk prompt AI di Fase 6).
    poin_wajib: z
      .array(teks(BATAS.poinWajib))
      .max(BATAS.jumlahPoinWajib)
      .transform((poin) => poin.filter((p) => p !== '')),
  })
  .strict();
export type Rubrik = z.infer<typeof RubrikSchema>;
export type Kriteria = z.infer<typeof KriteriaSchema>;

export const RUBRIK_KOSONG: Rubrik = { kriteria: [], poin_wajib: [] };

// Status ujian yang boleh dihapus permanen: tidak ada siswa yang sedang tersambung ke ujiannya (keputusan pemilik
// 22 Nov 2026). Dipakai server (DELETE /api/ujian/:id) dan klien (tombol Hapus), jadi keduanya selalu sejalan.
export const STATUS_BOLEH_HAPUS: readonly StatusUjian[] = ['draf', 'selesai', 'penilaian', 'dirilis'];

// ---- Permintaan ----
export const UjianBaruSchema = z
  .object({ judul: teks(BATAS.judul).min(1), durasi_menit: z.number().int().min(1).max(600) })
  .strict();
export type UjianBaru = z.infer<typeof UjianBaruSchema>;

export const UjianUbahSchema = z
  .object({
    judul: teks(BATAS.judul).min(1),
    petunjuk: teks(BATAS.petunjuk),
    durasi_menit: z.number().int().min(1).max(600),
  })
  .partial()
  .strict()
  .refine((isi) => Object.keys(isi).length > 0);
export type UjianUbah = z.infer<typeof UjianUbahSchema>;

export const MODE_TAMPIL = ['nama', 'inisial'] as const;
export const TampilanSchema = z.object({ mode_tampil: z.enum(MODE_TAMPIL) }).strict();

// Satu rujukan buku untuk soal: PDF milik ujian yang sama + halaman (opsional). Satu soal boleh merujuk beberapa
// buku (maks. BATAS.rujukanSoal), keputusan pemilik 22 Nov 2026.
export const RujukanSchema = z
  .object({
    pdf_id: z.number().int().positive(),
    halaman: z.number().int().min(1).max(100_000).nullable(),
  })
  .strict();
export type Rujukan = z.infer<typeof RujukanSchema>;

export const SoalInputSchema = z
  .object({
    judul: teks(BATAS.judul).min(1),
    teks: teks(BATAS.teks),
    bobot: z.number().int().min(1).max(100),
    rubrik: RubrikSchema,
    jawaban_acuan: teks(BATAS.jawabanAcuan),
    rujukan: z.array(RujukanSchema).max(BATAS.rujukanSoal).default([]),
  })
  .strict()
  // Buku + halaman yang sama dua kali hanya menghasilkan dua tautan kembar untuk siswa.
  .refine((s) => new Set(s.rujukan.map((r) => `${r.pdf_id}:${r.halaman}`)).size === s.rujukan.length, {
    path: ['rujukan'],
    message: 'rujukan kembar',
  });
export type SoalInput = z.input<typeof SoalInputSchema>;

export const UrutanSoalSchema = z
  .object({ ids: z.array(z.number().int().positive()).min(1).max(BATAS.jumlahSoal) })
  .strict();

export const PesertaInputSchema = z
  .object({ nama: teks(BATAS.nama).min(1), nomor: teks(BATAS.nomor).default('') })
  .strict();
export type PesertaInput = z.input<typeof PesertaInputSchema>;

export const PesertaUbahSchema = z
  .object({ nama: teks(BATAS.nama).min(1), nomor: teks(BATAS.nomor) })
  .partial()
  .strict()
  .refine((isi) => Object.keys(isi).length > 0);

// Duplikasi ujian (permintaan pemilik 22 Nov): salinan selalu berstatus draf dengan kode baru. Soal, rubrik,
// jawaban acuan, petunjuk, durasi, mode tampil, dan PDF selalu ikut; daftar peserta (nama + nomor saja,
// tanpa PIN/status/jawaban) hanya bila dicentang guru.
export const DuplikasiSchema = z.object({ salin_peserta: z.boolean() }).strict();
export type Duplikasi = z.infer<typeof DuplikasiSchema>;

const AKHIRAN_SALINAN = ' (salinan)';
export function judulSalinan(judul: string): string {
  // Dipotong per karakter (code point), bukan per unit UTF-16, agar emoji tidak terbelah. Batas di DB memakai
  // length() SQLite yang juga menghitung karakter.
  return Array.from(judul).slice(0, BATAS.judul - AKHIRAN_SALINAN.length).join('') + AKHIRAN_SALINAN;
}

export const ImporPesertaSchema = z.object({ csv: z.string().min(1).max(BATAS.csvKarakter) }).strict();

// ---- Respons (khusus guru pemilik) ----
export const UjianRingkasSchema = z
  .object({
    id: z.number().int(),
    judul: z.string(),
    kode: z.string(),
    status: z.enum(STATUS_UJIAN),
    durasi_menit: z.number().int(),
    jumlah_soal: z.number().int(),
    jumlah_peserta: z.number().int(),
    diubah_at: z.number().int(),
  })
  .strict();
export type UjianRingkas = z.infer<typeof UjianRingkasSchema>;
export const DaftarUjianSchema = z.array(UjianRingkasSchema);

export const PdfInfoSchema = z
  .object({ id: z.number().int(), nama_tampil: z.string(), ukuran_byte: z.number().int(), diunggah_at: z.number().int() })
  .strict();
export type PdfInfo = z.infer<typeof PdfInfoSchema>;

export const SoalGuruSchema = z
  .object({
    id: z.number().int(),
    urutan: z.number().int(),
    judul: z.string(),
    teks: z.string(),
    bobot: z.number().int(),
    rubrik: RubrikSchema,
    jawaban_acuan: z.string(),
    rujukan: z.array(RujukanSchema),
  })
  .strict();
export type SoalGuru = z.infer<typeof SoalGuruSchema>;

export const UjianDetailSchema = z
  .object({
    id: z.number().int(),
    judul: z.string(),
    petunjuk: z.string(),
    kode: z.string(),
    durasi_menit: z.number().int(),
    status: z.enum(STATUS_UJIAN),
    mode_tampil: z.enum(MODE_TAMPIL),
    dibuka_at: z.number().int().nullable(),
    soal: z.array(SoalGuruSchema),
    pdf: z.array(PdfInfoSchema),
    jumlah_peserta: z.number().int(),
    // Sisa waktu global (tanpa perpanjangan per peserta); null sebelum Mulai.
    waktu: WaktuSchema.nullable(),
  })
  .strict();
export type UjianDetail = z.infer<typeof UjianDetailSchema>;

export const PesertaGuruSchema = z
  .object({
    id: z.number().int(),
    nama: z.string(),
    nomor: z.string(),
    status: z.enum(STATUS_PESERTA),
    punya_pin: z.boolean(),
    terkunci: z.boolean(),
    masuk_pertama_at: z.number().int().nullable(),
  })
  .strict();
export type PesertaGuru = z.infer<typeof PesertaGuruSchema>;
export const DaftarPesertaGuruSchema = z.array(PesertaGuruSchema);

export const ALASAN_DILEWATI = ['duplikat', 'tidak_valid'] as const;
export const ImporHasilSchema = z
  .object({
    ditambah: z.array(PesertaGuruSchema),
    dilewati: z.array(
      z.object({ baris: z.number().int(), nama: z.string(), alasan: z.enum(ALASAN_DILEWATI) }).strict(),
    ),
  })
  .strict();
export type ImporHasil = z.infer<typeof ImporHasilSchema>;

// ---- Kelengkapan (syarat draf → menunggu, docs/DESAIN.md §3) ----
// Dipakai server (menolak "Buka ujian" dengan 409 belum_lengkap + daftar masalah) dan klien (daftar
// periksa di halaman penyusunan). Satu fungsi untuk keduanya, jadi pesan di layar = alasan penolakan.

export function masalahRubrik(rubrik: Rubrik): string[] {
  const masalah: string[] = [];
  if (rubrik.kriteria.length === 0) masalah.push('rubrik belum punya kriteria');
  const idTerpakai = new Set<string>();
  rubrik.kriteria.forEach((k, i) => {
    const label = `kriteria ${i + 1}${k.nama ? ` "${k.nama}"` : ''}`;
    if (idTerpakai.has(k.id)) masalah.push(`${label}: id kembar`);
    idTerpakai.add(k.id);
    if (!k.nama) masalah.push(`${label}: nama masih kosong`);
    if (k.level.length < 2) masalah.push(`${label}: butuh minimal 2 level`);
    const skor = k.level.map((l) => l.skor);
    if (new Set(skor).size !== skor.length) masalah.push(`${label}: skor level tidak boleh sama`);
    if (k.level.length > 0 && !skor.includes(0)) masalah.push(`${label}: wajib ada level berskor 0`);
    if (k.level.some((l) => !l.deskriptor)) masalah.push(`${label}: ada deskriptor level yang kosong`);
  });
  return masalah;
}

type DataKelengkapan = {
  durasi_menit: number;
  jumlah_peserta: number;
  soal: Pick<SoalGuru, 'urutan' | 'judul' | 'teks' | 'rubrik' | 'jawaban_acuan'>[];
};

export function masalahUjian(ujian: DataKelengkapan): string[] {
  const masalah: string[] = [];
  if (ujian.durasi_menit < 1 || ujian.durasi_menit > 600) masalah.push('Durasi harus 1–600 menit');
  if (ujian.soal.length === 0) masalah.push('Belum ada soal');
  for (const s of ujian.soal) {
    const label = `Soal ${s.urutan} "${s.judul}"`;
    if (!s.teks.trim()) masalah.push(`${label}: teks soal masih kosong`);
    if (!s.jawaban_acuan.trim()) masalah.push(`${label}: jawaban acuan masih kosong`);
    for (const m of masalahRubrik(s.rubrik)) masalah.push(`${label}: ${m}`);
  }
  if (ujian.jumlah_peserta === 0) masalah.push('Belum ada peserta');
  return masalah;
}
