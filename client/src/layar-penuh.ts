// client/src/layar-penuh.ts — status & tombol layar penuh untuk halaman ujian siswa.
// Dipanggil oleh: client/src/komponen/peserta/RuangTunggu.vue dan Pengerjaan.vue.
// Memanggil: Fullscreen API bawaan browser.
// Fase 4 hanya menyediakan tombol; pencatatan "keluar layar penuh" dan penutup editor saat tidak layar penuh
// dibuat di Fase 5 (integritas, docs/DESAIN.md §6).
import { ref } from 'vue';

export const layarPenuh = ref(typeof document !== 'undefined' && document.fullscreenElement !== null);

if (typeof document !== 'undefined') {
  document.addEventListener('fullscreenchange', () => {
    layarPenuh.value = document.fullscreenElement !== null;
  });
}

// Harus dipanggil dari klik siswa: browser menolak layar penuh tanpa aksi pengguna.
export async function masukLayarPenuh(): Promise<void> {
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    // Ditolak browser (mis. kebijakan perangkat): siswa tetap bisa mengerjakan; guru melihat di kelas.
  }
}
