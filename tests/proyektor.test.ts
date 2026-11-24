// tests/proyektor.test.ts — logika layar proyektor tanpa DOM: halaman 30 kartu (yang bertanda di atas) dan deteksi
// aktivitas baru untuk bunyi. Dipanggil oleh: `npm test`. Memanggil: client/src/proyektor.ts.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { cekAktivitasBaru, susunHalaman } from '../client/src/proyektor.ts';

const p = (n: number, status = 'mengerjakan', aktivitas: Record<string, unknown> = {}) => ({ n, status, aktivitas });

describe('susunHalaman', () => {
  test('yang belum masuk disembunyikan; yang bertanda di atas, urutan asal tetap', () => {
    const h = susunHalaman([p(1), p(2, 'belum_masuk'), p(3, 'mengerjakan', { fokus_hilang: {} }), p(4), p(5, 'dikumpulkan', { tab_tersembunyi: {} })]);
    assert.deepEqual(h.map((x) => x.map((y) => y.n)), [[3, 5, 1, 4]]);
  });

  test('lebih dari 30 → beberapa halaman; yang bertanda selalu di halaman pertama', () => {
    const daftar = Array.from({ length: 35 }, (_, i) => p(i + 1, 'mengerjakan', i === 34 ? { fokus_hilang: {} } : {}));
    const h = susunHalaman(daftar);
    assert.deepEqual(h.map((x) => x.length), [30, 5]);
    assert.equal(h[0]?.[0]?.n, 35);
  });

  test('tanpa siswa: satu halaman kosong', () => {
    assert.deepEqual(susunHalaman([]), [[]]);
  });
});

describe('cekAktivitasBaru', () => {
  test('data pertama hanya patokan; berikutnya berbunyi bila ada yang lebih baru', () => {
    let s = cekAktivitasBaru([{ mulai_at: 100 }, { mulai_at: 50 }], null);
    assert.deepEqual(s, { baru: false, terakhir: 100 });
    s = cekAktivitasBaru([{ mulai_at: 100 }], s.terakhir);
    assert.equal(s.baru, false);
    s = cekAktivitasBaru([{ mulai_at: 120 }, { mulai_at: 100 }], s.terakhir);
    assert.deepEqual(s, { baru: true, terakhir: 120 });
    // Entri lama tergeser keluar dari daftar: tidak berbunyi, patokan tidak mundur.
    assert.deepEqual(cekAktivitasBaru([], 120), { baru: false, terakhir: 120 });
  });
});
