// tests/waktu-ujian.test.ts — hitungan waktu ujian (docs/DESAIN.md §4) tanpa HTTP: sisa waktu, jeda,
// perpanjangan, akhir efektif, aturan penerimaan simpanan, dan syarat kumpul otomatis.
// Dipanggil oleh: `npm test`. Memanggil: server/waktu-ujian.ts.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { TOLERANSI_MS } from '../shared/peserta.ts';
import { akhirEfektif, harusDikumpulkanOtomatis, penerimaanSimpan, sisaMs, waktuPeserta } from '../server/waktu-ujian.ts';
import type { PesertaWaktu, UjianWaktu } from '../server/waktu-ujian.ts';

const MULAI = 1_000_000;
const MENIT = 60_000;

function ujian(ubah: Partial<UjianWaktu> = {}): UjianWaktu {
  return {
    id: 1,
    status: 'berlangsung',
    durasi_menit: 10,
    dimulai_at: MULAI,
    dijeda_at: null,
    diakhiri_at: null,
    total_jeda_ms: 0,
    perpanjangan_ms: 0,
    detak_at: MULAI,
    ...ubah,
  };
}
function peserta(ubah: Partial<PesertaWaktu> = {}): PesertaWaktu {
  return { id: 1, ujian_id: 1, status: 'mengerjakan', cara_kumpul: null, perpanjangan_ms: 0, ...ubah };
}

describe('sisa waktu', () => {
  test('berjalan, lalu membeku saat dijeda, dan jeda yang selesai tidak memakan waktu', () => {
    const u = ujian();
    assert.equal(sisaMs(u, peserta(), MULAI + 3 * MENIT), 7 * MENIT);
    const dijeda = ujian({ status: 'dijeda', dijeda_at: MULAI + 3 * MENIT });
    // Selama jeda, sisa tidak berkurang walau jam terus berjalan.
    assert.equal(sisaMs(dijeda, peserta(), MULAI + 50 * MENIT), 7 * MENIT);
    // Dilanjutkan setelah jeda 5 menit: total_jeda 5 menit.
    const lanjut = ujian({ total_jeda_ms: 5 * MENIT });
    assert.equal(sisaMs(lanjut, peserta(), MULAI + 9 * MENIT), 6 * MENIT);
  });

  test('perpanjangan semua + per peserta dijumlahkan; sebelum mulai sisa = durasi penuh', () => {
    const u = ujian({ perpanjangan_ms: 2 * MENIT });
    assert.equal(sisaMs(u, peserta({ perpanjangan_ms: MENIT }), MULAI + 10 * MENIT), 3 * MENIT);
    const belum = ujian({ status: 'menunggu', dimulai_at: null, detak_at: null });
    assert.equal(sisaMs(belum, peserta(), MULAI + 99 * MENIT), 10 * MENIT);
  });

  test('payload waktu memberi tahu status jeda', () => {
    const w = waktuPeserta(ujian({ status: 'dijeda', dijeda_at: MULAI + MENIT }), peserta(), MULAI + 2 * MENIT);
    assert.deepEqual(w, { sisa_ms: 9 * MENIT, jam_server: MULAI + 2 * MENIT, dijeda: true });
  });
});

describe('akhir efektif & penerimaan simpanan', () => {
  test('jam berjalan: akhir = saat sisa nol; diterima sampai +10 dtk, sesudahnya terlambat', () => {
    const u = ujian();
    const nol = MULAI + 10 * MENIT;
    assert.equal(akhirEfektif(u, peserta(), nol - 5000), nol);
    assert.deepEqual(penerimaanSimpan(u, peserta(), nol + TOLERANSI_MS), { jenis: 'terima' });
    assert.deepEqual(penerimaanSimpan(u, peserta(), nol + TOLERANSI_MS + 1), { jenis: 'terlambat', alasan: 'waktu_habis' });
  });

  test('dijeda saat waktu masih ada: diterima 10 dtk setelah jeda, lalu "dijeda" (dikirim ulang nanti)', () => {
    const jeda = MULAI + 4 * MENIT;
    const u = ujian({ status: 'dijeda', dijeda_at: jeda });
    assert.equal(akhirEfektif(u, peserta(), jeda + MENIT), jeda);
    assert.deepEqual(penerimaanSimpan(u, peserta(), jeda + TOLERANSI_MS), { jenis: 'terima' });
    assert.deepEqual(penerimaanSimpan(u, peserta(), jeda + TOLERANSI_MS + 1), { jenis: 'dijeda' });
  });

  test('dijeda SETELAH waktu peserta habis: bukan "dijeda", tetapi terlambat', () => {
    const nol = MULAI + 10 * MENIT;
    const u = ujian({ status: 'dijeda', dijeda_at: nol + 3000 });
    // Akhir efektif = saat waktunya habis (3 dtk sebelum jeda), bukan saat jeda.
    assert.equal(akhirEfektif(u, peserta(), nol + MENIT), nol);
    assert.deepEqual(penerimaanSimpan(u, peserta(), nol + TOLERANSI_MS - 1), { jenis: 'terima' });
    assert.deepEqual(penerimaanSimpan(u, peserta(), nol + TOLERANSI_MS + 1), { jenis: 'terlambat', alasan: 'waktu_habis' });
  });

  test('diakhiri guru: toleransi 10 dtk dihitung dari saat diakhiri, alasan "diakhiri"', () => {
    const akhir = MULAI + 5 * MENIT;
    const u = ujian({ status: 'selesai', diakhiri_at: akhir });
    const p = peserta({ status: 'dikumpulkan', cara_kumpul: 'diakhiri_penguji' });
    assert.deepEqual(penerimaanSimpan(u, p, akhir + TOLERANSI_MS), { jenis: 'terima' });
    assert.deepEqual(penerimaanSimpan(u, p, akhir + TOLERANSI_MS + 1), { jenis: 'terlambat', alasan: 'diakhiri' });
  });

  test('sudah mengumpulkan sendiri / dikumpulkan otomatis → selalu terlambat', () => {
    const u = ujian();
    const t = MULAI + MENIT;
    assert.deepEqual(penerimaanSimpan(u, peserta({ status: 'dikumpulkan', cara_kumpul: 'manual' }), t), {
      jenis: 'terlambat',
      alasan: 'sudah_dikumpulkan',
    });
    assert.deepEqual(penerimaanSimpan(u, peserta({ status: 'dikumpulkan', cara_kumpul: 'waktu_habis' }), t), {
      jenis: 'terlambat',
      alasan: 'waktu_habis',
    });
  });
});

describe('kumpul otomatis', () => {
  test('baru setelah sisa ≤ −10 dtk, hanya untuk peserta yang mengerjakan di ujian berjalan', () => {
    const nol = MULAI + 10 * MENIT;
    const u = ujian();
    assert.equal(harusDikumpulkanOtomatis(u, peserta(), nol + TOLERANSI_MS - 1), false);
    assert.equal(harusDikumpulkanOtomatis(u, peserta(), nol + TOLERANSI_MS), true);
    assert.equal(harusDikumpulkanOtomatis(u, peserta({ status: 'dikumpulkan', cara_kumpul: 'manual' }), nol + MENIT), false);
    assert.equal(harusDikumpulkanOtomatis(ujian({ status: 'selesai', diakhiri_at: nol }), peserta(), nol + MENIT), false);
    // Dijeda dengan sisa masih ada: tidak pernah dikumpulkan selama jeda.
    const dijeda = ujian({ status: 'dijeda', dijeda_at: MULAI + MENIT });
    assert.equal(harusDikumpulkanOtomatis(dijeda, peserta(), nol + 60 * MENIT), false);
  });
});
