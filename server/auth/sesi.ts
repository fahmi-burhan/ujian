// server/auth/sesi.ts — membuat, membaca, dan mencabut sesi login (tabel `sesi`), plus cookie-nya.
// Dipanggil oleh: server/auth/penjaga.ts, server/routes/*-auth.ts, server/routes/proyektor.ts,
//                 server/routes/ujian-admin.ts, server/start.ts (pembersihan sesi kedaluwarsa).
// Memanggil: server/acak.ts, database.
// Desain (docs/DESAIN.md §8):
// - Cookie berisi token acak; DB hanya menyimpan SHA-256-nya.
// - Tiga lingkup dengan nama cookie berbeda: login peserta di browser guru tidak mengeluarkan guru,
//   dan cookie proyektor hanya dikirim browser ke /api/proyektor.
// - Sesi bisa dicabut seketika (keluar, diambil alih, reset PIN, proyektor ditutup guru).
import type { Request, Response } from 'express';
import type { Db } from '../db/connection.ts';
import { sidik, tokenAcak } from '../acak.ts';

export type Lingkup = 'penguji' | 'peserta' | 'proyektor';
export type AlasanCabut = 'keluar' | 'diambil_alih' | 'direset_penguji' | 'dicabut_penguji';

export const NAMA_COOKIE: Record<Lingkup, string> = {
  penguji: 'sesi_guru',
  peserta: 'sesi_peserta',
  proyektor: 'sesi_proyektor',
};
const PATH_COOKIE: Record<Lingkup, string> = { penguji: '/', peserta: '/', proyektor: '/api/proyektor' };

export const UMUR_SESI_MS = 12 * 60 * 60 * 1000;
// terakhir_aktif_at cukup diperbarui sesekali; menulis DB di setiap request tidak perlu.
const JEDA_SENTUH_MS = 60 * 1000;

export type SesiAktif = {
  idHash: string;
  lingkup: Lingkup;
  pengujiId: number | null;
  pesertaId: number | null;
  ujianId: number | null;
};

type BarisSesi = {
  id_hash: string;
  lingkup: Lingkup;
  penguji_id: number | null;
  peserta_id: number | null;
  ujian_id: number | null;
  terakhir_aktif_at: number;
};

export type DataSesiBaru = {
  lingkup: Lingkup;
  pengujiId?: number;
  pesertaId?: number;
  ujianId?: number;
  infoPerangkat: string;
};

// Membuat sesi baru dan mengembalikan TOKEN ASLI (hanya untuk dimasukkan ke cookie).
export function buatSesi(db: Db, sekarang: number, data: DataSesiBaru): string {
  const token = tokenAcak();
  db.prepare(
    `INSERT INTO sesi (id_hash, lingkup, penguji_id, peserta_id, ujian_id, dibuat_at, terakhir_aktif_at, kedaluwarsa_at, info_perangkat)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sidik(token),
    data.lingkup,
    data.pengujiId ?? null,
    data.pesertaId ?? null,
    data.ujianId ?? null,
    sekarang,
    sekarang,
    sekarang + UMUR_SESI_MS,
    data.infoPerangkat.slice(0, 200),
  );
  return token;
}

// Mencari sesi aktif berdasarkan token cookie. Lingkup ikut dicocokkan, jadi cookie guru yang
// entah bagaimana terkirim ke endpoint peserta tetap ditolak.
export function cariSesi(db: Db, sekarang: number, lingkup: Lingkup, token: string): SesiAktif | null {
  const baris = db
    .prepare(
      `SELECT id_hash, lingkup, penguji_id, peserta_id, ujian_id, terakhir_aktif_at FROM sesi
       WHERE id_hash = ? AND lingkup = ? AND dicabut_at IS NULL AND kedaluwarsa_at > ?`,
    )
    .get(sidik(token), lingkup, sekarang) as BarisSesi | undefined;
  if (!baris) return null;
  if (sekarang - baris.terakhir_aktif_at > JEDA_SENTUH_MS) {
    db.prepare('UPDATE sesi SET terakhir_aktif_at = ? WHERE id_hash = ?').run(sekarang, baris.id_hash);
  }
  return {
    idHash: baris.id_hash,
    lingkup: baris.lingkup,
    pengujiId: baris.penguji_id,
    pesertaId: baris.peserta_id,
    ujianId: baris.ujian_id,
  };
}

export function cabutSesi(db: Db, sekarang: number, idHash: string, alasan: AlasanCabut): void {
  db.prepare('UPDATE sesi SET dicabut_at = ?, alasan_cabut = ? WHERE id_hash = ? AND dicabut_at IS NULL').run(
    sekarang,
    alasan,
    idHash,
  );
}

// Mencabut semua sesi aktif seorang peserta; mengembalikan jumlah sesi yang dicabut.
export function cabutSesiPeserta(db: Db, sekarang: number, pesertaId: number, alasan: AlasanCabut): number {
  return db
    .prepare(
      `UPDATE sesi SET dicabut_at = ?, alasan_cabut = ?
       WHERE peserta_id = ? AND dicabut_at IS NULL AND kedaluwarsa_at > ?`,
    )
    .run(sekarang, alasan, pesertaId, sekarang).changes;
}

export function cabutSesiProyektor(db: Db, sekarang: number, ujianId: number): number {
  return db
    .prepare(
      `UPDATE sesi SET dicabut_at = ?, alasan_cabut = 'dicabut_penguji'
       WHERE lingkup = 'proyektor' AND ujian_id = ? AND dicabut_at IS NULL`,
    )
    .run(sekarang, ujianId).changes;
}

// Menghapus sesi yang sudah kedaluwarsa lebih dari sehari (dipanggil saat start & tiap jam).
export function hapusSesiLama(db: Db, sekarang: number): number {
  return db.prepare('DELETE FROM sesi WHERE kedaluwarsa_at < ?').run(sekarang - 24 * 60 * 60 * 1000).changes;
}

// ---- Cookie ----

// Membaca satu cookie dari header Cookie tanpa pustaka tambahan.
export function bacaCookie(req: Request, nama: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const bagian of header.split(';')) {
    const pemisah = bagian.indexOf('=');
    if (pemisah === -1) continue;
    if (bagian.slice(0, pemisah).trim() === nama) {
      const nilai = bagian.slice(pemisah + 1).trim();
      return nilai.length > 0 ? nilai : null;
    }
  }
  return null;
}

// Secure (cookie hanya dikirim lewat HTTPS): bila ORIGIN_PUBLIK diisi, mengikuti skemanya (https → aktif),
// tanpa bergantung pada X-Forwarded-Proto dari nginx. Di laptop mengikuti req.secure (http → mati).
export function cookieAman(req: Request, originPublik: string | null): boolean {
  return originPublik === null ? req.secure : originPublik.startsWith('https:');
}

// HttpOnly: JavaScript halaman tidak bisa membaca cookie (aman dari XSS mencuri sesi).
export function pasangCookieSesi(
  req: Request,
  res: Response,
  lingkup: Lingkup,
  token: string,
  originPublik: string | null,
): void {
  res.cookie(NAMA_COOKIE[lingkup], token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieAman(req, originPublik),
    path: PATH_COOKIE[lingkup],
    maxAge: UMUR_SESI_MS,
  });
}

export function hapusCookieSesi(req: Request, res: Response, lingkup: Lingkup, originPublik: string | null): void {
  res.clearCookie(NAMA_COOKIE[lingkup], {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieAman(req, originPublik),
    path: PATH_COOKIE[lingkup],
  });
}
