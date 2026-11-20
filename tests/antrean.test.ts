// tests/antrean.test.ts — semafor (batas kerja bersamaan + antrean terbatas) dan antrean per kunci.
// Dipanggil oleh: `npm test`. Memanggil: server/auth/antrean.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buatAntreanPerKunci, buatSemafor } from '../server/auth/antrean.ts';
import { GalatHttp, tunda } from '../server/http.ts';

test('semafor: paling banyak N berjalan bersamaan, antrean penuh → 503 server_sibuk', async () => {
  const semafor = buatSemafor(2, 1);
  let jalan = 0;
  let puncak = 0;
  const kerja = async (): Promise<number> => {
    jalan += 1;
    puncak = Math.max(puncak, jalan);
    await tunda(20);
    jalan -= 1;
    return 1;
  };
  const tiga = [semafor.jalankan(kerja), semafor.jalankan(kerja), semafor.jalankan(kerja)];
  assert.equal(semafor.penuh(), true);
  await assert.rejects(
    semafor.jalankan(kerja),
    (e) => e instanceof GalatHttp && e.status === 503 && e.kode === 'server_sibuk',
  );
  assert.deepEqual(await Promise.all(tiga), [1, 1, 1]);
  assert.equal(puncak, 2);
  assert.equal(semafor.diam(), true);
});

test('semafor: kerja yang gagal tetap melepas slotnya', async () => {
  const semafor = buatSemafor(1, 5);
  await assert.rejects(
    semafor.jalankan(async () => {
      throw new Error('gagal');
    }),
  );
  assert.equal(semafor.diam(), true);
  assert.equal(await semafor.jalankan(async () => 7), 7);
});

test('antrean per kunci: kunci sama berurutan, kunci berbeda paralel', async () => {
  const antrean = buatAntreanPerKunci(10);
  const urutan: string[] = [];
  const kerja = (nama: string) => async (): Promise<void> => {
    urutan.push(`mulai ${nama}`);
    await tunda(20);
    urutan.push(`selesai ${nama}`);
  };
  await Promise.all([
    antrean.jalankan('a', kerja('a1')),
    antrean.jalankan('a', kerja('a2')),
    antrean.jalankan('b', kerja('b1')),
  ]);
  assert.ok(urutan.indexOf('selesai a1') < urutan.indexOf('mulai a2'), 'a2 menunggu a1');
  assert.ok(urutan.indexOf('mulai b1') < urutan.indexOf('selesai a1'), 'b1 tidak menunggu a1');
});
