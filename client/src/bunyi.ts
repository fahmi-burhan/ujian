// client/src/bunyi.ts — bunyi penanda singkat (dua nada lembut) untuk layar proyektor saat ada aktivitas baru di luar
// halaman ujian (permintaan pemilik 24 Nov).
// Dipanggil oleh: client/src/halaman/Proyektor.vue. Memanggil: Web Audio API bawaan browser.
// Bunyinya dibangkitkan langsung dengan Web Audio (tanpa berkas suara, tanpa pustaka/CDN): nada "ding-dong" yang
// lembut, bukan sirene, karena sifatnya pemberitahuan netral, bukan tuduhan (aturan keras #3).
// Browser hanya mengizinkan suara setelah ada klik di halaman, jadi proyektor menampilkan tombol "Aktifkan suara".
import { ref } from 'vue';

// Jarak minimum antarbunyi: beberapa siswa yang pergi bersamaan cukup ditandai sekali.
const JEDA_MIN_MS = 3000;

let konteks: AudioContext | null = null;
let terakhirBunyi = 0;

export const suaraAktif = ref(false);

// Harus dipanggil dari klik. Mengembalikan false bila browser tidak mendukung/menolak.
export async function aktifkanSuara(): Promise<boolean> {
  try {
    konteks ??= new AudioContext();
    await konteks.resume();
    suaraAktif.value = konteks.state === 'running';
    if (suaraAktif.value) bunyikan(true);
  } catch {
    suaraAktif.value = false;
  }
  return suaraAktif.value;
}

export function matikanSuara(): void {
  suaraAktif.value = false;
}

function nada(ctx: AudioContext, frekuensi: number, mulai: number, lama: number, volume: number): void {
  const osc = ctx.createOscillator();
  const penguat = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = frekuensi;
  // Serangan cepat lalu meluruh pelan, seperti bel kecil; tanpa "klik" di awal/akhir.
  penguat.gain.setValueAtTime(0.0001, mulai);
  penguat.gain.exponentialRampToValueAtTime(volume, mulai + 0.02);
  penguat.gain.exponentialRampToValueAtTime(0.0001, mulai + lama);
  osc.connect(penguat).connect(ctx.destination);
  osc.start(mulai);
  osc.stop(mulai + lama + 0.05);
}

// `paksa` = abaikan jeda minimum (dipakai saat uji suara dari tombol).
export function bunyikan(paksa = false): void {
  if (!suaraAktif.value || !konteks || konteks.state !== 'running') return;
  const kini = performance.now();
  if (!paksa && kini - terakhirBunyi < JEDA_MIN_MS) return;
  terakhirBunyi = kini;
  const t = konteks.currentTime;
  // E6 lalu C6 (terts besar turun): jelas terdengar di kelas, tetapi tidak mengagetkan.
  nada(konteks, 1318.5, t, 0.6, 0.25);
  nada(konteks, 1046.5, t + 0.22, 0.9, 0.25);
}
