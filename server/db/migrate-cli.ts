// server/db/migrate-cli.ts — perintah `npm run migrate` untuk menjalankan migrasi tanpa menyalakan server.
// Dipanggil oleh: script "migrate" di package.json.
// Memanggil: server/config.ts, server/db/connection.ts, server/db/migrate.ts.
// Kegunaan: memeriksa migrasi baru sebelum deploy, atau menyiapkan database di VPS.
import { loadConfig, loadEnvFileFromRoot } from '../config.ts';
import { MIGRATIONS_DIR } from '../paths.ts';
import { openDatabase } from './connection.ts';
import { runMigrations } from './migrate.ts';

loadEnvFileFromRoot();
// Mode tidak berpengaruh pada migrasi; yang dipakai hanya DB_PATH.
const config = loadConfig(process.env, { mode: 'production' });
const db = openDatabase(config.dbPath);
try {
  const applied = runMigrations(db, MIGRATIONS_DIR);
  if (applied.length === 0) {
    console.log(`Database ${config.dbPath} sudah terbaru; tidak ada migrasi baru.`);
  } else {
    console.log(`Migrasi dijalankan pada ${config.dbPath}:`);
    for (const name of applied) console.log(`  - ${name}`);
  }
} finally {
  db.close();
}
