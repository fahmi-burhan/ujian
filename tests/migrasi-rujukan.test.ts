// tests/migrasi-rujukan.test.ts — migrasi 0005 (banyak buku per soal) di atas database yang SUDAH berisi data:
// rujukan lama (soal.pdf_id/pdf_halaman) pindah ke soal_rujukan, dan data anak soal (jawaban, penilaian, ai_tugas)
// tetap utuh & tetap terikat FK setelah tabel soal dibangun ulang.
// Dipanggil oleh: `npm test`. Memanggil: server/db/migrate.ts, server/db/connection.ts, migrasi asli di migrations/.
// Memakai salinan migrasi 0001–0004 di folder sementara, mengisi data seperti di VPS, lalu menambah 0005.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db/connection.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { MIGRATIONS_DIR } from '../server/paths.ts';

test('0005: rujukan lama dipindah, data anak soal utuh, FK tetap berlaku', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ujian-0005-'));
  const db = openDatabase(':memory:');
  try {
    const semua = readdirSync(MIGRATIONS_DIR).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort();
    for (const n of semua.filter((n) => n < '0005')) copyFileSync(join(MIGRATIONS_DIR, n), join(dir, n));
    runMigrations(db, dir);

    const T = 1_795_000_000_000;
    const run = (sql: string, ...p: unknown[]) => db.prepare(sql).run(...p);
    run("INSERT INTO penguji (id, username, nama, password_hash, dibuat_at) VALUES (1, 'guru1', 'Guru', 'scrypt$contoh', ?)", T);
    run("INSERT INTO ujian (id, penguji_id, judul, kode, durasi_menit, status, dibuat_at, diubah_at) VALUES (1, 1, 'U', 'ABC234', 60, 'draf', ?, ?)", T, T);
    run("INSERT INTO pdf (id, ujian_id, nama_tampil, nama_berkas, ukuran_byte, sha256, diunggah_at) VALUES (5, 1, 'Buku', 'b.pdf', 1, ?, ?)", 'a'.repeat(64), T);
    run("INSERT INTO soal (id, ujian_id, urutan, judul, teks, pdf_id, pdf_halaman, dibuat_at, diubah_at) VALUES (10, 1, 1, 'S1', 'T', 5, 42, ?, ?)", T, T);
    run("INSERT INTO soal (id, ujian_id, urutan, judul, teks, dibuat_at, diubah_at) VALUES (11, 1, 2, 'S2', 'T', ?, ?)", T, T);
    run("INSERT INTO peserta (id, ujian_id, nama, id_anonim, dibuat_at) VALUES (1, 1, 'Budi', 'anon', ?)", T);
    run("INSERT INTO jawaban (ujian_id, peserta_id, soal_id, isi, versi, diubah_at) VALUES (1, 1, 10, 'jawab', 1, ?)", T);
    run(
      "INSERT INTO penilaian (ujian_id, peserta_id, soal_id, skor_json, sumber, status, versi_jawaban, dinilai_at) VALUES (1, 1, 10, '{}', 'manual', 'draf', 1, ?)",
      T,
    );

    run(
      `INSERT INTO jawaban_terlambat (ujian_id, peserta_id, soal_id, isi, versi_dasar, id_simpan, diterima_at, alasan)
       VALUES (1, 1, 10, 'telat', 0, 'simpan-0001', ?, 'waktu_habis')`,
      T,
    );
    const runAi = run(
      "INSERT INTO ai_run (ujian_id, penguji_id, model, versi_prompt, status, dibuat_at, selesai_at) VALUES (1, 1, 'claude-haiku-5-5', 'nilai-v1', 'selesai', ?, ?)",
      T,
      T,
    ).lastInsertRowid;
    run("INSERT INTO ai_tugas (run_id, ujian_id, peserta_id, soal_id, status, diubah_at) VALUES (?, 1, 1, 10, 'perlu_manual', ?)", runAi, T);

    for (const n of semua.filter((n) => n >= '0005')) copyFileSync(join(MIGRATIONS_DIR, n), join(dir, n));
    assert.deepEqual(runMigrations(db, dir), semua.filter((n) => n >= '0005'));

    assert.deepEqual(db.prepare('SELECT soal_id, urutan, pdf_id, halaman FROM soal_rujukan').all(), [{ soal_id: 10, urutan: 1, pdf_id: 5, halaman: 42 }]);
    const kolom = db.prepare("SELECT name FROM pragma_table_info('soal')").pluck().all();
    assert.ok(!kolom.includes('pdf_id') && !kolom.includes('pdf_halaman'), 'kolom lama sudah hilang');
    assert.equal(db.prepare('SELECT COUNT(*) FROM soal').pluck().get(), 2);
    assert.equal(db.prepare('SELECT isi FROM jawaban WHERE soal_id = 10').pluck().get(), 'jawab');
    assert.equal(db.prepare('SELECT COUNT(*) FROM penilaian WHERE soal_id = 10').pluck().get(), 1);
    assert.equal(db.prepare('SELECT COUNT(*) FROM jawaban_terlambat WHERE soal_id = 10').pluck().get(), 1);
    assert.equal(db.prepare('SELECT COUNT(*) FROM ai_tugas WHERE soal_id = 10').pluck().get(), 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);

    // FK anak masih menunjuk tabel soal yang baru: jawaban untuk soal yang tidak ada tetap ditolak, dan menghapus soal
    // ikut menghapus anaknya.
    assert.throws(() => run("INSERT INTO jawaban (ujian_id, peserta_id, soal_id, isi, diubah_at) VALUES (1, 1, 99, 'x', ?)", T), /FOREIGN KEY/);
    run('DELETE FROM soal WHERE id = 10');
    assert.equal(db.prepare('SELECT COUNT(*) FROM jawaban').pluck().get(), 0);
    assert.equal(db.prepare('SELECT COUNT(*) FROM jawaban_terlambat').pluck().get(), 0);
    assert.equal(db.prepare('SELECT COUNT(*) FROM ai_tugas').pluck().get(), 0);
    assert.equal(db.prepare('SELECT COUNT(*) FROM soal_rujukan').pluck().get(), 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
