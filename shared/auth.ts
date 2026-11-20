// shared/auth.ts — kontrak permintaan & respons login (guru, peserta, proyektor), dipakai server DAN klien.
// Dipanggil oleh: server/routes/*-auth.ts, server/routes/proyektor.ts, halaman login di client/src/halaman/.
// Memanggil: zod, shared/alfabet.ts.
// Kontrak lengkap: docs/DESAIN.md §8. Skema respons memakai .strict() (daftar putih §8.1): bila server
// tak sengaja menambah field rahasia (mis. pin_hash), validasi di klien & tes langsung gagal.
import { z } from 'zod';
import { POLA_KODE_PROYEKTOR, POLA_KODE_UJIAN, POLA_PIN, rapikanKode } from './alfabet.ts';

const kodeUjian = z.string().transform(rapikanKode).pipe(z.string().regex(POLA_KODE_UJIAN));
const kodeProyektor = z.string().transform(rapikanKode).pipe(z.string().regex(POLA_KODE_PROYEKTOR));
const pin = z.string().regex(POLA_PIN);

// ---- Guru ----
export const PengujiMasukSchema = z.object({
  username: z.string().trim().min(3).max(32),
  password: z.string().min(10).max(200),
});
export type PengujiMasuk = z.infer<typeof PengujiMasukSchema>;

export const PengujiSayaSchema = z
  .object({ id: z.number().int(), username: z.string(), nama: z.string() })
  .strict();
export type PengujiSaya = z.infer<typeof PengujiSayaSchema>;

// ---- Peserta ----
export const DaftarNamaPermintaanSchema = z.object({ kode: kodeUjian });

export const DaftarNamaResponsSchema = z
  .object({
    judul: z.string(),
    peserta: z.array(
      z
        .object({ id: z.number().int(), nama: z.string(), nomor: z.string(), punya_pin: z.boolean() })
        .strict(),
    ),
  })
  .strict();
export type DaftarNamaRespons = z.infer<typeof DaftarNamaResponsSchema>;

export const PesertaMasukSchema = z.object({
  kode: kodeUjian,
  peserta_id: z.number().int().positive(),
  pin,
  // Wajib (dan harus sama dengan pin) bila siswa belum punya PIN; diabaikan bila sudah punya.
  pin_ulang: pin.optional(),
});
export type PesertaMasuk = z.infer<typeof PesertaMasukSchema>;

export const STATUS_UJIAN = ['draf', 'menunggu', 'berlangsung', 'dijeda', 'selesai', 'penilaian', 'dirilis'] as const;
export type StatusUjian = (typeof STATUS_UJIAN)[number];
export const STATUS_PESERTA = ['belum_masuk', 'menunggu', 'mengerjakan', 'dikumpulkan'] as const;
export type StatusPeserta = (typeof STATUS_PESERTA)[number];

export const PesertaSayaSchema = z
  .object({
    nama: z.string(),
    nomor: z.string(),
    status: z.enum(STATUS_PESERTA),
    ujian: z.object({ judul: z.string(), status: z.enum(STATUS_UJIAN) }).strict(),
  })
  .strict();
export type PesertaSaya = z.infer<typeof PesertaSayaSchema>;

// ---- Proyektor ----
export const ProyektorMasukSchema = z.object({ kode: kodeProyektor });

export const TautanProyektorSchema = z
  .object({ kode: z.string(), kedaluwarsa_at: z.number().int() })
  .strict();
export type TautanProyektor = z.infer<typeof TautanProyektorSchema>;

export const ProyektorSayaSchema = z
  .object({ ujian: z.object({ judul: z.string(), status: z.enum(STATUS_UJIAN) }).strict() })
  .strict();
export type ProyektorSaya = z.infer<typeof ProyektorSayaSchema>;

// ---- Galat ----
// Kode galat tetap yang dikirim server ({ error: kode }). Klien menerjemahkannya ke pesan ramah.
export const KODE_GALAT = [
  'input_tidak_valid', 'belum_masuk', 'asal_tidak_sah', 'tidak_ditemukan', 'server_sibuk',
  'status_tidak_sesuai', 'transisi_tidak_sah', 'belum_lengkap', 'nama_sudah_ada', 'batas_tercapai', 'bukan_pdf',
  'csv_kosong', 'csv_terlalu_banyak',
  'login_salah', 'kode_salah', 'pin_salah', 'pin_tidak_sama', 'pin_berubah', 'terkunci',
  'json_tidak_valid', 'terlalu_besar', 'permintaan_terputus', 'permintaan_tidak_valid', 'kesalahan_server',
] as const;
export type KodeGalat = (typeof KODE_GALAT)[number];

export const GalatSchema = z.object({
  error: z.string(),
  // Hanya untuk pin_salah: sisa percobaan sebelum nama terkunci.
  sisa: z.number().int().optional(),
  // Hanya untuk belum_lengkap: daftar hal yang harus dilengkapi sebelum ujian dibuka.
  masalah: z.array(z.string()).optional(),
});
