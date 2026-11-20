// server/konteks.ts — "konteks" yang dibagikan ke semua rute: database, jam, opsi keamanan, origin publik,
// folder unggahan, dan pusat koneksi SSE.
// Dipanggil oleh: server/app.ts (membuatnya), server/routes/* (memakainya), tes (mengganti jam & opsi).
// Memanggil: tidak ada.
// Alasan jam berupa fungsi (bukan Date.now langsung): tes bisa "memajukan waktu" (mis. kode proyektor
// kedaluwarsa setelah 10 menit) tanpa benar-benar menunggu.
import type { Db } from './db/connection.ts';
import type { Jam } from './auth/penjaga.ts';
import type { HubSse } from './sse.ts';

export type OpsiKeamanan = {
  // Jeda tetap sebelum menjawab login guru yang gagal (memperlambat tebak password).
  jedaGagalLoginMs: number;
  // Jeda tetap sebelum menjawab kode ujian/kode proyektor yang salah. Pengganti blokir per IP
  // (keputusan pemilik 20 Nov 2026): satu kelas berbagi satu IP, jadi blokir per IP bisa dipakai
  // satu siswa untuk menghalangi login seluruh kelas. Kode yang benar selalu langsung diterima.
  jedaKodeSalahMs: number;
  // Lama berlaku kode proyektor.
  umurKodeProyektorMs: number;
};

export const OPSI_KEAMANAN_BAWAAN: OpsiKeamanan = {
  jedaGagalLoginMs: 1000,
  jedaKodeSalahMs: 1000,
  umurKodeProyektorMs: 10 * 60 * 1000,
};

export type Konteks = {
  db: Db;
  jam: Jam;
  opsi: OpsiKeamanan;
  // ORIGIN_PUBLIK dari .env (null di laptop); dipakai untuk atribut Secure cookie.
  originPublik: string | null;
  // Folder absolut berkas PDF (UPLOAD_DIR dari .env).
  uploadDir: string;
  // Koneksi SSE yang sedang terbuka (server/sse.ts).
  sse: HubSse;
};
