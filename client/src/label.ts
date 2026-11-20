// client/src/label.ts — label & format tampilan yang dipakai beberapa halaman (status, ukuran, waktu WIB).
// Dipanggil oleh: halaman & komponen guru di client/src/.
// Memanggil: Intl bawaan browser.
import type { StatusPeserta, StatusUjian } from '../../shared/auth.ts';

export const LABEL_STATUS_UJIAN: Record<StatusUjian, string> = {
  draf: 'Draf',
  menunggu: 'Dibuka (ruang tunggu)',
  berlangsung: 'Berlangsung',
  dijeda: 'Dijeda',
  selesai: 'Selesai',
  penilaian: 'Penilaian',
  dirilis: 'Nilai dirilis',
};

// Kelas badge daisyUI per status, agar status mudah dikenali sekilas.
export const WARNA_STATUS_UJIAN: Record<StatusUjian, string> = {
  draf: 'badge-ghost',
  menunggu: 'badge-info',
  berlangsung: 'badge-success',
  dijeda: 'badge-warning',
  selesai: 'badge-neutral',
  penilaian: 'badge-secondary',
  dirilis: 'badge-primary',
};

export const LABEL_STATUS_PESERTA: Record<StatusPeserta, string> = {
  belum_masuk: 'Belum masuk',
  menunggu: 'Di ruang tunggu',
  mengerjakan: 'Mengerjakan',
  dikumpulkan: 'Sudah mengumpulkan',
};

// 12,4 MB (desimal koma, gaya Indonesia).
export function ukuranMb(byte: number): string {
  return `${(byte / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

// Tanggal + jam WIB 24 jam, mis. "20 Nov 14:05 WIB" (zona Asia/Jakarta, tidak bergantung jam laptop).
const TANGGAL_WIB = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function waktuWib(epochMs: number): string {
  return `${TANGGAL_WIB.format(epochMs).replaceAll('.', ':')} WIB`;
}
