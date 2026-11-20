// shared/health.ts — kontrak respons GET /api/health, dipakai server DAN klien.
// Dipanggil oleh: server/routes/health.ts (membentuk respons), client/src/App.vue (memvalidasi respons).
// Memanggil: zod.
// Alasan: satu skema untuk dua sisi, jadi bila bentuk respons berubah, kedua sisi ikut terdeteksi
// oleh typecheck. serverTime adalah dasar perhitungan selisih jam laptop vs server (timer ujian).
import { z } from 'zod';

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  // Waktu server saat respons dibuat, dalam milidetik sejak 1 Jan 1970 UTC (epoch ms).
  serverTime: z.number().int().nonnegative(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
