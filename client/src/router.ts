// client/src/router.ts — daftar halaman (docs/DESAIN.md §10) dan penjaga halaman guru.
// Dipanggil oleh: client/src/main.ts.
// Memanggil: vue-router, halaman di client/src/halaman/, client/src/api.ts.
// Halaman guru & proyektor dimuat "lazy" (import() terpisah): kodenya tidak ikut terunduh ke laptop
// siswa yang hanya membuka halaman masuk & ujian.
import { createRouter, createWebHistory } from 'vue-router';
import { api, GalatApi } from './api.ts';
import MasukPeserta from './halaman/MasukPeserta.vue';
import UjianPeserta from './halaman/UjianPeserta.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: MasukPeserta },
    { path: '/ujian', component: UjianPeserta },
    { path: '/guru/masuk', component: () => import('./halaman/MasukGuru.vue') },
    { path: '/guru', component: () => import('./halaman/BerandaGuru.vue'), meta: { perluGuru: true } },
    // :id(\\d+) — hanya angka; alamat lain jatuh ke rute "lainnya" di bawah.
    {
      path: '/guru/ujian/:id(\\d+)',
      component: () => import('./halaman/PenyusunanUjian.vue'),
      meta: { perluGuru: true },
    },
    { path: '/p', component: () => import('./halaman/Proyektor.vue') },
    { path: '/:lainnya(.*)*', redirect: '/' },
  ],
});

// Halaman guru hanya untuk guru yang sudah masuk; selain itu diarahkan ke /guru/masuk.
// Ini kenyamanan tampilan saja — keamanan sesungguhnya ada di server (setiap /api guru wajib sesi guru).
router.beforeEach(async (tujuan) => {
  if (!tujuan.meta.perluGuru) return true;
  try {
    await api('GET', '/api/penguji/saya');
    return true;
  } catch (galat) {
    if (galat instanceof GalatApi && galat.status === 401) {
      return { path: '/guru/masuk', query: { lanjut: tujuan.fullPath } };
    }
    return true;
  }
});
