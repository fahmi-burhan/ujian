// server/db/connection.ts — membuka berkas database SQLite dengan pengaturan yang aman untuk ujian.
// Dipanggil oleh: server/main.ts, server/db/migrate-cli.ts, tes.
// Memanggil: better-sqlite3.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

export function openDatabase(path: string): Db {
  // ':memory:' = database sementara di RAM (dipakai tes); selain itu pastikan foldernya ada.
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);

  // WAL: pembaca (dasbor penguji, proyektor) tidak terhalang oleh penulis (autosave jawaban).
  db.pragma('journal_mode = WAL');
  // SQLite secara bawaan TIDAK menegakkan foreign key; harus dinyalakan per koneksi.
  db.pragma('foreign_keys = ON');
  // Bila database sedang dikunci sesaat, tunggu hingga 5 detik alih-alih langsung gagal.
  db.pragma('busy_timeout = 5000');
  // synchronous dibiarkan FULL (bawaan): sedikit lebih lambat, tetapi jawaban yang sudah
  // dikonfirmasi "tersimpan" tidak hilang walau VPS mati mendadak. Untuk 30 peserta, selisih
  // kecepatannya tidak terasa.
  db.pragma('synchronous = FULL');
  return db;
}
