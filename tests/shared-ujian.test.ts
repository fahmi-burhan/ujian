// tests/shared-ujian.test.ts — fungsi murni di shared/: pembaca CSV peserta dan cek kelengkapan ujian.
// Dipanggil oleh: `npm test`. Memanggil: shared/csv.ts, shared/ujian.ts.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { pesertaDariCsv, uraiCsv } from '../shared/csv.ts';
import { masalahRubrik, masalahUjian } from '../shared/ujian.ts';

describe('uraiCsv', () => {
  test('mendeteksi pemisah ";" "," dan Tab dari baris pertama', () => {
    assert.deepEqual(uraiCsv('a;b\nc;d').map((b) => b.sel), [['a', 'b'], ['c', 'd']]);
    assert.deepEqual(uraiCsv('a,b\nc,d').map((b) => b.sel), [['a', 'b'], ['c', 'd']]);
    assert.deepEqual(uraiCsv('a\tb\nc\td').map((b) => b.sel), [['a', 'b'], ['c', 'd']]);
    assert.deepEqual(uraiCsv('Budi\nAni').map((b) => b.sel), [['Budi'], ['Ani']]);
  });

  test('kutip, kutip ganda, baris baru di dalam kutip, BOM, CRLF; nomor baris mengikuti berkas', () => {
    const hasil = uraiCsv('﻿nama,nomor\r\n"Siti, A",1\r\n"Kata ""Ok""",2\r\n"Dua\nBaris",3\r\n\r\nEko,4');
    assert.deepEqual(hasil, [
      { baris: 1, sel: ['nama', 'nomor'] },
      { baris: 2, sel: ['Siti, A', '1'] },
      { baris: 3, sel: ['Kata "Ok"', '2'] },
      { baris: 4, sel: ['Dua\nBaris', '3'] },
      { baris: 7, sel: ['Eko', '4'] },
    ]);
  });

  test('pesertaDariCsv melewati baris judul dan mengambil nama + nomor', () => {
    assert.deepEqual(pesertaDariCsv('Nama Siswa;No\nBudi;01\nAni'), [
      { baris: 2, nama: 'Budi', nomor: '01' },
      { baris: 3, nama: 'Ani', nomor: '' },
    ]);
    assert.equal(pesertaDariCsv('Budi\nAni').length, 2, 'tanpa judul, baris pertama ikut');
  });
});

describe('kelengkapan', () => {
  const level = [
    { skor: 0, deskriptor: 'kurang' },
    { skor: 3, deskriptor: 'baik' },
  ];

  test('rubrik lengkap tidak punya masalah', () => {
    assert.deepEqual(masalahRubrik({ kriteria: [{ id: 'k1', nama: 'Isi', bobot: 50, level }], poin_wajib: [] }), []);
  });

  test('rubrik: tanpa kriteria, id kembar, nama kosong, level kurang, skor kembar, tanpa skor 0, deskriptor kosong', () => {
    assert.deepEqual(masalahRubrik({ kriteria: [], poin_wajib: [] }), ['rubrik belum punya kriteria']);
    const m = masalahRubrik({
      kriteria: [
        { id: 'k1', nama: 'A', bobot: 1, level },
        { id: 'k1', nama: '', bobot: 1, level: [{ skor: 2, deskriptor: '' }, { skor: 2, deskriptor: 'x' }] },
      ],
      poin_wajib: [],
    });
    assert.deepEqual(m, [
      'kriteria 2: id kembar',
      'kriteria 2: nama masih kosong',
      'kriteria 2: skor level tidak boleh sama',
      'kriteria 2: wajib ada level berskor 0',
      'kriteria 2: ada deskriptor level yang kosong',
    ]);
  });

  test('ujian: tanpa soal & peserta, teks/acuan kosong (spasi saja dianggap kosong)', () => {
    assert.deepEqual(masalahUjian({ durasi_menit: 60, jumlah_peserta: 0, soal: [] }), ['Belum ada soal', 'Belum ada peserta']);
    const m = masalahUjian({
      durasi_menit: 60,
      jumlah_peserta: 3,
      soal: [{ urutan: 1, judul: 'A', teks: '  ', jawaban_acuan: '', rubrik: { kriteria: [{ id: 'k', nama: 'x', bobot: 1, level }], poin_wajib: [] } }],
    });
    assert.deepEqual(m, ['Soal 1 "A": teks soal masih kosong', 'Soal 1 "A": jawaban acuan masih kosong']);
  });
});
