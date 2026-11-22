// shared/ai.ts — kontrak penilaian AI untuk halaman guru: daftar model yang boleh dipilih, permintaan "Nilai
// dengan AI", status antrean, dan saran AI per jawaban (alasan & kutipan per kriteria).
// Dipanggil oleh: server/ai/*, server/routes/penilaian-ai.ts, server/routes/penilaian.ts, server/config.ts,
//                 client/src/halaman/PenilaianUjian.vue, tes.
// Memanggil: zod.
// Semua payload di sini HANYA untuk guru pemilik ujian. Saran AI (alasan, kutipan) tidak pernah dikirim ke siswa;
// siswa hanya melihat catatan yang sudah disunting/disetujui guru (docs/DESAIN.md §2).
import { z } from 'zod';

// Nama model diambil dari dokumentasi resmi Anthropic (dicek 22 Nov 2026). Haiku untuk percobaan, Sonnet untuk
// ujian sungguhan (keputusan pemilik 22 Nov). Harga ada di server/ai/harga.ts.
export const MODEL_AI = ['claude-haiku-5-5', 'claude-sonnet-5-5'] as const;
export type ModelAi = (typeof MODEL_AI)[number];

export const LABEL_MODEL_AI: Record<ModelAi, { nama: string; keterangan: string }> = {
  'claude-haiku-5-5': { nama: 'Claude Haiku 5.5', keterangan: 'murah & cepat, cocok untuk percobaan' },
  'claude-sonnet-5-5': { nama: 'Claude Sonnet 5.5', keterangan: 'lebih teliti, untuk ujian sungguhan' },
};

export const MulaiAiSchema = z.object({ model: z.enum(MODEL_AI) }).strict();
export type MulaiAi = z.infer<typeof MulaiAiSchema>;

export const STATUS_RUN_AI = ['berjalan', 'selesai', 'dihentikan'] as const;
export const STATUS_TUGAS_AI = ['menunggu', 'berjalan', 'selesai', 'perlu_manual', 'dibatalkan'] as const;

// ---- Respons: GET /api/ujian/:id/ai ----
export const StatusAiSchema = z
  .object({
    // false = ANTHROPIC_API_KEY di .env server belum diisi (penilaian manual tetap bisa dipakai).
    tersedia: z.boolean(),
    model: z.array(z.object({ id: z.enum(MODEL_AI), nama: z.string(), keterangan: z.string() }).strict()),
    model_bawaan: z.enum(MODEL_AI),
    batas_usd_bulanan: z.number(),
    terpakai_usd_bulan_ini: z.number(),
    // Jawaban siswa hadir yang belum punya nilai sama sekali (yang akan dikirim ke AI).
    belum_dinilai: z.number().int(),
    // Perkiraan kasar biaya menilai `belum_dinilai` jawaban, per model.
    perkiraan_usd: z.record(z.string(), z.number()),
    run: z
      .object({
        id: z.number().int(),
        model: z.string(),
        status: z.enum(STATUS_RUN_AI),
        alasan_berhenti: z.string().nullable(),
        dibuat_at: z.number().int(),
        selesai_at: z.number().int().nullable(),
        jumlah: z.record(z.enum(STATUS_TUGAS_AI), z.number().int()),
        biaya_usd: z.number(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type StatusAi = z.infer<typeof StatusAiSchema>;

// ---- Hasil AI yang sudah divalidasi (disimpan di ai_tugas.hasil_json) ----
export const HasilAiSchema = z
  .object({
    skor: z.record(z.string(), z.number().int()),
    kriteria: z.record(z.string(), z.object({ alasan: z.string(), kutipan: z.array(z.string()) }).strict()),
    catatan_siswa: z.string(),
    indikasi_instruksi: z.object({ ada: z.boolean(), keterangan: z.string() }).strict(),
  })
  .strict();
export type HasilAi = z.infer<typeof HasilAiSchema>;

// ---- Bagian dari GET /api/ujian/:id/penilaian: saran AI terbaru per jawaban ----
export const SaranAiSchema = z
  .object({
    peserta_id: z.number().int(),
    soal_id: z.number().int(),
    model: z.string(),
    status: z.enum(['selesai', 'perlu_manual']),
    // null bila perlu_manual.
    hasil: HasilAiSchema.nullable(),
    galat: z.string().nullable(),
  })
  .strict();
export type SaranAi = z.infer<typeof SaranAiSchema>;

export function usd(mikro: number): number {
  return Math.round(mikro / 100) / 10_000;
}
