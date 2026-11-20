// server/main.ts — titik masuk PRODUCTION: `npm start` (di VPS lewat pm2).
// Dipanggil oleh: Node (script "start" di package.json).
// Memanggil: server/start.ts.
// Mode sengaja ditulis tetap di sini, bukan dibaca dari .env, agar salah konfigurasi
// tidak pernah menyalakan Vite dev server di internet.
import { startServer } from './start.ts';

await startServer('production');
