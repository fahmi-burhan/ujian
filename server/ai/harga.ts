// server/ai/harga.ts — harga per model dan cara menghitung biaya satu permintaan dari jumlah token.
// Dipanggil oleh: server/ai/antrean.ts (biaya nyata & cadangan batas biaya), server/routes/penilaian-ai.ts (perkiraan).
// Memanggil: shared/ai.ts.
// FAKTA (dicek 22 Nov 2026 di https://platform.claude.com/docs/en/about-claude/pricing.md), USD per 1 juta token:
//   Sonnet 5.5: input $2, tulis cache 5 menit $2,50, baca cache $0,10, output $10 (tanpa tingkat panjang prompt).
//   Haiku 5.5, prompt ≤ 100.000 token: input $0,10, tulis cache $0,125, baca cache $0,01, output $0,50.
//   Haiku 5.5, prompt > 100.000 token: input $0,50, tulis cache $0,625, baca cache $0,05, output $2,50.
//   "Panjang prompt" = semua token masukan termasuk baca & tulis cache.
// Bila harga resmi berubah, ubah tabel ini. Biaya sesungguhnya tetap ditagih oleh Anthropic; angka di aplikasi
// hanya untuk pengaman batas biaya & informasi guru.
import type { ModelAi } from '../../shared/ai.ts';

type Tarif = { masuk: number; tulisCache: number; bacaCache: number; keluar: number };
type Harga = { dasar: Tarif; panjang: { ambangToken: number; tarif: Tarif } | null };

export const HARGA: Record<ModelAi, Harga> = {
  'claude-haiku-5-5': {
    dasar: { masuk: 0.1, tulisCache: 0.125, bacaCache: 0.01, keluar: 0.5 },
    panjang: { ambangToken: 100_000, tarif: { masuk: 0.5, tulisCache: 0.625, bacaCache: 0.05, keluar: 2.5 } },
  },
  'claude-sonnet-5-5': {
    dasar: { masuk: 2, tulisCache: 2.5, bacaCache: 0.1, keluar: 10 },
    panjang: null,
  },
};

export type Pemakaian = { masuk: number; tulisCache: number; bacaCache: number; keluar: number };

// Biaya dalam mikro-USD (1 USD = 1.000.000). Kebetulan yang memudahkan: token × (USD per juta token) = mikro-USD.
// Dibulatkan ke atas agar pengaman batas biaya tidak pernah menghitung terlalu murah.
export function biayaMikro(model: ModelAi, p: Pemakaian): number {
  const h = HARGA[model];
  const panjangPrompt = p.masuk + p.tulisCache + p.bacaCache;
  const t = h.panjang && panjangPrompt > h.panjang.ambangToken ? h.panjang.tarif : h.dasar;
  return Math.ceil(p.masuk * t.masuk + p.tulisCache * t.tulisCache + p.bacaCache * t.bacaCache + p.keluar * t.keluar);
}

// Perkiraan token dari jumlah karakter, untuk PERKIRAAN BIAYA yang ditampilkan ke guru (bukan untuk pengaman batas
// biaya, yang memakai 1 token per karakter). ASUMSI kasar: ±2,5 karakter per token untuk teks Indonesia bercampur
// Arab. Tokenizer model 5.x menghasilkan ±30% lebih banyak token daripada model lama (FAKTA, halaman harga resmi),
// jadi angka sesungguhnya bisa berbeda.
export function perkiraanToken(karakter: number): number {
  return Math.ceil(karakter / 2.5);
}
