// tests/hapus-ujian.test.ts — hapus ujian PERMANEN (keputusan pemilik 22 Nov 2026): boleh untuk ujian yang sudah lalu
// (selesai/penilaian/dirilis) dan draf, semua data ujian & berkas PDF-nya benar-benar hilang, catatan biaya AI tetap
// ada (tanpa ujian_id) agar batas biaya bulanan tetap benar; ditolak saat ujian dibuka/berjalan dan saat antrean AI
// masih berjalan.
// Dipanggil oleh: `npm test`. Memanggil: tests/bantuan.ts, server lewat HTTP sungguhan.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { isiDataAwal, mulaiAplikasiUji, PASSWORD_GURU, T0 } from './bantuan.ts';
import type { AplikasiUji, Klien } from './bantuan.ts';

let a: AplikasiUji;
let guru: Klien;
const BERKAS = `${'ab'.repeat(16)}.pdf`;

const hitung = (tabel: string, kolom = 'ujian_id') =>
  a.db.prepare(`SELECT COUNT(*) FROM ${tabel} WHERE ${kolom} = 1`).pluck().get() as number;

beforeEach(async () => {
  a = await mulaiAplikasiUji();
  await isiDataAwal(a.db, 'berlangsung');
  const RUBRIK = JSON.stringify({ kriteria: [{ id: 'k1', nama: 'K', bobot: 1, level: [{ skor: 0, deskriptor: 'a' }, { skor: 2, deskriptor: 'b' }] }], poin_wajib: [] });
  writeFileSync(join(a.uploadDir, BERKAS), '%PDF-1.4');
  a.db
    .prepare("INSERT INTO pdf (id, ujian_id, nama_tampil, nama_berkas, ukuran_byte, sha256, diunggah_at) VALUES (1, 1, 'Buku', ?, 8, ?, ?)")
    .run(BERKAS, 'a'.repeat(64), T0);
  a.db
    .prepare("INSERT INTO soal (id, ujian_id, urutan, judul, teks, rubrik_json, jawaban_acuan, dibuat_at, diubah_at) VALUES (11, 1, 1, 'S', 'T', ?, 'A', ?, ?)")
    .run(RUBRIK, T0, T0);
  a.db.prepare('INSERT INTO soal_rujukan (soal_id, ujian_id, urutan, pdf_id, halaman) VALUES (11, 1, 1, 1, 3)').run();
  a.db
    .prepare("UPDATE peserta SET status = 'dikumpulkan', cara_kumpul = 'diakhiri_penguji', masuk_pertama_at = ?, dikumpulkan_at = ? WHERE id = 1")
    .run(T0, T0 + 1000);
  a.db.prepare("INSERT INTO jawaban (ujian_id, peserta_id, soal_id, isi, versi, diubah_at) VALUES (1, 1, 11, 'jawaban', 1, ?)").run(T0);
  a.db.prepare("INSERT INTO jawaban_versi (peserta_id, soal_id, versi, isi, alasan, disimpan_at) VALUES (1, 11, 1, 'jawaban', 'berkala', ?)").run(T0);
  a.db.prepare("INSERT INTO event_integritas (ujian_id, peserta_id, jenis, mulai_at) VALUES (1, 1, 'koneksi_putus', ?)").run(T0);
  a.db.prepare("UPDATE ujian SET status = 'penilaian', diakhiri_at = ? WHERE id = 1").run(T0 + 1000);
  a.db
    .prepare("INSERT INTO penilaian (ujian_id, peserta_id, soal_id, skor_json, sumber, status, versi_jawaban, dinilai_at) VALUES (1, 1, 11, '{\"k1\":2}', 'ai', 'draf', 1, ?)")
    .run(T0);
  const run = a.db
    .prepare("INSERT INTO ai_run (ujian_id, penguji_id, model, versi_prompt, status, dibuat_at, selesai_at) VALUES (1, 1, 'claude-haiku-5-5', 'nilai-v1', 'selesai', ?, ?)")
    .run(T0, T0).lastInsertRowid;
  a.db
    .prepare(
      `INSERT INTO ai_pemakaian (ujian_id, run_id, model, token_masuk, token_tulis_cache, token_baca_cache, token_keluar, biaya_mikro_usd, dibuat_at)
       VALUES (1, ?, 'claude-haiku-5-5', 100, 0, 0, 50, 35, ?)`,
    )
    .run(run, T0);
  guru = a.klien();
  assert.equal((await guru.minta('POST', '/api/penguji/masuk', { body: { username: 'guru1', password: PASSWORD_GURU } })).status, 204);
});
afterEach(() => a.berhenti());

describe('hapus ujian permanen', () => {
  test('ujian yang sudah dinilai terhapus beserta semua datanya & berkas PDF; biaya AI tetap tercatat', async () => {
    assert.equal((await guru.minta('DELETE', '/api/ujian/1')).status, 204);
    assert.equal((await guru.minta('GET', '/api/ujian/1')).status, 404);
    for (const tabel of ['soal', 'soal_rujukan', 'peserta', 'jawaban', 'penilaian', 'event_integritas', 'pdf', 'log_aksi', 'ai_run']) {
      assert.equal(hitung(tabel), 0, `${tabel} kosong`);
    }
    assert.equal(a.db.prepare('SELECT COUNT(*) FROM jawaban_versi').pluck().get(), 0);
    assert.equal(existsSync(join(a.uploadDir, BERKAS)), false, 'berkas PDF di disk ikut terhapus');
    assert.deepEqual(a.db.prepare('SELECT ujian_id, run_id, biaya_mikro_usd FROM ai_pemakaian').all(), [{ ujian_id: null, run_id: null, biaya_mikro_usd: 35 }]);
    assert.equal(a.ai.terpakaiBulanIniMikro(), 35, 'batas biaya bulanan tetap menghitung pemakaian ujian yang dihapus');
    // Ujian guru lain tidak tersentuh.
    assert.equal(a.db.prepare('SELECT COUNT(*) FROM ujian WHERE id = 2').pluck().get(), 1);
  });

  test('dirilis juga boleh; dibuka/berjalan ditolak', async () => {
    // Kolom waktu disesuaikan supaya baris tetap lolos CHECK skema untuk status itu.
    for (const [status, dimulai] of [['berlangsung', T0], ['menunggu', null]] as const) {
      a.db.prepare('UPDATE ujian SET status = ?, dimulai_at = ?, detak_at = ?, diakhiri_at = NULL WHERE id = 1').run(status, dimulai, dimulai);
      const r = await guru.minta('DELETE', '/api/ujian/1');
      assert.deepEqual([r.status, (r.body as { error: string }).error], [409, 'status_tidak_sesuai'], status);
    }
    a.db
      .prepare("UPDATE ujian SET status = 'dirilis', dimulai_at = ?, detak_at = ?, diakhiri_at = ?, dirilis_at = ? WHERE id = 1")
      .run(T0, T0, T0 + 1000, T0 + 5000);
    assert.equal((await guru.minta('DELETE', '/api/ujian/1')).status, 204);
  });

  test('ditolak selama antrean AI masih berjalan', async () => {
    a.db.prepare("UPDATE ai_run SET status = 'berjalan', selesai_at = NULL WHERE ujian_id = 1").run();
    const r = await guru.minta('DELETE', '/api/ujian/1');
    assert.deepEqual([r.status, (r.body as { error: string }).error], [409, 'ai_sedang_berjalan']);
    assert.equal(hitung('soal'), 1);
  });

  test('ditolak juga bila run sudah dihentikan tetapi permintaannya masih di penyedia', async () => {
    a.db.prepare("UPDATE ai_run SET status = 'dihentikan', alasan_berhenti = 'guru' WHERE ujian_id = 1").run();
    const run = a.db.prepare('SELECT id FROM ai_run WHERE ujian_id = 1').pluck().get();
    a.db.prepare("INSERT INTO ai_tugas (run_id, ujian_id, peserta_id, soal_id, status, diubah_at) VALUES (?, 1, 1, 11, 'berjalan', ?)").run(run, T0);
    const r = await guru.minta('DELETE', '/api/ujian/1');
    assert.deepEqual([r.status, (r.body as { error: string }).error], [409, 'ai_sedang_berjalan']);
  });

  test('guru lain tidak bisa menghapus', async () => {
    assert.equal((await guru.minta('DELETE', '/api/ujian/2')).status, 404);
  });
});
