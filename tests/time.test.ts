// tests/time.test.ts — memastikan format WIB dan perhitungan selisih jam benar.
// Dipanggil oleh: `npm test`. Memanggil: shared/time.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeClockOffset, formatWib } from '../shared/time.ts';

test('formatWib menampilkan jam 24 jam WIB (UTC+7) dengan titik dua', () => {
  assert.equal(formatWib(Date.UTC(2026, 11, 4, 7, 30, 5)), '14:30:05 WIB');
});

test('formatWib memakai 00 untuk tengah malam, bukan 24', () => {
  assert.equal(formatWib(Date.UTC(2026, 11, 4, 17, 0, 0)), '00:00:00 WIB');
});

test('computeClockOffset memakai titik tengah perjalanan request', () => {
  assert.equal(computeClockOffset(1000, 1200, 5000), 3900);
  assert.equal(computeClockOffset(1000, 1000, 1000), 0);
  assert.equal(computeClockOffset(9000, 9200, 5000), -4100);
});
