// server/start.ts — urutan menyalakan server: .env → konfigurasi → database → migrasi → Express → port.
// Dipanggil oleh: server/main.ts (`npm start`, production) dan server/dev.ts (`npm run dev`).
// Memanggil: config.ts, db/connection.ts, db/migrate.ts, app.ts.
// Alasan migrasi dijalankan otomatis saat start: database selalu sesuai versi kode,
// dan migrasi aman diulang (yang sudah jalan dilewati).
import { createServer } from 'node:http';
import { createApp } from './app.ts';
import { loadConfig, loadEnvFileFromRoot } from './config.ts';
import { openDatabase } from './db/connection.ts';
import { runMigrations } from './db/migrate.ts';
import { MIGRATIONS_DIR } from './paths.ts';

export async function startServer(mode: 'development' | 'production'): Promise<void> {
  // NODE_ENV diset SEBELUM .env dimuat dan sebelum Express dibuat: Express membaca NODE_ENV
  // (production = pesan error ringkas), dan loadEnvFile tidak menimpa nilai yang sudah ada.
  process.env.NODE_ENV = mode;
  const envFile = loadEnvFileFromRoot();
  const config = loadConfig(process.env, { mode });

  console.log(`Mode: ${mode}. Berkas .env: ${envFile ?? 'tidak ada (memakai nilai bawaan)'}`);
  if (mode === 'production' && !config.trustProxy) {
    console.warn(
      'PERINGATAN: TRUST_PROXY=false. Di VPS (di belakang nginx) isi TRUST_PROXY=true di .env, ' +
        'kalau tidak, alamat IP peserta dan status HTTPS terbaca salah.',
    );
  }

  const db = openDatabase(config.dbPath);
  // Path absolut dicetak agar mudah memastikan server memakai database yang benar.
  console.log(`Database: ${config.dbPath}`);
  const applied = runMigrations(db, MIGRATIONS_DIR);
  if (applied.length > 0) {
    console.log(`Migrasi baru dijalankan: ${applied.join(', ')}`);
  }

  // Server HTTP dibuat lebih dulu supaya Vite (mode dev) bisa menumpang di port yang sama
  // untuk hot reload, alih-alih membuka port kedua.
  const server = createServer();
  const { app, close } = await createApp({ config, db, httpServer: server });
  server.on('request', app);

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${config.port} sudah dipakai program lain. Ubah PORT di .env atau tutup program itu.`);
    } else {
      console.error('Server gagal dibuka:', error);
    }
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    console.log(`Server ujian berjalan di http://${config.host}:${config.port}`);
  });

  // Saat dihentikan (Ctrl+C di terminal, atau pm2 restart di VPS): tutup dengan rapi
  // supaya database tertutup bersih dan tidak ada tulisan jawaban yang terpotong.
  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Menerima ${signal}, server dihentikan...`);
    server.close();
    await close();
    db.close();
    process.exit(0);
  }
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
