// server/paths.ts — daftar lokasi folder penting proyek, dihitung dari letak berkas ini.
// Dipanggil oleh: server/config.ts, server/start.ts, server/app.ts, server/db/migrate-cli.ts, tes.
// Memanggil: modul bawaan Node saja.
// Alasan: path dihitung dari import.meta.url, bukan dari folder tempat perintah dijalankan,
// sehingga `npm start` dari folder mana pun (termasuk lewat pm2 di VPS) tetap menemukan berkasnya.
// Hal yang sama berlaku untuk .env dan DB_PATH (lihat server/config.ts).
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);

export const ROOT_DIR = fileURLToPath(root);
export const MIGRATIONS_DIR = fileURLToPath(new URL('migrations/', root));
export const DIST_DIR = fileURLToPath(new URL('dist/', root));
export const CLIENT_DIR = fileURLToPath(new URL('client/', root));
export const SHARED_DIR = fileURLToPath(new URL('shared/', root));
export const NODE_MODULES_DIR = fileURLToPath(new URL('node_modules/', root));
export const VITE_CONFIG_FILE = fileURLToPath(new URL('vite.config.ts', root));
