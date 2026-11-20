// server/dev.ts — titik masuk DEVELOPMENT: `npm run dev` di laptop.
// Dipanggil oleh: Node (script "dev" di package.json, dengan --watch agar restart saat kode berubah).
// Memanggil: server/start.ts (yang memasang Vite sebagai middleware untuk hot reload).
// Jangan jalankan berkas ini di VPS: Vite dev server tidak dirancang untuk diakses publik.
import { startServer } from './start.ts';

await startServer('development');
