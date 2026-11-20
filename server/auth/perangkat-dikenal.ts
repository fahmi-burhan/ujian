// server/auth/perangkat-dikenal.ts — "perangkat dikenal" untuk login guru (keputusan pemilik 20 Nov 2026).
// Dipanggil oleh: server/routes/penguji-auth.ts, server/start.ts (pembersihan berkala).
// Memanggil: server/acak.ts, server/auth/sesi.ts (cookieAman), database (tabel perangkat_guru, migrasi 0002).
// Masalah yang diselesaikan: login guru diproses berurutan per username (agar tebakan password lambat).
// Akibatnya siswa yang terus mengirim tebakan bisa memenuhi antrean, sehingga guru ditolak "server sibuk".
// Browser yang pernah berhasil login sebagai guru menyimpan cookie acak; login dari browser itu untuk
// username yang sama melewati antrean. Cookie hanya dikirim ke /api/penguji/masuk (Path) dan HttpOnly.
// Batasan jalur ini (lihat server/routes/penguji-auth.ts): satu login per perangkat pada satu waktu,
// jeda 1 dtk setiap gagal, dan setelah 3 password salah berturut-turut perangkat dilupakan (kembali lewat
// antrean). Jadi cookie yang tertinggal di PC kelas paling banyak memberi 3 tebakan lambat.
// Salah ketik 1–2 kali tidak membuat guru kehilangan jalurnya.
import type { Request, Response } from 'express';
import type { Db } from '../db/connection.ts';
import { sidik, tokenAcak } from '../acak.ts';
import { cookieAman } from './sesi.ts';

export const NAMA_COOKIE_PERANGKAT = 'perangkat_guru';
const PATH_COOKIE_PERANGKAT = '/api/penguji/masuk';
export const UMUR_PERANGKAT_MS = 90 * 24 * 60 * 60 * 1000;
// Perangkat terlama dihapus bila seorang guru punya lebih dari ini.
const MAKS_PERANGKAT_PER_GURU = 10;
// Password salah berturut-turut sebelum perangkat dilupakan (cocok dengan CHECK di migrasi 0002).
export const BATAS_GAGAL_PERANGKAT = 3;

export type PerangkatDikenal = { id: number; pengujiId: number; username: string };

export function cariPerangkatDikenal(db: Db, sekarang: number, token: string): PerangkatDikenal | null {
  const baris = db
    .prepare(
      `SELECT pg.id, pg.penguji_id, p.username FROM perangkat_guru pg JOIN penguji p ON p.id = pg.penguji_id
       WHERE pg.token_hash = ? AND pg.kedaluwarsa_at > ?`,
    )
    .get(sidik(token), sekarang) as { id: number; penguji_id: number; username: string } | undefined;
  return baris ? { id: baris.id, pengujiId: baris.penguji_id, username: baris.username } : null;
}

// Mencatat satu password salah. Mengembalikan true bila perangkat kini dilupakan (batas tercapai).
export function catatGagalPerangkat(db: Db, id: number): boolean {
  return db.transaction(() => {
    const gagal = db.prepare('SELECT gagal FROM perangkat_guru WHERE id = ?').pluck().get(id) as number | undefined;
    if (gagal === undefined) return true;
    if (gagal + 1 >= BATAS_GAGAL_PERANGKAT) {
      db.prepare('DELETE FROM perangkat_guru WHERE id = ?').run(id);
      return true;
    }
    db.prepare('UPDATE perangkat_guru SET gagal = gagal + 1 WHERE id = ?').run(id);
    return false;
  })();
}

// Setelah login berhasil: perpanjang perangkat yang sudah dikenal, atau daftarkan yang baru.
// Mengembalikan token untuk dipasang ulang di cookie.
export function ingatPerangkat(
  db: Db,
  sekarang: number,
  pengujiId: number,
  tokenLama: string | null,
  infoPerangkat: string,
): string {
  return db.transaction(() => {
    if (tokenLama) {
      const diperpanjang = db
        .prepare(
          `UPDATE perangkat_guru SET dipakai_at = ?, kedaluwarsa_at = ?, gagal = 0
           WHERE token_hash = ? AND penguji_id = ? AND kedaluwarsa_at > ?`,
        )
        .run(sekarang, sekarang + UMUR_PERANGKAT_MS, sidik(tokenLama), pengujiId, sekarang).changes;
      if (diperpanjang === 1) return tokenLama;
    }
    const token = tokenAcak();
    db.prepare(
      `INSERT INTO perangkat_guru (penguji_id, token_hash, info_perangkat, dibuat_at, dipakai_at, kedaluwarsa_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(pengujiId, sidik(token), infoPerangkat, sekarang, sekarang, sekarang + UMUR_PERANGKAT_MS);
    db.prepare(
      `DELETE FROM perangkat_guru WHERE penguji_id = ? AND id NOT IN (
         SELECT id FROM perangkat_guru WHERE penguji_id = ? ORDER BY dipakai_at DESC, id DESC LIMIT ?)`,
    ).run(pengujiId, pengujiId, MAKS_PERANGKAT_PER_GURU);
    return token;
  })();
}

export function hapusPerangkatKedaluwarsa(db: Db, sekarang: number): number {
  return db.prepare('DELETE FROM perangkat_guru WHERE kedaluwarsa_at <= ?').run(sekarang).changes;
}

// SameSite=Strict: cookie ini hanya diperlukan saat guru menekan "Masuk" di halaman aplikasi sendiri.
export function pasangCookiePerangkat(req: Request, res: Response, token: string, originPublik: string | null): void {
  res.cookie(NAMA_COOKIE_PERANGKAT, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: cookieAman(req, originPublik),
    path: PATH_COOKIE_PERANGKAT,
    maxAge: UMUR_PERANGKAT_MS,
  });
}

export function hapusCookiePerangkat(req: Request, res: Response, originPublik: string | null): void {
  res.clearCookie(NAMA_COOKIE_PERANGKAT, {
    httpOnly: true,
    sameSite: 'strict',
    secure: cookieAman(req, originPublik),
    path: PATH_COOKIE_PERANGKAT,
  });
}
