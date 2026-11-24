// tests/catatan.test.ts — pemecahan catatan guru menjadi bagian berjudul (tampilan nilai siswa).
// Dipanggil oleh: `npm test`. Memanggil: client/src/catatan.ts.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { pecahCatatan } from '../client/src/catatan.ts';

describe('pecahCatatan', () => {
  test('format draf AI: Umum + per kriteria', () => {
    assert.deepEqual(pecahCatatan('Umum:\nBagus.\n\nIdentitas rawi:\nNisbah kurang.\nPerbaiki.\r\n\r\nKesimpulan:\nTepat.'), [
      { judul: 'Umum', isi: 'Bagus.' },
      { judul: 'Identitas rawi', isi: 'Nisbah kurang.\nPerbaiki.' },
      { judul: 'Kesimpulan', isi: 'Tepat.' },
    ]);
  });

  test('catatan biasa tanpa judul tetap utuh', () => {
    assert.deepEqual(pecahCatatan('Bagus sekali: lanjutkan.'), [{ judul: null, isi: 'Bagus sekali: lanjutkan.' }]);
    assert.deepEqual(pecahCatatan('Satu.\n\n\nDua:'), [
      { judul: null, isi: 'Satu.' },
      { judul: null, isi: 'Dua:' },
    ]);
    assert.deepEqual(pecahCatatan('  \n '), []);
  });

  test('baris pertama panjang berakhiran titik dua bukan judul', () => {
    const panjang = `${'x'.repeat(130)}:`;
    assert.deepEqual(pecahCatatan(`${panjang}\nisi`), [{ judul: null, isi: `${panjang}\nisi` }]);
  });
});
