// tests/unduh-buku.test.ts — unduhan buku utuh dengan progres dan lanjutan (HTTP Range) setelah koneksi putus,
// memakai fetch tiruan. Dipanggil oleh: `npm test`. Memanggil: client/src/unduh-buku.ts.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { GalatUnduhTetap, unduhPenuh } from '../client/src/unduh-buku.ts';
import type { Progres } from '../client/src/unduh-buku.ts';

const BERKAS = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);

// Server tiruan: mendukung Range; `putusSetelah` = jumlah byte yang dikirim sebelum koneksi "putus" (per permintaan).
function server(opsi: { putusSetelah?: (number | null)[]; status?: number; tanpaRange?: boolean } = {}) {
  const permintaan: (string | null)[] = [];
  const ambil = (async (_url: string, init?: RequestInit) => {
    const range = (init?.headers as Record<string, string> | undefined)?.Range ?? null;
    permintaan.push(range);
    if (opsi.status) return new Response(null, { status: opsi.status });
    const mulai = range && !opsi.tanpaRange ? Number(/bytes=(\d+)-/.exec(range)?.[1]) : 0;
    const putus = opsi.putusSetelah?.[permintaan.length - 1] ?? null;
    const isi = BERKAS.slice(mulai);
    let posisi = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (posisi >= isi.length) {
          c.close();
          return;
        }
        const p = isi.slice(posisi, posisi + 128);
        if (putus !== null && posisi + p.length > putus) {
          c.error(new TypeError('network error'));
          return;
        }
        posisi += p.length;
        c.enqueue(p);
      },
    });
    const headers: Record<string, string> = mulai > 0
      ? { 'Content-Range': `bytes ${mulai}-${BERKAS.length - 1}/${BERKAS.length}`, 'Content-Length': String(isi.length) }
      : { 'Content-Length': String(BERKAS.length) };
    return new Response(stream, { status: mulai > 0 ? 206 : 200, headers });
  }) as typeof fetch;
  return { ambil, permintaan };
}

const cepat = { jeda: () => 0 };

describe('unduhPenuh', () => {
  test('mengunduh utuh dan melaporkan progres', async () => {
    const s = server();
    const progres: Progres[] = [];
    const hasil = await unduhPenuh('/x', { ambil: s.ambil, saatProgres: (p) => progres.push(p), ...cepat });
    assert.deepEqual(hasil, BERKAS);
    assert.deepEqual(progres.at(-1), { diterima: 1000, total: 1000 });
    assert.ok(progres.length > 2);
  });

  test('koneksi putus di tengah → dilanjutkan dari byte terakhir (Range), hasil tetap utuh', async () => {
    const s = server({ putusSetelah: [384, 256, null] });
    const hasil = await unduhPenuh('/x', { ambil: s.ambil, ...cepat });
    assert.deepEqual(hasil, BERKAS);
    assert.deepEqual(s.permintaan, [null, 'bytes=384-', 'bytes=640-']);
  });

  test('server mengabaikan Range (200) → mulai lagi dari nol tanpa menggandakan data', async () => {
    const s = server({ putusSetelah: [256, null], tanpaRange: true });
    assert.deepEqual(await unduhPenuh('/x', { ambil: s.ambil, ...cepat }), BERKAS);
  });

  test('ditolak server (409) → berhenti tanpa mencoba lagi', async () => {
    const s = server({ status: 409 });
    await assert.rejects(unduhPenuh('/x', { ambil: s.ambil, ...cepat }), GalatUnduhTetap);
    assert.equal(s.permintaan.length, 1);
  });

  test('gagal terus tanpa kemajuan → menyerah setelah batas', async () => {
    const s = server({ putusSetelah: Array(20).fill(0) });
    await assert.rejects(unduhPenuh('/x', { ambil: s.ambil, maksGagal: 3, ...cepat }));
    assert.equal(s.permintaan.length, 4);
  });
});

describe('unduhPenuh: kasus jaringan sulit', () => {
  test('206 dengan Content-Range yang tidak cocok → diulang dari awal, hasil tetap utuh', async () => {
    let ke = 0;
    const ambil = (async () => {
      ke += 1;
      if (ke === 1) {
        let kirim = false;
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(c) {
              if (kirim) return c.error(new TypeError('putus'));
              kirim = true;
              c.enqueue(BERKAS.slice(0, 300));
            },
          }),
          { status: 200 },
        );
      }
      if (ke === 2) return new Response(BERKAS.slice(500), { status: 206, headers: { 'Content-Range': 'bytes 500-999/1000' } });
      return new Response(BERKAS, { status: 200, headers: { 'Content-Length': '1000' } });
    }) as typeof fetch;
    assert.deepEqual(await unduhPenuh('/x', { ambil, ukuran: 1000, ...cepat }), BERKAS);
    assert.equal(ke, 3);
  });

  test('503 dicoba ulang; berhasil pada percobaan berikutnya', async () => {
    let ke = 0;
    const ambil = (async () => (++ke < 3 ? new Response(null, { status: 503 }) : new Response(BERKAS, { status: 200 }))) as typeof fetch;
    assert.deepEqual(await unduhPenuh('/x', { ambil, ukuran: 1000, ...cepat }), BERKAS);
    assert.equal(ke, 3);
  });

  test('koneksi macet tanpa diputus → penjaga memutusnya lalu melanjutkan lewat Range', async () => {
    const permintaan: (string | null)[] = [];
    const ambil = (async (_u: string, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string>).Range ?? null;
      permintaan.push(range);
      if (range === null) {
        let kirim = false;
        // Mengirim 400 byte lalu diam selamanya (tanpa RST).
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(c) {
              if (kirim) return new Promise<void>(() => {});
              kirim = true;
              c.enqueue(BERKAS.slice(0, 400));
            },
          }),
          { status: 200 },
        );
      }
      return new Response(BERKAS.slice(400), { status: 206, headers: { 'Content-Range': 'bytes 400-999/1000' } });
    }) as typeof fetch;
    assert.deepEqual(await unduhPenuh('/x', { ambil, ukuran: 1000, batasDiamMs: 30, ...cepat }), BERKAS);
    assert.deepEqual(permintaan, [null, 'bytes=400-']);
  });

  test('dibatalkan pemanggil saat menunggu jeda coba ulang → langsung berhenti, tidak mencoba lagi', async () => {
    const batal = new AbortController();
    let ke = 0;
    const ambil = (async () => {
      ke += 1;
      setTimeout(() => batal.abort(), 5);
      return new Response(null, { status: 503 });
    }) as typeof fetch;
    const mulai = Date.now();
    await assert.rejects(unduhPenuh('/x', { ambil, batal: batal.signal, jeda: () => 60_000 }));
    assert.equal(ke, 1);
    assert.ok(Date.now() - mulai < 5000, 'tidak menunggu jeda 60 dtk');
  });
});
