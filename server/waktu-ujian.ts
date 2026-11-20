// server/waktu-ujian.ts — hitungan waktu ujian dari jam server (docs/DESAIN.md §4), dan aturan penerimaan
// simpanan jawaban.
// Dipanggil oleh: server/routes/peserta-ujian.ts, server/routes/jawaban.ts, server/pengecek.ts,
//                 server/siaran.ts, server/routes/ujian-jalan.ts, tes.
// Memanggil: database (membaca baris ujian & peserta), shared/peserta.ts (toleransi).
// Semua waktu dihitung ulang dari kolom di DB (dimulai_at, total_jeda_ms, dijeda_at, perpanjangan), tidak
// ada penghitung di memori. Akibatnya waktu tetap benar setelah server restart.
import type { StatusPeserta, StatusUjian } from '../shared/auth.ts';
import { TOLERANSI_MS } from '../shared/peserta.ts';
import type { CaraKumpul, Waktu } from '../shared/peserta.ts';
import type { Db } from './db/connection.ts';

export type UjianWaktu = {
  id: number;
  status: StatusUjian;
  durasi_menit: number;
  dimulai_at: number | null;
  dijeda_at: number | null;
  diakhiri_at: number | null;
  total_jeda_ms: number;
  perpanjangan_ms: number;
  detak_at: number | null;
};

export type PesertaWaktu = {
  id: number;
  ujian_id: number;
  status: StatusPeserta;
  cara_kumpul: CaraKumpul | null;
  perpanjangan_ms: number;
};

const KOLOM_UJIAN = 'id, status, durasi_menit, dimulai_at, dijeda_at, diakhiri_at, total_jeda_ms, perpanjangan_ms, detak_at';
const KOLOM_PESERTA = 'id, ujian_id, status, cara_kumpul, perpanjangan_ms';

export function bacaUjianWaktu(db: Db, ujianId: number): UjianWaktu | undefined {
  return db.prepare(`SELECT ${KOLOM_UJIAN} FROM ujian WHERE id = ?`).get(ujianId) as UjianWaktu | undefined;
}

export function bacaPesertaWaktu(db: Db, pesertaId: number): PesertaWaktu | undefined {
  return db.prepare(`SELECT ${KOLOM_PESERTA} FROM peserta WHERE id = ?`).get(pesertaId) as PesertaWaktu | undefined;
}

export function daftarPesertaWaktu(db: Db, ujianId: number): PesertaWaktu[] {
  return db.prepare(`SELECT ${KOLOM_PESERTA} FROM peserta WHERE ujian_id = ?`).all(ujianId) as PesertaWaktu[];
}

// Titik waktu nyata saat jam ujian "membeku": awal jeda yang sedang berlangsung, atau saat ujian diakhiri.
function titikBeku(u: UjianWaktu): number | null {
  return u.dijeda_at ?? u.diakhiri_at;
}

// Lama ujian benar-benar berjalan (tanpa jeda) sampai waktu t.
export function aktifMs(u: UjianWaktu, t: number): number {
  if (u.dimulai_at === null) return 0;
  return Math.max(0, (titikBeku(u) ?? t) - u.dimulai_at - u.total_jeda_ms);
}

// Jatah waktu peserta: durasi + perpanjangan semua + perpanjangan khusus peserta ini.
export function batasMs(u: UjianWaktu, p: Pick<PesertaWaktu, 'perpanjangan_ms'>): number {
  return u.durasi_menit * 60_000 + u.perpanjangan_ms + p.perpanjangan_ms;
}

// Boleh negatif: −3000 berarti waktu peserta sudah habis 3 detik yang lalu.
export function sisaMs(u: UjianWaktu, p: Pick<PesertaWaktu, 'perpanjangan_ms'>, t: number): number {
  return batasMs(u, p) - aktifMs(u, t);
}

// Waktu nyata saat sisa peserta = 0, atau titik beku (jeda/diakhiri) bila lebih awal.
// - Jam berjalan: t + sisa (bisa di masa lalu bila sisa negatif).
// - Jam membeku di F: sisa tidak berubah lagi. Bila sisa > 0, akhirnya = F (waktu berhenti sebelum habis);
//   bila sisa ≤ 0, waktu sudah habis |sisa| ms sebelum F.
export function akhirEfektif(u: UjianWaktu, p: Pick<PesertaWaktu, 'perpanjangan_ms'>, t: number): number {
  const sisa = sisaMs(u, p, t);
  const beku = titikBeku(u);
  return beku === null ? t + sisa : beku + Math.min(0, sisa);
}

// Payload `waktu` untuk peserta (GET /api/peserta/ujian & SSE).
export function waktuPeserta(u: UjianWaktu, p: Pick<PesertaWaktu, 'perpanjangan_ms'>, t: number): Waktu {
  return { sisa_ms: sisaMs(u, p, t), jam_server: t, dijeda: u.status === 'dijeda' };
}

export type Penerimaan =
  | { jenis: 'terima' }
  | { jenis: 'dijeda' }
  | { jenis: 'terlambat'; alasan: 'waktu_habis' | 'diakhiri' | 'sudah_dikumpulkan' };

// Satu aturan penerimaan simpanan (docs/DESAIN.md §4), diperiksa berurutan:
// 1. Diterima bila sekarang ≤ akhir efektif + 10 dtk dan peserta tidak mengumpulkan sendiri.
// 2. Bila tidak, dan ujian dijeda sebelum waktu peserta habis → "dijeda" (klien menyimpan & mengirim ulang).
// 3. Selain itu → disimpan sebagai jawaban terlambat (guru yang memutuskan).
// Peserta yang sudah dikumpulkan otomatis karena waktu habis selalu "terlambat": kumpul otomatis baru
// berjalan setelah toleransi lewat, jadi toleransinya pasti sudah habis. (Menghitung ulang dari akhir
// efektif bisa keliru bila guru menjeda SETELAH waktu peserta itu habis, karena jedanya menggeser rumus.)
export function penerimaanSimpan(u: UjianWaktu, p: PesertaWaktu, t: number): Penerimaan {
  if (p.status === 'dikumpulkan' && p.cara_kumpul === 'manual') return { jenis: 'terlambat', alasan: 'sudah_dikumpulkan' };
  if (p.status === 'dikumpulkan' && p.cara_kumpul === 'waktu_habis') return { jenis: 'terlambat', alasan: 'waktu_habis' };
  if (t <= akhirEfektif(u, p, t) + TOLERANSI_MS) return { jenis: 'terima' };
  const sisa = sisaMs(u, p, t);
  if (u.status === 'dijeda' && sisa > 0) return { jenis: 'dijeda' };
  return { jenis: 'terlambat', alasan: u.diakhiri_at !== null && sisa > 0 ? 'diakhiri' : 'waktu_habis' };
}

// Kumpul otomatis per peserta: setelah waktu habis + toleransi (docs/DESAIN.md §3, status peserta).
export function harusDikumpulkanOtomatis(u: UjianWaktu, p: PesertaWaktu, t: number): boolean {
  if (p.status !== 'mengerjakan') return false;
  if (u.status !== 'berlangsung' && u.status !== 'dijeda') return false;
  return sisaMs(u, p, t) <= -TOLERANSI_MS;
}

// Mengubah peserta "mengerjakan" menjadi "dikumpulkan", lalu menyimpan potret semua jawabannya ke riwayat
// (alasan "kumpul"). ON CONFLICT DO NOTHING: versi yang sudah ada di riwayat tidak ditulis dua kali.
// Mengembalikan true bila status benar-benar berubah (dua pemanggil bersamaan tidak berefek ganda).
// Wajib dipanggil di dalam transaksi.
export function kumpulkanPeserta(db: Db, pesertaId: number, cara: CaraKumpul, t: number): boolean {
  const berubah = db
    .prepare(
      `UPDATE peserta SET status = 'dikumpulkan', cara_kumpul = ?, dikumpulkan_at = ?
       WHERE id = ? AND status = 'mengerjakan'`,
    )
    .run(cara, t, pesertaId).changes;
  if (berubah === 0) return false;
  db.prepare(
    `INSERT INTO jawaban_versi (peserta_id, soal_id, versi, isi, alasan, disimpan_at)
     SELECT peserta_id, soal_id, versi, isi, 'kumpul', ? FROM jawaban WHERE peserta_id = ? AND versi >= 1
     ON CONFLICT (peserta_id, soal_id, versi) DO NOTHING`,
  ).run(t, pesertaId);
  return true;
}
