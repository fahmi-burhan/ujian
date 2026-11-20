// server/start.ts — urutan menyalakan server: .env → konfigurasi → database → migrasi → Express → port.
// Dipanggil oleh: server/main.ts (`npm start`, production) dan server/dev.ts (`npm run dev`).
// Memanggil: config.ts, db/connection.ts, db/migrate.ts, app.ts.
// Alasan migrasi dijalankan otomatis saat start: database selalu sesuai versi kode,
// dan migrasi aman diulang (yang sudah jalan dilewati).
import { createServer } from 'node:http';
import { createApp } from './app.ts';
import { hapusPerangkatKedaluwarsa } from './auth/perangkat-dikenal.ts';
import { hapusSesiLama } from './auth/sesi.ts';
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
  if (mode === 'production' && config.originPublik === null) {
    // Gagal saat start lebih baik daripada semua login ditolak 403 saat ujian berlangsung.
    throw new Error(
      'ORIGIN_PUBLIK wajib diisi di .env untuk production, mis. ORIGIN_PUBLIK=https://ujian.domain-anda.id ' +
        '(untuk mencoba di laptop: ORIGIN_PUBLIK=http://127.0.0.1:8132, lalu buka PERSIS alamat itu di browser).',
    );
  }
  console.log(`Origin publik: ${config.originPublik ?? '(tidak diisi, mengikuti alamat permintaan)'}`);
  if (mode === 'production' && !config.trustProxy) {
    console.warn(
      'PERINGATAN: TRUST_PROXY=false. Di VPS (di belakang nginx) isi TRUST_PROXY=true di .env, ' +
        'kalau tidak, alamat IP pengunjung terbaca sebagai alamat nginx. (Cek Origin dan cookie Secure ' +
        'tidak terpengaruh karena memakai ORIGIN_PUBLIK.)',
    );
  }

  const db = openDatabase(config.dbPath);
  // Path absolut dicetak agar mudah memastikan server memakai database yang benar.
  console.log(`Database: ${config.dbPath}`);
  const applied = runMigrations(db, MIGRATIONS_DIR);
  if (applied.length > 0) {
    console.log(`Migrasi baru dijalankan: ${applied.join(', ')}`);
  }
  const jumlahPenguji = db.prepare('SELECT COUNT(*) FROM penguji').pluck().get() as number;
  if (jumlahPenguji === 0) {
    console.warn('Belum ada akun guru. Buat dengan: npm run penguji:buat');
  }

  // Sesi kedaluwarsa dibersihkan saat start lalu tiap jam, agar tabel sesi tidak membengkak.
  // Perangkat guru yang kedaluwarsa (90 hari tanpa login) ikut dibersihkan.
  const bersihkan = (): void => {
    hapusSesiLama(db, Date.now());
    hapusPerangkatKedaluwarsa(db, Date.now());
  };
  bersihkan();
  const pembersih = setInterval(bersihkan, 60 * 60 * 1000);
  pembersih.unref();

  // Server HTTP dibuat lebih dulu supaya Vite (mode dev) bisa menumpang di port yang sama
  // untuk hot reload, alih-alih membuka port kedua.
  const server = createServer();
  const { app, close, pengecek } = await createApp({ config, db, httpServer: server });
  server.on('request', app);

  // Pengecek ujian: sekali SEBELUM menerima permintaan (ujian yang sedang berlangsung saat server mati
  // langsung dijeda otomatis, docs/DESAIN.md §3), lalu tiap detik.
  pengecek();
  const jamPengecek = setInterval(() => {
    try {
      pengecek();
    } catch (galat) {
      // Satu putaran yang gagal (mis. disk penuh sesaat) tidak boleh menghentikan putaran berikutnya.
      console.error('[pengecek] gagal:', galat);
    }
  }, 1000);

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
    clearInterval(jamPengecek);
    server.close();
    await close();
    db.close();
    process.exit(0);
  }
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
