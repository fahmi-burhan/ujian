// server/siaran.ts — mengirim event SSE `status` dan `waktu` ke siswa, dihitung dari DB saat dikirim. Setiap
// perubahan status juga memberi tahu dasbor guru & proyektor (server/pantau.ts).
// Dipanggil oleh: server/routes/ujian-jalan.ts (mulai/jeda/lanjutkan/akhiri), server/routes/ujian.ts
//                 (buka/kembali ke draf), server/pengecek.ts (jeda otomatis, kumpul otomatis, waktu tiap 30 dtk),
//                 server/routes/peserta-ujian.ts (koneksi baru, kumpulkan).
// Memanggil: server/sse.ts, server/waktu-ujian.ts, server/pantau.ts.
// Payload mengikuti daftar putih docs/DESAIN.md §8.1: `status` = {status} saja (klien lalu memanggil ulang
// GET /api/peserta/ujian), `waktu` = {sisa_ms, jam_server, dijeda} milik peserta itu. Saat ujian draf
// (ditutup kembali) hanya `status` yang dikirim (DESAIN §12 no. 6).
import type { Konteks } from './konteks.ts';
import { beritahuPantau } from './pantau.ts';
import type { KoneksiPeserta } from './sse.ts';
import { bacaPesertaWaktu, bacaUjianWaktu, waktuPeserta } from './waktu-ujian.ts';

function kirimKeKoneksi(k: Konteks, daftar: KoneksiPeserta[], denganStatus: boolean): void {
  if (daftar.length === 0) return;
  const t = k.jam();
  // Semua koneksi di sini milik satu ujian; ujiannya cukup dibaca sekali.
  const ujianId = daftar[0]?.ujianId;
  if (ujianId === undefined) return;
  const u = bacaUjianWaktu(k.db, ujianId);
  if (!u) return;
  for (const kon of daftar) {
    if (denganStatus) k.sse.kirim(kon.res, 'status', { status: u.status });
    if (u.status === 'draf') continue;
    const p = bacaPesertaWaktu(k.db, kon.pesertaId);
    if (p) k.sse.kirim(kon.res, 'waktu', waktuPeserta(u, p, t));
  }
}

// Status ujian berubah (atau status banyak peserta berubah): semua siswa ujian itu memuat ulang.
export function siarkanStatus(k: Konteks, ujianId: number): void {
  kirimKeKoneksi(k, k.sse.koneksiPeserta((kon) => kon.ujianId === ujianId), true);
  beritahuPantau(k, ujianId);
}

// Status satu peserta berubah (mis. dikumpulkan otomatis) atau koneksinya baru tersambung.
export function kirimStatusPeserta(k: Konteks, pesertaId: number): void {
  kirimKeKoneksi(k, k.sse.koneksiPeserta((kon) => kon.pesertaId === pesertaId), true);
  const ujianId = k.db.prepare('SELECT ujian_id FROM peserta WHERE id = ?').pluck().get(pesertaId) as number | undefined;
  if (ujianId !== undefined) beritahuPantau(k, ujianId);
}

export function sambutKoneksi(k: Konteks, kon: KoneksiPeserta): void {
  kirimKeKoneksi(k, [kon], true);
}

// Penyelarasan ulang hitung mundur di klien (tiap 30 dtk, dan setelah perpanjangan).
export function siarkanWaktu(k: Konteks, ujianId: number): void {
  kirimKeKoneksi(k, k.sse.koneksiPeserta((kon) => kon.ujianId === ujianId), false);
}
