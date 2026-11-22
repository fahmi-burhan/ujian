// server/app.ts — merakit aplikasi Express: header keamanan, rute API, penyajian antarmuka Vue,
// dan penangan error.
// Dipanggil oleh: server/start.ts (server sungguhan) dan tes (mode 'test' atau 'production' dengan dist palsu).
// Memanggil: server/routes/*, Vite (hanya mode development), folder dist/ (hanya mode production).
// Alasan memisahkan app.ts dari start.ts: tes bisa membuat aplikasi dengan database di RAM
// tanpa membuka port tetap atau menjalankan Vite.
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { extname, join } from 'node:path';
import express from 'express';
import type { ErrorRequestHandler, Express } from 'express';
import type { Config } from './config.ts';
import type { Db } from './db/connection.ts';
import { buatCekAsal, wajibSesi } from './auth/penjaga.ts';
import type { Jam } from './auth/penjaga.ts';
import { GalatHttp } from './http.ts';
import { OPSI_KEAMANAN_BAWAAN } from './konteks.ts';
import type { Konteks, OpsiKeamanan } from './konteks.ts';
import { CLIENT_DIR, DIST_DIR, NODE_MODULES_DIR, SHARED_DIR, VITE_CONFIG_FILE } from './paths.ts';
import { healthRouter } from './routes/health.ts';
import { pengujiAuthRouter } from './routes/penguji-auth.ts';
import { pesertaAuthRouter } from './routes/peserta-auth.ts';
import { proyektorRouter } from './routes/proyektor.ts';
import { pdfRouter } from './routes/pdf.ts';
import { pesertaGuruRouter } from './routes/peserta-guru.ts';
import { soalRouter } from './routes/soal.ts';
import { eventRouter } from './routes/event.ts';
import { pantauRouter } from './routes/pantau.ts';
import { ujianRouter } from './routes/ujian.ts';
import { ujianDuplikatRouter } from './routes/ujian-duplikat.ts';
import { ujianAdminRouter } from './routes/ujian-admin.ts';
import { ujianJalanRouter } from './routes/ujian-jalan.ts';
import { pesertaUjianRouter } from './routes/peserta-ujian.ts';
import { jawabanRouter } from './routes/jawaban.ts';
import { buatPengecek } from './pengecek.ts';
import { buatHubSse } from './sse.ts';

export type AppDeps = {
  config: Config;
  db: Db;
  // Wajib di mode development: Vite menumpang di server ini untuk hot reload (satu port saja).
  httpServer?: Server;
  // Hanya untuk tes: folder hasil build pengganti dist/.
  distDir?: string;
  // Hanya untuk tes: jam palsu (memajukan waktu) dan opsi keamanan (jeda/batas lebih kecil).
  jam?: Jam;
  opsi?: Partial<OpsiKeamanan>;
};
// `pengecek` dijalankan start.ts tiap detik (detak, jeda otomatis, kumpul otomatis); tes memanggilnya langsung.
export type CreatedApp = { app: Express; close: () => Promise<void>; pengecek: () => void };

// Kode error tetap untuk kesalahan dari sisi klien. Klien (mis. autosave) memakai kode ini untuk
// memutuskan: kirim ulang (koneksi putus) atau berhenti dan beri tahu peserta (jawaban terlalu besar).
function clientErrorCode(type: unknown, status: number): string {
  if (type === 'entity.too.large') return 'terlalu_besar';
  if (type === 'entity.parse.failed') return 'json_tidak_valid';
  if (type === 'request.aborted') return 'permintaan_terputus';
  if (status === 404) return 'tidak_ditemukan';
  return 'permintaan_tidak_valid';
}

// Content-Security-Policy production:
// - script-src 'self' + 'wasm-unsafe-eval': hanya skrip dari server ini; wasm dibutuhkan dekoder gambar PDF.js.
//   Tanpa 'unsafe-inline'/'unsafe-eval', skrip sisipan (XSS) tidak bisa jalan.
// - style-src 'unsafe-inline': Vue & lapisan teks PDF.js memasang atribut style (posisi teks), bukan skrip.
// - img/font data: & blob:: gambar & font yang dibuat PDF.js di memori.
// - connect-src 'self': fetch, SSE, dan unduhan PDF hanya ke server ini.
export const CSP_PRODUCTION = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export async function createApp({
  config,
  db,
  httpServer,
  distDir = DIST_DIR,
  jam = Date.now,
  opsi = {},
}: AppDeps): Promise<CreatedApp> {
  const konteks: Konteks = {
    db,
    jam,
    opsi: { ...OPSI_KEAMANAN_BAWAAN, ...opsi },
    originPublik: config.originPublik,
    uploadDir: config.uploadDir,
    sse: buatHubSse(jam),
  };
  const pengecek = buatPengecek(konteks);
  const app = express();
  // Tidak memberi tahu dunia luar bahwa server memakai Express.
  app.disable('x-powered-by');
  if (config.trustProxy) {
    // Percayai tepat SATU proxy (nginx di VPS) untuk alamat IP asli & status HTTPS.
    app.set('trust proxy', 1);
  }

  // Header keamanan dasar untuk SEMUA respons, tanpa dependensi tambahan:
  // - nosniff: browser tidak menebak jenis berkas (mencegah teks dianggap skrip).
  // - frame: halaman ujian tidak bisa disisipkan di iframe situs lain (clickjacking).
  // - no-referrer: alamat halaman ujian tidak bocor ke situs lain.
  // - CSP: di production hanya skrip/berkas dari server ini sendiri yang boleh jalan (lihat CSP_PRODUCTION).
  //   Mode development memakai CSP longgar karena Vite menyuntikkan skrip hot reload.
  const csp = config.mode === 'development' ? "frame-ancestors 'none'" : CSP_PRODUCTION;
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': csp,
      'Referrer-Policy': 'no-referrer',
    });
    next();
  });

  // Berkas pendukung PDF.js (peta karakter, font standar, dekoder gambar wasm, profil warna) disajikan
  // langsung dari paket npm, tanpa CDN. Dipakai pembaca PDF siswa untuk buku yang fontnya tidak tertanam.
  for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
    app.use(
      `/pdfjs/${folder}`,
      express.static(join(NODE_MODULES_DIR, 'pdfjs-dist', folder), { fallthrough: false, maxAge: '7d', index: false }),
    );
  }

  // Jawaban esai dikirim sebagai JSON; 1 MB jauh di atas panjang esai normal,
  // tetapi tetap membatasi kiriman raksasa yang membebani server.
  app.use(express.json({ limit: '1mb' }));

  // Semua permintaan pengubah data ke /api wajib berasal dari halaman aplikasi ini sendiri (CSRF).
  app.use('/api', buatCekAsal(config.originPublik));
  app.use('/api', healthRouter(db));
  app.use('/api', pengujiAuthRouter(konteks));
  app.use('/api', pesertaAuthRouter(konteks));
  app.use('/api', proyektorRouter(konteks));
  // Semua /api/ujian/** adalah rute guru: sesi guru dicek SEKALI di sini, lalu tiap rute memeriksa
  // kepemilikan ujian (server/routes/milik.ts). Sesi peserta/proyektor tidak bisa lewat.
  app.use('/api/ujian', wajibSesi(db, jam, 'penguji'));
  app.use('/api', ujianRouter(konteks));
  app.use('/api', ujianDuplikatRouter(konteks));
  app.use('/api', soalRouter(konteks));
  app.use('/api', pdfRouter(konteks));
  app.use('/api', pesertaGuruRouter(konteks));
  app.use('/api', ujianAdminRouter(konteks));
  app.use('/api', ujianJalanRouter(konteks));
  app.use('/api', pantauRouter(konteks));
  // Rute siswa setelah masuk: wajib sesi peserta (dipasang di dalam pesertaUjianRouter untuk /api/peserta).
  app.use('/api', pesertaUjianRouter(konteks));
  app.use('/api', eventRouter(konteks));
  app.use('/api', jawabanRouter(konteks));
  // Rute /api yang tidak dikenal dijawab JSON 404, bukan halaman HTML aplikasi.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'tidak_ditemukan' });
  });

  let closeFrontend = async (): Promise<void> => {};
  if (config.mode === 'development') {
    if (!httpServer) throw new Error('Mode development membutuhkan httpServer untuk hot reload Vite.');
    // Vite dimuat secara dinamis supaya mode production tidak memuat Vite sama sekali.
    const { createServer } = await import('vite');
    const vite = await createServer({
      configFile: VITE_CONFIG_FILE,
      appType: 'spa',
      server: {
        middlewareMode: true,
        // Hot reload memakai port server ini, bukan port kedua.
        hmr: { server: httpServer },
        // Vite hanya boleh membaca kode klien, kode bersama, dan paket npm. Folder lain
        // (data/ berisi database, uploads/ berisi PDF, .env) tertutup bagi browser.
        fs: { strict: true, allow: [CLIENT_DIR, SHARED_DIR, NODE_MODULES_DIR] },
      },
    });
    app.use(vite.middlewares);
    closeFrontend = () => vite.close();
  } else if (config.mode === 'production') {
    const indexHtml = join(distDir, 'index.html');
    if (!existsSync(indexHtml)) {
      throw new Error('Folder dist/ belum ada. Jalankan `npm run build` sebelum `npm start`.');
    }
    // Berkas hasil build Vite memakai nama ber-hash, jadi aman di-cache lama oleh browser.
    // fallthrough: false → aset yang tidak ada dijawab 404, bukan index.html. Ini penting setelah
    // deploy ulang: tab lama yang meminta berkas versi lama mendapat error jelas, bukan HTML.
    app.use(
      '/assets',
      express.static(join(distDir, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }),
    );
    app.use(express.static(distDir, { index: false }));
    // Alamat halaman (tanpa ekstensi berkas) dijawab index.html; Vue yang menentukan isi halamannya.
    app.get('/{*halaman}', (req, res) => {
      if (extname(req.path) !== '') {
        res.status(404).json({ error: 'tidak_ditemukan' });
        return;
      }
      res.set('Cache-Control', 'no-cache').sendFile(indexHtml);
    });
  }

  // Penangan error terakhir.
  // - Kesalahan dari klien (4xx, mis. JSON rusak, kiriman terlalu besar, koneksi putus) dijawab
  //   dengan status aslinya dan dicatat SATU baris saja. Isi request TIDAK dicatat karena bisa
  //   berisi token peserta, password, atau jawaban.
  // - Kesalahan server (5xx) dicatat dengan stack trace, tetapi detailnya tidak dikirim ke klien.
  // - 503 server_sibuk (antrean login penuh) bisa muncul ribuan kali saat ada yang membanjiri login,
  //   jadi diringkas: satu baris di akhir setiap jendela 10 detik beserta jumlahnya.
  let sibukTertahan = 0;
  let sibukContoh = '';
  let pencatatSibuk: ReturnType<typeof setTimeout> | null = null;
  const onError: ErrorRequestHandler = (error, req, res, _next) => {
    // Galat terkendali dari rute (GalatHttp): kode & data-nya memang dirancang aman untuk klien.
    if (error instanceof GalatHttp) {
      if (error.status === 503) {
        sibukTertahan += 1;
        sibukContoh = `${req.method} ${req.path}`;
        if (!pencatatSibuk) {
          pencatatSibuk = setTimeout(() => {
            console.warn(`[503] ${sibukTertahan}× server_sibuk dalam 10 dtk (terakhir: ${sibukContoh})`);
            sibukTertahan = 0;
            pencatatSibuk = null;
          }, 10_000);
          // Tidak menahan proses tetap hidup saat server dihentikan.
          pencatatSibuk.unref();
        }
      } else if (error.status >= 500) {
        console.error(`[${error.status}] ${req.method} ${req.path}: ${error.kode}`);
      }
      if (!res.headersSent) res.status(error.status).json({ error: error.kode, ...error.data });
      return;
    }
    const status = typeof error?.status === 'number' ? error.status : 500;
    if (status >= 400 && status < 500) {
      console.warn(`[${status}] ${req.method} ${req.path}: ${error?.type ?? 'permintaan tidak valid'}`);
      if (!res.headersSent) res.status(status).json({ error: clientErrorCode(error?.type, status) });
      return;
    }
    console.error(`[500] ${req.method} ${req.path}:`, error instanceof Error ? error.stack : String(error));
    if (!res.headersSent) res.status(500).json({ error: 'kesalahan_server' });
  };
  app.use(onError);

  return {
    app,
    close: async () => {
      konteks.sse.tutupSemua();
      await closeFrontend();
    },
    pengecek: () => pengecek.putaran(),
  };
}
