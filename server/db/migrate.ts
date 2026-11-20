// server/db/migrate.ts — menjalankan berkas migrasi SQL (migrations/NNNN_nama.sql) secara berurutan.
// Dipanggil oleh: server/start.ts (otomatis setiap server start), server/db/migrate-cli.ts, tes.
// Memanggil: better-sqlite3 (lewat objek Db), node:fs, node:crypto.
// Alasan desain:
// - Setiap migrasi dijalankan di dalam transaksi: bila satu perintah gagal, seluruh isi berkas
//   dibatalkan sehingga database tidak tertinggal setengah jadi.
// - Nama dan sidik jari (SHA-256) berkas yang sudah dijalankan dicatat di schema_migrations.
//   Berkas lama yang diubah diam-diam akan DITOLAK, karena perubahannya tidak akan pernah
//   sampai ke database yang sudah memigrasinya (laptop vs VPS jadi berbeda).
// - Foreign key dimatikan SELAMA migrasi lalu diperiksa (foreign_key_check) sebelum commit.
//   Tanpa ini, pola "bangun ulang tabel" SQLite (buat tabel baru → salin → DROP tabel lama →
//   rename) akan ikut menghapus baris anak ber-ON DELETE CASCADE, mis. seluruh jawaban peserta.
//   PRAGMA foreign_keys tidak berpengaruh di dalam transaksi, jadi diatur di luar transaksi.
// - Transaksi IMMEDIATE + pemeriksaan ulang di dalamnya: bila dua proses memigrasi bersamaan
//   (mis. `npm run migrate` saat pm2 restart), proses kedua menunggu lalu melewati berkas itu.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './connection.ts';

const MIGRATION_NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

// Perintah transaksi & pengaturan foreign key diatur oleh runner, jadi dilarang di dalam berkas.
// COMMIT di dalam berkas, misalnya, bisa membuat migrasi sudah diterapkan tetapi belum tercatat.
// BEGIN...END di dalam CREATE TRIGGER dan RAISE(ROLLBACK, ...) tetap diizinkan.
const FORBIDDEN_STATEMENT =
  /\b(BEGIN\s+(DEFERRED|IMMEDIATE|EXCLUSIVE|TRANSACTION)\b|BEGIN\s*;|COMMIT\b|END\s+TRANSACTION\b|ROLLBACK\s*;|ROLLBACK\s+TRANSACTION\b|SAVEPOINT\b|RELEASE\b|PRAGMA\s+foreign_keys)/i;

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

function checksumOf(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export function listMigrationFiles(dir: string): string[] {
  const sqlFiles = readdirSync(dir).filter((file) => file.endsWith('.sql'));
  const invalid = sqlFiles.filter((file) => !MIGRATION_NAME.test(file));
  if (invalid.length > 0) {
    throw new Error(
      `Nama berkas migrasi tidak sesuai pola NNNN_nama_huruf_kecil.sql: ${invalid.join(', ')}`,
    );
  }
  // Dua berkas dengan nomor sama membuat urutan bergantung pada abjad nama; ditolak agar jelas.
  const seen = new Map<string, string>();
  for (const file of sqlFiles) {
    const number = file.slice(0, 4);
    const other = seen.get(number);
    if (other) throw new Error(`Nomor migrasi ${number} dipakai dua kali: ${other} dan ${file}`);
    seen.set(number, file);
  }
  // Urutan abjad = urutan nomor, karena nomornya selalu 4 digit (0001, 0002, ...).
  return sqlFiles.sort();
}

export function runMigrations(db: Db, dir: string): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);

  const findApplied = db.prepare('SELECT checksum FROM schema_migrations WHERE name = ?').pluck();
  const record = db.prepare(
    'INSERT INTO schema_migrations (name, checksum, applied_at) VALUES (?, ?, ?)',
  );

  const appliedNow: string[] = [];
  for (const file of listMigrationFiles(dir)) {
    const sql = readFileSync(join(dir, file), 'utf8');
    const checksum = checksumOf(sql);

    const previous = findApplied.get(file) as string | undefined;
    if (previous !== undefined) {
      if (previous !== checksum) {
        throw new Error(
          `Berkas migrasi ${file} sudah dijalankan tetapi isinya berubah. ` +
            'Kembalikan isinya dan buat berkas migrasi BARU untuk perubahan itu.',
        );
      }
      continue;
    }

    if (FORBIDDEN_STATEMENT.test(stripSqlComments(sql))) {
      throw new Error(
        `Migrasi ${file} berisi BEGIN/COMMIT/ROLLBACK/SAVEPOINT/PRAGMA foreign_keys. ` +
          'Hapus perintah itu; transaksi dan foreign key diatur otomatis oleh runner.',
      );
    }

    const applyOne = db.transaction((): boolean => {
      // Periksa ulang di dalam transaksi: proses lain mungkin baru saja menjalankannya.
      if (findApplied.get(file) !== undefined) return false;
      db.exec(sql);
      const violations = db.pragma('foreign_key_check') as unknown[];
      if (violations.length > 0) {
        throw new Error(`hasilnya melanggar foreign key pada ${violations.length} baris`);
      }
      record.run(file, checksum, Date.now());
      return true;
    });

    db.pragma('foreign_keys = OFF');
    try {
      if (applyOne.immediate()) appliedNow.push(file);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Migrasi ${file} gagal dan dibatalkan: ${reason}`);
    } finally {
      // Selalu dinyalakan kembali, termasuk bila migrasi gagal.
      db.pragma('foreign_keys = ON');
    }
  }
  return appliedNow;
}
