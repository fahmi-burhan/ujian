// vite.config.ts — konfigurasi Vite untuk membangun antarmuka Vue.
// Dipanggil oleh: `npm run build` (menghasilkan dist/) dan server/app.ts saat mode development
// (Vite dijalankan sebagai middleware di dalam Express, jadi cukup satu port dan satu perintah).
// Memanggil: plugin Vue (mengompilasi berkas .vue) dan plugin Tailwind (memproses CSS + daisyUI).
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Semua kode klien ada di client/, terpisah dari server/ agar tidak tercampur.
  root: fileURLToPath(new URL('./client', import.meta.url)),
  plugins: [vue(), tailwindcss()],
  build: {
    // Hasil build diletakkan di dist/ di akar proyek; Express menyajikannya di production.
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
  },
});
