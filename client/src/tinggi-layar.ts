// client/src/tinggi-layar.ts — tinggi area yang benar-benar terlihat (di HP: layar dikurangi keyboard), sebagai variabel
// CSS --tinggi-layar, supaya halaman mengerjakan pas di atas keyboard dan kotak jawaban tidak tertutup (permintaan
// pemilik 24 Nov, siswa boleh memakai HP).
// Dipanggil oleh: client/src/komponen/peserta/Pengerjaan.vue. Memanggil: window.visualViewport bawaan browser.
// Alasan: 100vh/h-screen di HP tetap setinggi layar walau keyboard terbuka, jadi bagian bawah halaman (kotak jawaban)
// tertutup keyboard. visualViewport.height mengikuti keyboard di Chrome Android maupun Safari iOS. Di laptop nilainya
// sama dengan tinggi jendela, jadi tidak ada perubahan.
import { ref } from 'vue';

// Perangkat sentuh (HP/tablet): dipakai untuk tampilan ringkas saat mengetik.
export const layarSentuh = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
export const tinggiTerlihat = ref<number | null>(null);

export function pantauTinggiLayar(): () => void {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv) return () => {};
  const akar = document.documentElement;
  const atur = (): void => {
    const h = Math.round(vv.height);
    tinggiTerlihat.value = h;
    akar.style.setProperty('--tinggi-layar', `${h}px`);
    // Safari iOS menggeser seluruh halaman ke atas saat keyboard muncul. Karena halaman sudah dipendekkan setinggi
    // area terlihat, geseran itu dikembalikan supaya kepala halaman tetap tampak dan kotak jawaban tepat di atas keyboard.
    if (vv.offsetTop > 0 && vv.scale <= 1.01) window.scrollTo(0, 0);
  };
  atur();
  vv.addEventListener('resize', atur);
  vv.addEventListener('scroll', atur);
  return () => {
    vv.removeEventListener('resize', atur);
    vv.removeEventListener('scroll', atur);
    akar.style.removeProperty('--tinggi-layar');
    tinggiTerlihat.value = null;
  };
}
