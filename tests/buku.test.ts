// tests/buku.test.ts — antrean unduhan buku siswa (client/src/buku.ts) dengan fetch tiruan: urutan & prioritas,
// berhenti saat siswa sudah mengumpulkan (buku yang siap tetap disimpan), buku gagal diantrekan lagi.
// Dipanggil oleh: `npm test`. Memanggil: client/src/buku.ts.
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ambilDataBuku, hentikanUnduhan, lupakanBuku, siapkanBuku, statusBuku } from '../client/src/buku.ts';

type Gerbang = { url: string; lepas: () => void; tolak: (status: number) => void };
let gerbang: Gerbang[] = [];
const asli = globalThis.fetch;

// Setiap permintaan ditahan sampai tes melepasnya (berkas 10 byte) atau menolaknya dengan status tertentu.
beforeEach(() => {
  gerbang = [];
  globalThis.fetch = ((url: string, init?: RequestInit) =>
    new Promise<Response>((selesai, gagal) => {
      init?.signal?.addEventListener('abort', () => gagal(new DOMException('aborted', 'AbortError')));
      gerbang.push({
        url,
        lepas: () => selesai(new Response(new Uint8Array(10), { status: 200, headers: { 'Content-Length': '10' } })),
        tolak: (status) => selesai(new Response(null, { status })),
      });
    })) as typeof fetch;
});
afterEach(() => {
  lupakanBuku();
  globalThis.fetch = asli;
});

const tunggu = () => new Promise((r) => setTimeout(r, 0));
const DAFTAR = [1, 2, 3].map((id) => ({ id, ukuran_byte: 10 }));

describe('antrean buku', () => {
  test('satu per satu; buku yang dibuka siswa langsung diunduh', async () => {
    siapkanBuku(DAFTAR);
    await tunggu();
    assert.deepEqual(gerbang.map((g) => g.url), ['/api/peserta/pdf/1']);
    void ambilDataBuku(3);
    await tunggu();
    assert.deepEqual(gerbang.map((g) => g.url), ['/api/peserta/pdf/1', '/api/peserta/pdf/3']);
    gerbang[0]?.lepas();
    await tunggu();
    await tunggu();
    assert.equal(statusBuku.get(1)?.keadaan, 'siap');
    // Buku 3 (didahulukan) masih berjalan: buku 2 menunggu sampai ia selesai (tetap satu antrean).
    assert.equal(gerbang.length, 2);
    gerbang[1]?.lepas();
    await tunggu();
    await tunggu();
    assert.deepEqual(gerbang.map((g) => g.url).at(-1), '/api/peserta/pdf/2');
  });

  test('siswa mengumpulkan: unduhan berhenti, buku yang sudah siap disimpan, tidak diunduh ulang', async () => {
    siapkanBuku(DAFTAR);
    await tunggu();
    gerbang[0]?.lepas();
    await tunggu();
    await tunggu();
    assert.equal(statusBuku.get(1)?.keadaan, 'siap');
    hentikanUnduhan();
    await tunggu();
    assert.deepEqual([statusBuku.get(1)?.keadaan, statusBuku.has(2), statusBuku.has(3)], ['siap', false, false]);
    const sebelum = gerbang.length;
    siapkanBuku(DAFTAR); // perpanjangan waktu → dibuka lagi
    await tunggu();
    assert.ok(gerbang.slice(sebelum).every((g) => g.url !== '/api/peserta/pdf/1'), 'buku 1 tidak diunduh ulang');
  });

  test('ditolak server (409) → gagal "tetap"; siapkanBuku berikutnya mengantrekannya lagi', async () => {
    siapkanBuku([{ id: 1, ukuran_byte: 10 }]);
    await tunggu();
    gerbang[0]?.tolak(409);
    await tunggu();
    await tunggu();
    assert.deepEqual([statusBuku.get(1)?.keadaan, statusBuku.get(1)?.tetap], ['gagal', true]);
    siapkanBuku([{ id: 1, ukuran_byte: 10 }]);
    await tunggu();
    assert.equal(statusBuku.get(1)?.keadaan, 'mengunduh');
    assert.equal(gerbang.length, 2);
  });
});
