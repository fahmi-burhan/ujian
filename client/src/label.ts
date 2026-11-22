// client/src/label.ts — label & format tampilan yang dipakai beberapa halaman (status, ukuran, waktu WIB, durasi,
// nama aksi di log).
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

// Jam WIB saja, mis. "14:05:09" (untuk daftar aktivitas selama ujian).
const JAM_WIB = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function jamWib(epochMs: number): string {
  return JAM_WIB.format(epochMs).replaceAll('.', ':');
}

// Durasi singkat & netral: "15 dtk", "2 mnt 5 dtk", "1 jam 3 mnt".
export function durasiSingkat(ms: number): string {
  const detik = Math.max(0, Math.round(ms / 1000));
  if (detik < 60) return `${detik} dtk`;
  const menit = Math.floor(detik / 60);
  if (menit < 60) return detik % 60 ? `${menit} mnt ${detik % 60} dtk` : `${menit} mnt`;
  return `${Math.floor(menit / 60)} jam ${menit % 60} mnt`;
}

// Nama aksi di log_aksi (server/routes/*), untuk dasbor guru.
export const LABEL_AKSI: Record<string, string> = {
  buka: 'Ujian dibuka',
  kembali_draf: 'Dikembalikan ke draf',
  mulai: 'Ujian dimulai',
  jeda: 'Ujian dijeda',
  lanjutkan: 'Ujian dilanjutkan',
  akhiri: 'Ujian diakhiri',
  jeda_otomatis: 'Dijeda otomatis (server sempat mati)',
  perpanjang: 'Perpanjangan waktu',
  buka_kembali: 'Siswa dibuka kembali',
  reset_pin: 'Reset PIN',
  buka_kunci: 'Buka kunci',
  buka_kunci_semua: 'Buka kunci semua',
  pin_terkunci: 'Nama terkunci (5× PIN salah)',
  tambah_peserta: 'Peserta ditambah',
  impor_peserta: 'Peserta diimpor',
  ubah_tampilan: 'Mode tampil proyektor diubah',
  cabut_proyektor: 'Layar proyektor ditutup',
  tandai_event: 'Aktivitas ditandai',
  duplikat_dari: 'Disalin dari ujian lain',
};
