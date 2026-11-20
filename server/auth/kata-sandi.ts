// server/auth/kata-sandi.ts — hash & cek rahasia (password guru dan PIN siswa) dengan scrypt.
// Dipanggil oleh: server/auth/penguji.ts, server/routes/penguji-auth.ts, server/routes/peserta-auth.ts.
// Memanggil: node:crypto (scrypt bawaan Node, tanpa dependensi tambahan), server/auth/antrean.ts.
// Alasan memakai scrypt: sengaja lambat & butuh banyak memori, sehingga hash yang bocor sulit ditebak
// massal. Salt acak per rahasia membuat dua PIN "1234" menghasilkan hash berbeda.
// Format tersimpan: scrypt$N$r$p$<salt base64>$<hash base64> (cocok dengan CHECK di skema).
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { buatSemafor } from './antrean.ts';
import type { Semafor } from './antrean.ts';

const N = 16384;
const R = 8;
const P = 1;
const PANJANG_KUNCI = 32;

// Dua jatah scrypt terpisah, agar banjir di satu jalur tidak menghabiskan jatah jalur lain:
// - 'umum' (PIN siswa, CLI): 2 berjalan + 100 menunggu. Satu scrypt ±50–80 ms, jadi 30 siswa yang
//   masuk serentak tetap selesai sekitar 1 detik. Jalur ini sudah terbatas dengan sendirinya
//   (5 percobaan per nama, pembuatan PIN sekali per nama).
// - 'guru' (login guru): 1 berjalan + 20 menunggu. Siapa pun bisa mengirim username acak ke login
//   guru, jadi jalur ini dipisah supaya banjirnya tidak membuat siswa gagal masuk.
// Total paling banyak 3 scrypt bersamaan, menyisakan thread libuv untuk membaca berkas.
// Antrean penuh → 503 server_sibuk.
export type JalurScrypt = 'umum' | 'guru';
const semaforScrypt: Record<JalurScrypt, Semafor> = {
  umum: buatSemafor(2, 100),
  guru: buatSemafor(1, 20),
};

// Dicek route sebelum mencatat percobaan PIN, agar percobaan yang ditolak karena server sibuk
// tidak ikut terhitung sebagai PIN salah.
export function scryptPenuh(jalur: JalurScrypt = 'umum'): boolean {
  return semaforScrypt[jalur].penuh();
}

function turunkan(rahasia: string, salt: Buffer, n: number, r: number, p: number, jalur: JalurScrypt): Promise<Buffer> {
  return semaforScrypt[jalur].jalankan(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        scrypt(rahasia, salt, PANJANG_KUNCI, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (galat, kunci) => {
          if (galat) reject(galat);
          else resolve(kunci);
        });
      }),
  );
}

export async function hashRahasia(rahasia: string, jalur: JalurScrypt = 'umum'): Promise<string> {
  const salt = randomBytes(16);
  const kunci = await turunkan(rahasia, salt, N, R, P, jalur);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${kunci.toString('base64')}`;
}

// Mengembalikan true bila rahasia cocok. Format rusak → false (bukan galat), agar data aneh
// di DB tidak membuat login error 500.
export async function cocokkanRahasia(rahasia: string, tersimpan: string, jalur: JalurScrypt = 'umum'): Promise<boolean> {
  const bagian = tersimpan.split('$');
  if (bagian.length !== 6 || bagian[0] !== 'scrypt') return false;
  const [n, r, p] = [Number(bagian[1]), Number(bagian[2]), Number(bagian[3])];
  if (![n, r, p].every((x) => Number.isInteger(x) && x > 0)) return false;
  const salt = Buffer.from(bagian[4] ?? '', 'base64');
  const harapan = Buffer.from(bagian[5] ?? '', 'base64');
  if (salt.length === 0 || harapan.length !== PANJANG_KUNCI) return false;
  const kunci = await turunkan(rahasia, salt, n, r, p, jalur);
  // timingSafeEqual: lama perbandingan tidak bergantung pada isi, jadi tidak membocorkan petunjuk.
  return timingSafeEqual(kunci, harapan);
}

// Hash palsu yang tetap dihitung saat username tidak ada, supaya lama respons login sama
// untuk username ada/tidak ada (tidak bisa dipakai menebak daftar username).
export const HASH_PALSU = `scrypt$${N}$${R}$${P}$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(PANJANG_KUNCI).toString('base64')}`;
