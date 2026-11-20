// server/auth/penguji.ts — membuat akun guru (dipakai perintah CLI `npm run penguji:buat` dan tes).
// Dipanggil oleh: server/cli/penguji-buat.ts, tes.
// Memanggil: server/auth/kata-sandi.ts, zod, database.
// Tidak ada pendaftaran guru lewat web (docs/DESAIN.md §1): akun hanya bisa dibuat oleh orang yang
// punya akses ke server, sehingga siswa tidak bisa membuat akun guru sendiri.
import { z } from 'zod';
import type { Db } from '../db/connection.ts';
import { hashRahasia } from './kata-sandi.ts';

export const PengujiBaruSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]{3,32}$/, 'Username 3–32 karakter: huruf, angka, titik, garis bawah, atau tanda hubung.'),
  nama: z.string().trim().min(1, 'Nama wajib diisi.').max(100, 'Nama maksimal 100 karakter.'),
  password: z.string().min(10, 'Password minimal 10 karakter.').max(200, 'Password maksimal 200 karakter.'),
});
export type PengujiBaru = z.infer<typeof PengujiBaruSchema>;

// Mengembalikan id penguji baru. Melempar Error berpesan jelas bila input salah / username sudah ada.
export async function buatPenguji(db: Db, sekarang: number, input: PengujiBaru): Promise<number> {
  const hasil = PengujiBaruSchema.safeParse(input);
  if (!hasil.success) {
    throw new Error(hasil.error.issues.map((masalah) => masalah.message).join(' '));
  }
  const data = hasil.data;
  const sudahAda = db.prepare('SELECT 1 FROM penguji WHERE username = ?').get(data.username);
  if (sudahAda) throw new Error(`Username "${data.username}" sudah dipakai.`);
  const hash = await hashRahasia(data.password);
  const info = db
    .prepare('INSERT INTO penguji (username, nama, password_hash, dibuat_at) VALUES (?, ?, ?, ?)')
    .run(data.username, data.nama, hash, sekarang);
  return Number(info.lastInsertRowid);
}
