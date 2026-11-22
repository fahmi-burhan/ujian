// server/config.ts — membaca .env dari akar proyek lalu memvalidasinya dengan Zod.
// Dipanggil oleh: server/start.ts, server/db/migrate-cli.ts, tes.
// Memanggil: zod, server/paths.ts.
// Alasan desain:
// - Konfigurasi yang salah (mis. PORT berisi huruf) harus gagal SAAT START dengan pesan jelas,
//   bukan menimbulkan error aneh di tengah ujian.
// - MODE (development/production) TIDAK dibaca dari .env, melainkan ditentukan oleh perintah yang
//   dijalankan (`npm run dev` atau `npm start`). Kalau .env lupa dibuat di VPS, server tetap berjalan
//   aman sebagai production, bukan diam-diam menyalakan Vite dev server ke internet.
// - .env dan DB_PATH dihitung dari akar proyek, bukan dari folder tempat perintah dijalankan,
//   supaya pm2 yang di-restart dari folder lain tidak membuat database kosong baru.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { MODEL_AI } from '../shared/ai.ts';
import type { ModelAi } from '../shared/ai.ts';
import { ROOT_DIR } from './paths.ts';

export type Mode = 'development' | 'production' | 'test';

// Nilai .env selalu berupa teks; "true"/"false" diubah menjadi boolean secara eksplisit
// karena z.coerce.boolean() menganggap teks "false" sebagai true (teks tidak kosong).
const booleanText = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8132),
  HOST: z.string().min(1).default('127.0.0.1'),
  DB_PATH: z.string().min(1).default('data/ujian.db'),
  // Folder berkas PDF buku, relatif terhadap akar proyek. Tidak masuk git (PDF berhak cipta).
  UPLOAD_DIR: z.string().min(1).default('uploads'),
  TRUST_PROXY: booleanText,
  // Alamat publik aplikasi persis seperti di bilah alamat browser, mis. https://ujian.domain.id
  // (tanpa garis miring di akhir). Dipakai untuk cek Origin (CSRF) dan atribut Secure cookie,
  // supaya tidak bergantung pada header Host/X-Forwarded-Proto dari nginx. Wajib di production
  // (dicek di server/start.ts); kosong di laptop.
  ORIGIN_PUBLIK: z
    .string()
    .optional()
    .transform((nilai) => (nilai === undefined || nilai.trim() === '' ? null : nilai.trim()))
    .refine((nilai) => nilai === null || originSah(nilai), {
      message: 'ORIGIN_PUBLIK harus berupa alamat lengkap tanpa path, mis. https://ujian.domain.id',
    }),
  // ---- Penilaian AI (Fase 6). Kosong = AI nonaktif, penilaian manual tetap jalan. ----
  // Kunci API Claude. HANYA di .env server (aturan keras #5): tidak pernah dikirim ke browser atau dicatat ke log.
  ANTHROPIC_API_KEY: z
    .string()
    .optional()
    .transform((nilai) => (nilai === undefined || nilai.trim() === '' ? null : nilai.trim())),
  // Model yang terpilih lebih dulu di halaman Penilaian (guru tetap bisa memilih model lain di sana).
  AI_MODEL_BAWAAN: z.enum(MODEL_AI).default('claude-haiku-5-5'),
  // Batas biaya penilaian AI per bulan kalender (UTC), dalam USD. 0 = AI tidak boleh dipakai sama sekali.
  AI_BATAS_USD_BULANAN: z.coerce.number().min(0).max(1000).default(3),
  // Jumlah permintaan AI yang berjalan bersamaan.
  AI_PARALEL: z.coerce.number().int().min(1).max(8).default(3),
  // Seberapa dalam model berpikir sebelum menjawab. low = paling murah & cepat.
  AI_EFFORT: z.enum(['low', 'medium', 'high']).default('low'),
});

// Origin sah = skema http/https + host (+ port), tanpa path, query, atau garis miring di akhir.
function originSah(nilai: string): boolean {
  try {
    const url = new URL(nilai);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === nilai;
  } catch {
    return false;
  }
}

export type Config = {
  mode: Mode;
  port: number;
  host: string;
  // Selalu path absolut (atau ':memory:' untuk tes).
  dbPath: string;
  // Selalu path absolut.
  uploadDir: string;
  trustProxy: boolean;
  // null = tidak diisi (laptop): Origin dibandingkan dengan protokol + host permintaan.
  originPublik: string | null;
  ai: {
    // null = kunci belum diisi. Jangan pernah mencetak objek config ini ke log.
    apiKey: string | null;
    modelBawaan: ModelAi;
    batasUsdBulanan: number;
    paralel: number;
    effort: 'low' | 'medium' | 'high';
  };
};

// Memuat <akar proyek>/.env bila ada. Variabel yang SUDAH ada di lingkungan (mis. diset pm2 atau
// shell) tidak ditimpa. Mengembalikan path berkas yang dimuat, atau null bila tidak ada.
export function loadEnvFileFromRoot(rootDir: string = ROOT_DIR): string | null {
  const file = join(rootDir, '.env');
  if (!existsSync(file)) return null;
  process.loadEnvFile(file);
  return file;
}

export function loadConfig(
  env: NodeJS.ProcessEnv,
  options: { mode: Mode; rootDir?: string },
): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Konfigurasi .env tidak valid:\n${z.prettifyError(parsed.error)}`);
  }
  const value = parsed.data;
  const rootDir = options.rootDir ?? ROOT_DIR;
  return {
    mode: options.mode,
    port: value.PORT,
    host: value.HOST,
    dbPath: value.DB_PATH === ':memory:' ? ':memory:' : resolve(rootDir, value.DB_PATH),
    uploadDir: resolve(rootDir, value.UPLOAD_DIR),
    trustProxy: value.TRUST_PROXY,
    originPublik: value.ORIGIN_PUBLIK,
    ai: {
      apiKey: value.ANTHROPIC_API_KEY,
      modelBawaan: value.AI_MODEL_BAWAAN,
      batasUsdBulanan: value.AI_BATAS_USD_BULANAN,
      paralel: value.AI_PARALEL,
      effort: value.AI_EFFORT,
    },
  };
}
