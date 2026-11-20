// server/acak.ts — pembuat nilai acak yang aman secara kriptografis (kode, token, ID).
// Dipanggil oleh: server/auth/sesi.ts, server/routes/ujian-admin.ts, server/routes/proyektor.ts,
// dan (Fase 3) pembuatan ujian/peserta.
// Memanggil: node:crypto.
// Alasan: Math.random() bisa ditebak; semua kode yang memberi akses wajib memakai crypto.
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { ALFABET_KODE } from '../shared/alfabet.ts';

// Kode dari alfabet tanpa huruf mirip. randomInt tidak bias (setiap karakter berpeluang sama).
export function kodeAcak(panjang: number): string {
  let hasil = '';
  for (let i = 0; i < panjang; i++) hasil += ALFABET_KODE[randomInt(ALFABET_KODE.length)];
  return hasil;
}

// Token rahasia untuk cookie sesi: 32 byte acak (256 bit), aman dipakai di URL/cookie.
export function tokenAcak(): string {
  return randomBytes(32).toString('base64url');
}

// Sidik SHA-256 (hex). Yang disimpan di DB hanya sidik token/kode, bukan aslinya.
export function sidik(teks: string): string {
  return createHash('sha256').update(teks).digest('hex');
}
