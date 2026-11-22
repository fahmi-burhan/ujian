// client/src/layar-penuh.ts — status & tombol layar penuh untuk halaman ujian siswa.
// Dipanggil oleh: client/src/komponen/peserta/RuangTunggu.vue, Pengerjaan.vue, client/src/halaman/UjianPeserta.vue
//                 (penutup editor saat tidak layar penuh, Fase 5).
// Memanggil: Fullscreen API & Keyboard Lock API bawaan browser.
// Keyboard Lock (Fase 5): di Chrome/Edge, selama layar penuh yang dibuka lewat klik, tombol Esc harus DITAHAN
// untuk keluar, sehingga Esc yang tertekan tidak sengaja tidak langsung mengeluarkan siswa dari layar penuh.
// TIDAK TERVERIFIKASI di laptop sekolah: bila tidak didukung atau ditolak, Esc berperilaku biasa (tidak ada galat).
import { ref } from 'vue';

export const layarPenuh = ref(typeof document !== 'undefined' && document.fullscreenElement !== null);
// false bila browser/kebijakan perangkat tidak mengizinkan layar penuh sama sekali (penutup editor tidak dipakai).
export const layarPenuhDidukung = typeof document !== 'undefined' && document.fullscreenEnabled === true;

if (typeof document !== 'undefined') {
  document.addEventListener('fullscreenchange', () => {
    layarPenuh.value = document.fullscreenElement !== null;
  });
}

type NavigatorKeyboard = Navigator & { keyboard?: { lock?: (kode?: string[]) => Promise<void> } };

// Harus dipanggil dari klik siswa: browser menolak layar penuh tanpa aksi pengguna.
// Mengembalikan false bila ditolak browser.
export async function masukLayarPenuh(): Promise<boolean> {
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    return false;
  }
  try {
    await (navigator as NavigatorKeyboard).keyboard?.lock?.(['Escape']);
  } catch {
    // Tidak didukung/ditolak: Esc tetap bisa keluar dari layar penuh (dan tercatat sebagai kepergian).
  }
  return true;
}
