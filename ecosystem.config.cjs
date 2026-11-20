// ecosystem.config.cjs — konfigurasi pm2 untuk menjalankan aplikasi di VPS (docs/DEPLOY.md).
// Dipanggil oleh: `pm2 start ecosystem.config.cjs` di folder aplikasi pada VPS.
// Memanggil: `npm start` (server/main.ts, mode production).
// Berakhiran .cjs karena package.json memakai "type": "module", sedangkan pm2 membaca berkas ini sebagai CommonJS.
// Tidak berisi rahasia; semua pengaturan (port, origin, path DB) ada di .env.
module.exports = {
  apps: [
    {
      name: 'ujian',
      // Lewat npm, bukan `server/main.ts` langsung: pm2 bisa memilih interpreter lain untuk berkas .ts.
      script: 'npm',
      args: 'start',
      cwd: __dirname,
      // WAJIB satu proses (mode fork): koneksi SSE ada di memori proses, dan SQLite hanya punya satu penulis.
      // Jangan diubah ke mode cluster / instances > 1.
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      // Beri waktu server menutup database dengan rapi saat restart (SIGINT → shutdown di server/start.ts).
      kill_timeout: 5000,
      // Tidak memantau perubahan berkas: deploy ulang dilakukan dengan `pm2 restart ujian` setelah build.
      watch: false,
      time: true,
    },
  ],
};
