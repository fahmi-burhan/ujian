// client/src/router.ts — daftar halaman (docs/DESAIN.md §10), judul tab browser, dan penjaga halaman guru.
// Dipanggil oleh: client/src/main.ts.
// Memanggil: vue-router, halaman di client/src/halaman/, client/src/api.ts.
// Halaman guru & proyektor dimuat "lazy" (import() terpisah): kodenya tidak ikut terunduh ke laptop
// siswa yang hanya membuka halaman masuk & ujian.
import { createRouter, createWebHistory } from 'vue-router';
import { api, GalatApi } from './api.ts';
import MasukPeserta from './halaman/MasukPeserta.vue';
import UjianPeserta from './halaman/UjianPeserta.vue';

export const NAMA_APLIKASI = 'Ujian';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: MasukPeserta, meta: { judul: 'Masuk' } },
    { path: '/ujian', component: UjianPeserta },
    { path: '/guru/masuk', component: () => import('./halaman/MasukGuru.vue'), meta: { judul: 'Masuk Guru' } },
    { path: '/guru', component: () => import('./halaman/BerandaGuru.vue'), meta: { perluGuru: true, judul: 'Guru' } },
    // :id(\\d+) = hanya angka; alamat lain jatuh ke rute "lainnya" di bawah.
    {
      path: '/guru/ujian/:id(\\d+)',
      component: () => import('./halaman/PenyusunanUjian.vue'),
      meta: { perluGuru: true, judul: 'Penyusunan' },
    },
    {
      path: '/guru/ujian/:id(\\d+)/pantau',
      component: () => import('./halaman/PantauUjian.vue'),
      meta: { perluGuru: true, judul: 'Pemantauan' },
    },
    {
      path: '/guru/ujian/:id(\\d+)/nilai',
      component: () => import('./halaman/PenilaianUjian.vue'),
      meta: { perluGuru: true, judul: 'Penilaian' },
    },
    { path: '/p', component: () => import('./halaman/Proyektor.vue'), meta: { judul: 'Proyektor' } },
    { path: '/:lainnya(.*)*', redirect: '/' },
  ],
});

// Halaman guru hanya untuk guru yang sudah masuk; selain itu diarahkan ke /guru/masuk.
// Ini kenyamanan tampilan saja; keamanan sesungguhnya ada di server (setiap /api guru wajib sesi guru).
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

// Judul tab: "Ujian" atau "Ujian | Penilaian" (pemisah | sesuai permintaan pemilik 22 Nov).
router.afterEach((tujuan) => {
  const judul = typeof tujuan.meta.judul === 'string' ? tujuan.meta.judul : '';
  document.title = judul ? `${NAMA_APLIKASI} | ${judul}` : NAMA_APLIKASI;
});
