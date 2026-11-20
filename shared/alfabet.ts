// shared/alfabet.ts — alfabet & pola untuk kode yang diketik manusia (kode ujian, kode proyektor) dan PIN.
// Dipanggil oleh: shared/auth.ts (validasi Zod), server/acak.ts (membuat kode), klien (merapikan input).
// Memanggil: tidak ada.
// Alasan: huruf/angka yang mudah tertukar saat dibaca dari proyektor (O/0, I/1/L) tidak dipakai.
// Alfabet ini SAMA dengan CHECK di migrations/0001_skema_awal.sql; bila diubah, keduanya harus diubah.

export const ALFABET_KODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const PANJANG_KODE_UJIAN = 6;
export const PANJANG_KODE_PROYEKTOR = 8;

export const POLA_KODE_UJIAN = new RegExp(`^[${ALFABET_KODE}]{${PANJANG_KODE_UJIAN}}$`);
export const POLA_KODE_PROYEKTOR = new RegExp(`^[${ALFABET_KODE}]{${PANJANG_KODE_PROYEKTOR}}$`);
export const POLA_PIN = /^[0-9]{4}$/;

// Merapikan kode yang diketik siswa/guru: huruf besar, tanpa spasi/tanda hubung.
// Contoh: " abc-234 " → "ABC234".
export function rapikanKode(teks: string): string {
  return teks.toUpperCase().replace(/[\s-]/g, '');
}
