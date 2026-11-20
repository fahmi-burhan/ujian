// tests/migrate.test.ts — memastikan runner migrasi berurutan, aman diulang, atomik, dan tidak
// menghapus data anak saat tabel dibangun ulang.
// Dipanggil oleh: `npm test`. Memanggil: server/db/migrate.ts, server/db/connection.ts.
// Setiap tes memakai folder migrasi sementara + database di RAM, jadi tidak menyentuh data asli.
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db/connection.ts';
import type { Db } from '../server/db/connection.ts';
import { listMigrationFiles, runMigrations } from '../server/db/migrate.ts';
import { MIGRATIONS_DIR } from '../server/paths.ts';

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ujian-migrasi-'));
  db = openDatabase(':memory:');
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, sql: string): void {
  writeFileSync(join(dir, name), sql);
}

function tableNames(): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .pluck()
    .all() as string[];
}

test('menjalankan migrasi sesuai urutan nomor, bukan urutan pembuatan berkas', () => {
  write('0002_tambah_kolom.sql', 'ALTER TABLE contoh ADD COLUMN catatan TEXT;');
  write('0001_buat_tabel.sql', 'CREATE TABLE contoh (id INTEGER PRIMARY KEY);');
  assert.deepEqual(runMigrations(db, dir), ['0001_buat_tabel.sql', '0002_tambah_kolom.sql']);
  const columns = db.prepare('SELECT name FROM pragma_table_info(?)').pluck().all('contoh');
  assert.deepEqual(columns, ['id', 'catatan']);
});

test('aman dijalankan ulang: migrasi yang sudah jalan dilewati', () => {
  write('0001_buat_tabel.sql', 'CREATE TABLE contoh (id INTEGER PRIMARY KEY);');
  runMigrations(db, dir);
  assert.deepEqual(runMigrations(db, dir), []);
});

test('migrasi gagal dibatalkan seluruhnya dan tidak dicatat', () => {
  write('0001_rusak.sql', 'CREATE TABLE setengah_jadi (id INTEGER); INI BUKAN SQL;');
  assert.throws(() => runMigrations(db, dir), /0001_rusak\.sql gagal/);
  assert.ok(!tableNames().includes('setengah_jadi'), 'tabel dari migrasi gagal tidak boleh tertinggal');
  assert.equal(db.prepare('SELECT COUNT(*) FROM schema_migrations').pluck().get(), 0);
});

test('menolak berkas yang sudah dijalankan lalu diubah isinya', () => {
  write('0001_buat_tabel.sql', 'CREATE TABLE contoh (id INTEGER PRIMARY KEY);');
  runMigrations(db, dir);
  write('0001_buat_tabel.sql', 'CREATE TABLE contoh (id INTEGER PRIMARY KEY, nama TEXT);');
  assert.throws(() => runMigrations(db, dir), /0001_buat_tabel\.sql sudah dijalankan tetapi isinya berubah/);
});

test('menolak nama berkas .sql yang tidak sesuai pola, berkas lain diabaikan', () => {
  write('README.md', 'catatan');
  write('1_Salah Nama.sql', 'SELECT 1;');
  assert.throws(() => listMigrationFiles(dir), /1_Salah Nama\.sql/);
});

test('menolak dua berkas dengan nomor yang sama', () => {
  write('0002_a.sql', 'SELECT 1;');
  write('0002_b.sql', 'SELECT 1;');
  assert.throws(() => listMigrationFiles(dir), /0002 dipakai dua kali/);
});

test('menolak perintah transaksi & PRAGMA foreign_keys di dalam berkas', () => {
  for (const forbidden of ['BEGIN TRANSACTION;', 'COMMIT;', 'PRAGMA foreign_keys = OFF;', 'SAVEPOINT a;']) {
    const name = '0001_terlarang.sql';
    write(name, `CREATE TABLE t (id INTEGER);\n${forbidden}`);
    assert.throws(() => runMigrations(db, dir), /BEGIN\/COMMIT/, `harus menolak: ${forbidden}`);
  }
});

test('mengizinkan BEGIN...END di dalam trigger dan kata COMMIT di dalam komentar', () => {
  write(
    '0001_trigger.sql',
    `-- catatan: jangan COMMIT manual
     CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0);
     CREATE TABLE commit_log (id INTEGER PRIMARY KEY);
     CREATE TRIGGER t_jaga BEFORE DELETE ON t
     BEGIN
       SELECT RAISE(ROLLBACK, 'tidak boleh dihapus');
     END;`,
  );
  assert.deepEqual(runMigrations(db, dir), ['0001_trigger.sql']);
});

test('membangun ulang tabel induk TIDAK menghapus baris anak ber-ON DELETE CASCADE', () => {
  write(
    '0001_awal.sql',
    `CREATE TABLE soal (id INTEGER PRIMARY KEY, teks TEXT NOT NULL);
     CREATE TABLE jawaban (id INTEGER PRIMARY KEY,
       soal_id INTEGER NOT NULL REFERENCES soal(id) ON DELETE CASCADE, isi TEXT);`,
  );
  runMigrations(db, dir);
  db.prepare("INSERT INTO soal (id, teks) VALUES (1, 'Soal 1')").run();
  db.prepare("INSERT INTO jawaban (soal_id, isi) VALUES (1, 'Jawaban peserta')").run();

  // Pola resmi SQLite untuk mengubah definisi kolom.
  write(
    '0002_bangun_ulang_soal.sql',
    `CREATE TABLE soal_baru (id INTEGER PRIMARY KEY, teks TEXT NOT NULL, bobot INTEGER NOT NULL DEFAULT 1);
     INSERT INTO soal_baru (id, teks) SELECT id, teks FROM soal;
     DROP TABLE soal;
     ALTER TABLE soal_baru RENAME TO soal;`,
  );
  assert.deepEqual(runMigrations(db, dir), ['0002_bangun_ulang_soal.sql']);
  assert.equal(db.prepare('SELECT COUNT(*) FROM jawaban').pluck().get(), 1);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1, 'foreign key harus menyala kembali');
});

test('migrasi yang meninggalkan pelanggaran foreign key dibatalkan', () => {
  write(
    '0001_awal.sql',
    `CREATE TABLE soal (id INTEGER PRIMARY KEY);
     CREATE TABLE jawaban (id INTEGER PRIMARY KEY, soal_id INTEGER NOT NULL REFERENCES soal(id));`,
  );
  runMigrations(db, dir);
  write('0002_yatim.sql', 'INSERT INTO jawaban (soal_id) VALUES (999);');
  assert.throws(() => runMigrations(db, dir), /melanggar foreign key/);
  assert.equal(db.prepare('SELECT COUNT(*) FROM jawaban').pluck().get(), 0);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
});

test('folder migrations/ milik proyek bisa dibaca', () => {
  assert.doesNotThrow(() => listMigrationFiles(MIGRATIONS_DIR));
});

test('koneksi menyalakan foreign key dan WAL (untuk berkas, bukan RAM)', () => {
  const fileDb = openDatabase(join(dir, 'sub', 'uji.db'));
  try {
    assert.equal(fileDb.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(fileDb.pragma('journal_mode', { simple: true }), 'wal');
  } finally {
    fileDb.close();
  }
});
