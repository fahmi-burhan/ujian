// server/ai/claude.ts — adapter penyedia Claude (Anthropic) memakai SDK resmi @anthropic-ai/sdk.
// Dipanggil oleh: server/app.ts (dibuat sekali bila ANTHROPIC_API_KEY terisi).
// Memanggil: @anthropic-ai/sdk (Messages API), server/ai/adapter.ts.
// Catatan:
// - Kunci API hanya diterima sebagai argumen dari konfigurasi server (.env). Kunci tidak pernah dicatat ke log,
//   dan pesan galat yang diteruskan ke guru hanya berisi kode & status HTTP, bukan isi permintaan (aturan keras #5).
// - Keluaran memakai structured outputs (`output_config.format` berisi JSON Schema), lalu TETAP divalidasi Zod
//   oleh server/ai/prompt.ts (aturan keras #7), karena skema API tidak bisa memeriksa kutipan & batas panjang.
// - Prompt caching: instruksi sistem + konteks soal ditandai cache, jadi jawaban berikutnya untuk soal yang sama
//   membaca prefiks dari cache (lebih murah). Bila prefiks lebih pendek dari minimum cache model, permintaan tetap
//   jalan tanpa cache (tidak error).
// - Thinking adaptif (model memutuskan sendiri perlu berpikir atau tidak), kedalamannya diatur `effort`.
// - SDK sudah mencoba ulang sendiri untuk 429/5xx/koneksi (maxRetries); setelah itu galat dianggap 'sementara'.
import Anthropic from '@anthropic-ai/sdk';
import type { AdapterAi, JawabanAi, PermintaanAi } from './adapter.ts';
import { GalatAi } from './adapter.ts';

export function buatAdapterClaude(apiKey: string): AdapterAi {
  const klien = new Anthropic({ apiKey, maxRetries: 3, timeout: 120_000 });

  return {
    async nilai(p: PermintaanAi): Promise<JawabanAi> {
      let respons: Anthropic.Message;
      try {
        respons = await klien.messages.create({
          model: p.model,
          max_tokens: p.maksTokenKeluar,
          thinking: { type: 'adaptive' },
          output_config: { effort: p.effort, format: { type: 'json_schema', schema: p.skema } },
          system: [{ type: 'text', text: p.sistem }],
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: p.konteksSoal, cache_control: { type: 'ephemeral' } },
                { type: 'text', text: p.jawaban },
              ],
            },
          ],
        });
      } catch (e) {
        throw terjemahkanGalat(e);
      }
      const teks = respons.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const u = respons.usage;
      return {
        teks: teks === '' ? null : teks,
        berhenti:
          respons.stop_reason === 'end_turn'
            ? 'selesai'
            : respons.stop_reason === 'max_tokens'
              ? 'batas_token'
              : respons.stop_reason === 'refusal'
                ? 'ditolak'
                : 'lain',
        pemakaian: {
          masuk: u.input_tokens,
          tulisCache: u.cache_creation_input_tokens ?? 0,
          bacaCache: u.cache_read_input_tokens ?? 0,
          keluar: u.output_tokens,
        },
      };
    },
  };
}

// Galat SDK → GalatAi. Dicek dari kelas galat bertipe (bukan mencocokkan teks pesan).
function terjemahkanGalat(e: unknown): GalatAi {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new GalatAi('fatal', 'kunci_api', `Kunci API ditolak penyedia (HTTP ${e.status}). Periksa ANTHROPIC_API_KEY di .env server.`);
  }
  if (e instanceof Anthropic.PaymentRequiredError) {
    return new GalatAi('fatal', 'saldo_atau_batas', 'Saldo kredit API habis (HTTP 402). Isi kredit di Claude Console atau nilai secara manual.');
  }
  // 408 = permintaan kehabisan waktu di sisi penyedia: sementara, bukan alasan menghentikan seluruh run.
  if (e instanceof Anthropic.RequestTimeoutError) {
    return new GalatAi('sementara', 'sementara', 'Penyedia AI kehabisan waktu menjawab (HTTP 408).');
  }
  if (e instanceof Anthropic.BadRequestError) {
    // Termasuk "batas pemakaian bulanan di Console tercapai" (400) dan saldo kredit yang terlalu rendah. Pesan
    // penyedia ikut ditampilkan (dipotong) supaya penyebab lain juga terbaca; pesan itu tidak memuat kunci API.
    return new GalatAi(
      'fatal',
      'saldo_atau_batas',
      `Permintaan ditolak penyedia (HTTP 400: ${(e.apiMessage ?? e.message).slice(0, 200)}). Penyebab umum: saldo kredit habis atau batas biaya bulanan di Claude Console tercapai.`,
    );
  }
  if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) {
    const status = e instanceof Anthropic.APIConnectionError ? 'koneksi' : `HTTP ${e.status}`;
    return new GalatAi('sementara', 'sementara', `Penyedia AI sedang sibuk atau tidak terjangkau (${status}).`);
  }
  if (e instanceof Anthropic.APIError) {
    const pesan = e.apiMessage ? `: ${e.apiMessage.slice(0, 200)}` : '';
    return new GalatAi('fatal', 'permintaan_ditolak', `Permintaan ditolak penyedia (HTTP ${e.status ?? '?'}${pesan}).`);
  }
  return new GalatAi('sementara', 'tidak_dikenal', 'Galat tak terduga saat menghubungi penyedia AI.');
}
