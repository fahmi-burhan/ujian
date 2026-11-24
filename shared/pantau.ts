// shared/pantau.ts — kontrak Fase 5: laporan aktivitas dari browser siswa, dasbor pemantauan guru, layar
// proyektor, perpanjangan/buka kembali, tanda "wajar", jawaban per siswa (guru), dan perangkat dikenal.
// Dipanggil oleh: server/routes/event.ts, server/routes/pantau.ts, server/pantau.ts, server/routes/ujian-jalan.ts,
//                 server/routes/penguji-auth.ts, client/src/integritas.ts, halaman guru & proyektor, tes.
// Memanggil: zod, shared/auth.ts, shared/peserta.ts.
// Kontrak: docs/DESAIN.md §6 (integritas), §8 (endpoint), §8.1 (daftar putih). Skema respons .strict():
// field yang tidak terdaftar membuat validasi gagal, jadi kebocoran (mis. teks soal ke proyektor) ketahuan.
import { z } from 'zod';
import { STATUS_PESERTA, STATUS_UJIAN } from './auth.ts';
import { CARA_KUMPUL, KUNCI_TERLARANG_PESERTA, WaktuSchema } from './peserta.ts';

// ---- Jenis aktivitas ----
// Dilaporkan browser siswa. Urutan = kekuatan sinyal untuk satu kepergian (§6, P9): tab_tersembunyi paling kuat.
export const JENIS_KEPERGIAN = ['tab_tersembunyi', 'fokus_hilang', 'keluar_layar_penuh'] as const;
export type JenisKepergian = (typeof JENIS_KEPERGIAN)[number];
export const JENIS_EVENT_KLIEN = [...JENIS_KEPERGIAN, 'tempel_dari_luar'] as const;
export type JenisEventKlien = (typeof JENIS_EVENT_KLIEN)[number];
// Dicatat server.
export const JENIS_EVENT = [...JENIS_EVENT_KLIEN, 'masuk_ulang', 'koneksi_putus', 'akses_sebelum_mulai'] as const;
export type JenisEvent = (typeof JENIS_EVENT)[number];
// Hanya ini yang tampil di proyektor (upaya tempel & kejadian server hanya untuk guru; keputusan pemilik 20 Nov).
export const JENIS_DI_PROYEKTOR: readonly JenisEvent[] = JENIS_KEPERGIAN;

export function peringkatKepergian(jenis: JenisKepergian): number {
  return JENIS_KEPERGIAN.length - JENIS_KEPERGIAN.indexOf(jenis);
}

// Teks netral untuk guru, siswa, dan proyektor (aturan keras #3: tidak ada kata "curang"/"pelanggaran").
export const LABEL_EVENT: Record<JenisEvent, string> = {
  tab_tersembunyi: 'Pindah tab/minimize',
  fokus_hilang: 'Jendela tidak aktif',
  keluar_layar_penuh: 'Keluar layar penuh',
  tempel_dari_luar: 'Upaya menempel dari luar halaman',
  masuk_ulang: 'Masuk ulang (sesi baru)',
  koneksi_putus: 'Koneksi terputus',
  akses_sebelum_mulai: 'Akses sebelum ujian dimulai',
};

// ---- Laporan dari browser siswa: POST /api/peserta/event ----
// Batas durasi wajar satu laporan: 12 jam (ujian maks 600 menit + perpanjangan).
export const MAKS_DURASI_LAPORAN_MS = 12 * 60 * 60 * 1000;
export const DetailEventSchema = z
  .object({
    // Semua sinyal yang muncul selama satu kepergian (mis. blur + tab tersembunyi).
    sinyal: z.array(z.enum(JENIS_KEPERGIAN)).max(JENIS_KEPERGIAN.length).optional(),
    // Upaya tempel: HANYA panjang teks, tidak pernah isinya (clipboard siswa bisa berisi hal pribadi).
    panjang: z.number().int().min(0).max(10_000_000).optional(),
  })
  .strict();
export type DetailEvent = z.infer<typeof DetailEventSchema>;

export const LaporanEventSchema = z
  .object({
    id_klien: z.uuid(),
    jenis: z.enum(JENIS_EVENT_KLIEN),
    tahap: z.enum(['mulai', 'selesai']),
    // Jam kejadian dalam perkiraan JAM SERVER (browser menghitungnya dari jam_server + jam monoton).
    mulai_klien_at: z.number().int().min(0),
    durasi_ms: z.number().int().min(0).max(MAKS_DURASI_LAPORAN_MS).optional(),
    detail: DetailEventSchema.default({}),
  })
  .strict();
export type LaporanEvent = z.input<typeof LaporanEventSchema>;

// ---- Aksi guru ----
export const PerpanjangSchema = z
  .object({
    menit: z.number().int().min(-120).max(120).refine((m) => m !== 0),
    peserta_id: z.number().int().positive().optional(),
  })
  .strict();
export type Perpanjang = z.infer<typeof PerpanjangSchema>;

export const BukaKembaliSchema = z.object({ menit: z.number().int().min(1).max(120) }).strict();

export const TandaiEventSchema = z
  .object({ ditandai_wajar: z.boolean(), catatan_penguji: z.string().trim().max(500) })
  .strict();

export const BukaKunciSemuaHasilSchema = z.object({ jumlah: z.number().int() }).strict();

// ---- Ringkasan aktivitas per jenis: {jenis: {kali, total_ms}} ----
const RingkasanSchema = z.record(z.string(), z.object({ kali: z.number().int(), total_ms: z.number().int() }).strict());
export type Ringkasan = z.infer<typeof RingkasanSchema>;

// ---- Dasbor guru: GET /api/ujian/:id/pantau & SSE `pantau` ----
export const EventGuruSchema = z
  .object({
    id: z.number().int(),
    peserta_id: z.number().int(),
    jenis: z.enum(JENIS_EVENT),
    mulai_at: z.number().int(),
    selesai_at: z.number().int().nullable(),
    durasi_ms: z.number().int().nullable(),
    detail: z.record(z.string(), z.unknown()),
    ditandai_wajar: z.boolean(),
    catatan_penguji: z.string(),
  })
  .strict();
export type EventGuru = z.infer<typeof EventGuruSchema>;

export const LogGuruSchema = z
  .object({
    id: z.number().int(),
    aktor: z.enum(['penguji', 'server']),
    aksi: z.string(),
    detail: z.record(z.string(), z.unknown()),
    dibuat_at: z.number().int(),
  })
  .strict();
export type LogGuru = z.infer<typeof LogGuruSchema>;

export const PesertaPantauSchema = z
  .object({
    id: z.number().int(),
    nama: z.string(),
    nomor: z.string(),
    status: z.enum(STATUS_PESERTA),
    cara_kumpul: z.enum(CARA_KUMPUL).nullable(),
    tersambung: z.boolean(),
    info_perangkat: z.string(),
    terjawab: z.number().int(),
    simpan_terakhir_at: z.number().int().nullable(),
    // Sisa waktu milik peserta ini (dengan perpanjangannya); null sebelum Mulai.
    sisa_ms: z.number().int().nullable(),
    perpanjangan_ms: z.number().int(),
    punya_pin: z.boolean(),
    terkunci: z.boolean(),
    aktivitas: RingkasanSchema,
    terlambat_menunggu: z.number().int(),
  })
  .strict();
export type PesertaPantau = z.infer<typeof PesertaPantauSchema>;

export const PantauSchema = z
  .object({
    ujian: z
      .object({
        id: z.number().int(),
        judul: z.string(),
        kode: z.string(),
        status: z.enum(STATUS_UJIAN),
        mode_tampil: z.enum(['nama', 'inisial']),
        jumlah_soal: z.number().int(),
        // Sisa waktu global; null sebelum Mulai.
        waktu: WaktuSchema.nullable(),
      })
      .strict(),
    peserta: z.array(PesertaPantauSchema),
    // Event terbaru dulu (maks 300); log aksi terbaru dulu (maks 100).
    event: z.array(EventGuruSchema),
    log: z.array(LogGuruSchema),
    jam_server: z.number().int(),
  })
  .strict();
export type Pantau = z.infer<typeof PantauSchema>;

// ---- Jawaban satu siswa (guru): GET /api/ujian/:id/peserta/:pid/jawaban ----
export const JawabanGuruSchema = z
  .object({
    peserta: z.object({ id: z.number().int(), nama: z.string(), nomor: z.string(), status: z.enum(STATUS_PESERTA) }).strict(),
    soal: z.array(z.object({ id: z.number().int(), urutan: z.number().int(), judul: z.string() }).strict()),
    jawaban: z.array(
      z
        .object({
          soal_id: z.number().int(),
          isi: z.string(),
          versi: z.number().int(),
          ditandai: z.boolean(),
          diubah_at: z.number().int(),
        })
        .strict(),
    ),
    riwayat: z.array(
      z
        .object({
          soal_id: z.number().int(),
          versi: z.number().int(),
          isi: z.string(),
          alasan: z.string(),
          disimpan_at: z.number().int(),
        })
        .strict(),
    ),
    terlambat: z.array(
      z
        .object({
          id: z.number().int(),
          soal_id: z.number().int(),
          isi: z.string(),
          diterima_at: z.number().int(),
          alasan: z.string(),
          keputusan: z.enum(['menunggu', 'diterima', 'ditolak']),
        })
        .strict(),
    ),
    event: z.array(EventGuruSchema),
  })
  .strict();
export type JawabanGuru = z.infer<typeof JawabanGuruSchema>;

// ---- Layar proyektor: SSE `proyektor` ----
// Kunci yang tidak boleh muncul di payload proyektor (§8.1). Dipakai tes.
export const KUNCI_TERLARANG_PROYEKTOR = [...KUNCI_TERLARANG_PESERTA, 'teks', 'isi', 'detail'] as const;

export const ProyektorDataSchema = z
  .object({
    judul: z.string(),
    status: z.enum(STATUS_UJIAN),
    // Saat menunggu, berlangsung, dan dijeda (siswa perlu mengetiknya untuk masuk, termasuk yang terlambat).
    kode: z.string().nullable(),
    waktu: WaktuSchema.nullable(),
    hadir: z.number().int(),
    total: z.number().int(),
    terkumpul: z.number().int(),
    peserta: z.array(
      z
        .object({
          label: z.string(),
          status: z.enum(STATUS_PESERTA),
          terjawab: z.number().int(),
          jumlah_soal: z.number().int(),
          aktivitas: RingkasanSchema,
        })
        .strict(),
    ),
    // Aktivitas terbaru (maks 8). durasi_ms null = masih berlangsung.
    terbaru: z.array(
      z
        .object({
          label: z.string(),
          jenis: z.enum(JENIS_KEPERGIAN),
          durasi_ms: z.number().int().nullable(),
          mulai_at: z.number().int(),
        })
        .strict(),
    ),
    jam_server: z.number().int(),
  })
  .strict();
export type ProyektorData = z.infer<typeof ProyektorDataSchema>;

// "Budi Santoso" → "B. S." (mode inisial di proyektor).
export function inisial(nama: string): string {
  return nama
    .trim()
    .split(/\s+/)
    .filter((b) => b !== '')
    .map((b) => `${b.charAt(0).toUpperCase()}.`)
    .join(' ');
}

// ---- Perangkat dikenal guru: GET /api/penguji/masuk/perangkat ----
export const PerangkatGuruSchema = z
  .object({
    id: z.number().int(),
    info_perangkat: z.string(),
    dibuat_at: z.number().int(),
    dipakai_at: z.number().int(),
    kedaluwarsa_at: z.number().int(),
    // Browser yang sedang dipakai (cookie perangkat_guru-nya cocok).
    ini: z.boolean(),
  })
  .strict();
export const DaftarPerangkatGuruSchema = z.array(PerangkatGuruSchema);
export type PerangkatGuru = z.infer<typeof PerangkatGuruSchema>;
