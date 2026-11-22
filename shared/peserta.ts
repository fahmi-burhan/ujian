// shared/peserta.ts — kontrak endpoint siswa selama ujian (ruang tunggu, pengerjaan, autosave, kumpul, SSE),
// dipakai server DAN klien.
// Dipanggil oleh: server/routes/peserta-ujian.ts, server/routes/jawaban.ts, server/siaran.ts,
//                 client/src/halaman/UjianPeserta.vue, client/src/autosave.ts, tes.
// Memanggil: zod, shared/auth.ts (daftar status).
// Kontrak: docs/DESAIN.md §5 (autosave), §8 (endpoint), §8.1 (daftar putih). Semua skema respons memakai
// .strict(): bila server tak sengaja menambah field rahasia (rubrik, jawaban acuan, …), validasi di klien
// dan tes langsung gagal.
import { z } from 'zod';
import { STATUS_PESERTA, STATUS_UJIAN } from './auth.ts';

// Simpanan masih diterima sampai 10 dtk setelah waktu peserta habis (docs/DESAIN.md §4), dan kumpul
// otomatis baru berjalan setelah toleransi ini lewat, supaya simpanan yang masih di jalan masuk lebih dulu.
export const TOLERANSI_MS = 10_000;
export const BATAS_ISI_JAWABAN = 50_000;

// Kunci yang TIDAK BOLEH muncul di payload apa pun untuk siswa (docs/DESAIN.md §8.1). Dipakai tes.
export const KUNCI_TERLARANG_PESERTA = ['rubrik', 'rubrik_json', 'jawaban_acuan', 'pin_hash', 'id_anonim'] as const;

export const CARA_KUMPUL = ['manual', 'waktu_habis', 'diakhiri_penguji'] as const;
export type CaraKumpul = (typeof CARA_KUMPUL)[number];

// Sisa waktu milik peserta ini (termasuk perpanjangan khusus dirinya) + jam server saat dihitung.
export const WaktuSchema = z
  .object({ sisa_ms: z.number().int(), jam_server: z.number().int(), dijeda: z.boolean() })
  .strict();
export type Waktu = z.infer<typeof WaktuSchema>;

export const SoalPesertaSchema = z
  .object({
    id: z.number().int(),
    urutan: z.number().int(),
    judul: z.string(),
    teks: z.string(),
    bobot: z.number().int(),
    // Buku rujukan soal (bisa lebih dari satu), baru dikirim setelah ujian dimulai.
    rujukan: z.array(z.object({ pdf_id: z.number().int(), halaman: z.number().int().nullable() }).strict()),
  })
  .strict();
export type SoalPeserta = z.infer<typeof SoalPesertaSchema>;

// versi 0 = belum pernah disimpan (isi kosong).
export const JawabanPesertaSchema = z
  .object({ soal_id: z.number().int(), isi: z.string(), versi: z.number().int(), ditandai: z.boolean() })
  .strict();
export type JawabanPeserta = z.infer<typeof JawabanPesertaSchema>;

// GET /api/peserta/ujian. `id` (ujian) dan `saya.id` hanya dipakai klien sebagai kunci penyangga lokal
// (localStorage), bukan rahasia: id peserta sudah terlihat di daftar pilihan nama.
export const UjianPesertaSchema = z
  .object({
    id: z.number().int(),
    status: z.enum(STATUS_UJIAN),
    waktu: WaktuSchema,
    judul: z.string(),
    petunjuk: z.string(),
    durasi_menit: z.number().int(),
    jumlah_soal: z.number().int(),
    pdf: z.array(z.object({ id: z.number().int(), nama_tampil: z.string() }).strict()),
    saya: z
      .object({
        id: z.number().int(),
        nama: z.string(),
        status: z.enum(STATUS_PESERTA),
        cara_kumpul: z.enum(CARA_KUMPUL).nullable(),
      })
      .strict(),
    // Hanya saat berlangsung/dijeda (aturan keras #1).
    soal: z.array(SoalPesertaSchema).optional(),
    // Jawaban SENDIRI saat berlangsung/dijeda/selesai, untuk mencocokkan penyangga lokal (§5).
    jawaban: z.array(JawabanPesertaSchema).optional(),
  })
  .strict();
export type UjianPeserta = z.infer<typeof UjianPesertaSchema>;

// ---- Permintaan ----
// ID tab & ID kiriman: UUID buatan browser.
const uuid = z.uuid();

export const TabSchema = z.object({ tab_id: uuid }).strict();

export const SimpanJawabanSchema = z
  .object({
    isi: z.string().max(BATAS_ISI_JAWABAN),
    ditandai: z.boolean(),
    versi_dasar: z.number().int().min(0),
    id_simpan: uuid,
    // true = siswa baru saja memilih salah satu dari dua teks yang bentrok; riwayatnya diberi alasan "konflik".
    konflik: z.boolean().optional(),
  })
  .strict();
export type SimpanJawaban = z.infer<typeof SimpanJawabanSchema>;

// Kunci = id soal, nilai = versi yang diketahui klien (soal yang belum pernah disimpan boleh tidak disebut).
export const KumpulkanSchema = z
  .object({ versi: z.record(z.string().regex(/^[1-9][0-9]{0,15}$/), z.number().int().min(0)) })
  .strict();
export type Kumpulkan = z.infer<typeof KumpulkanSchema>;

// ---- Respons simpan ----
export const SimpanHasilSchema = z.object({ versi: z.number().int(), disimpan_at: z.number().int() }).strict();
export type SimpanHasil = z.infer<typeof SimpanHasilSchema>;
export const TerlambatSchema = z.object({ terlambat: z.literal(true) }).strict();

// ---- Event SSE /api/peserta/stream ----
export const SseStatusSchema = z.object({ status: z.enum(STATUS_UJIAN) }).strict();
// dihapus_penguji = guru menghapus nama siswa atau ujiannya (hanya mungkin saat draf).
export const ALASAN_SESI_DICABUT = ['keluar', 'diambil_alih', 'direset_penguji', 'dihapus_penguji'] as const;
export const SseSesiDicabutSchema = z.object({ alasan: z.enum(ALASAN_SESI_DICABUT) }).strict();
export type AlasanSesiDicabut = (typeof ALASAN_SESI_DICABUT)[number];
