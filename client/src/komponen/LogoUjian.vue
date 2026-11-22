<!--
  client/src/komponen/LogoUjian.vue — logo aplikasi: kepala (profil) berisi otak, kertas, dan pensil yang sedang
  menulis. Satu warna tanpa latar: warnanya mengikuti `color` dari pemanggil (currentColor), jadi otomatis cocok di
  tema terang & gelap. Ukuran & warna diatur lewat class (mis. class="w-8 h-8 text-primary").
  Dipanggil oleh: KepalaGuru.vue, MasukGuru.vue, MasukPeserta.vue, Proyektor.vue.
  Memanggil: tidak ada. Gambar yang sama untuk ikon tab browser: client/public/logo.svg (bentuk harus disamakan).
  Mask = celah tipis di sekitar pensil supaya garis kertas tidak menempel ke pensil. id mask dibuat unik per logo
  (useId) karena logo bisa tampil lebih dari sekali di satu halaman.
-->
<script setup lang="ts">
import { useId } from 'vue';

const idMask = `logo-ujian-celah-${useId()}`;
</script>

<template>
  <svg viewBox="0 0 64 64" role="img" aria-label="Logo Ujian" class="shrink-0" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
    <defs>
      <mask :id="idMask">
        <rect width="64" height="64" fill="#fff" />
        <path d="M47.5 55.5L48.9 49.9L58.8 40L63 44.2L53.1 54.1Z" fill="#000" stroke="#000" stroke-width="5" />
      </mask>
    </defs>
    <!-- Kepala menghadap kanan -->
    <path stroke-width="3.5" d="M9 60V49C5 45 3 40 3 34C3 22.5 11.5 14 22.5 14C31 14 36 19 37 26L39.5 33H36V38.5C36 40.5 34.5 42 32.5 42H29V60" />
    <!-- Otak -->
    <g stroke-width="2.5" transform="translate(-5 6)">
      <path
        d="M15.5 27.5C13 25 14.5 20.5 18.5 20.5C19 17 23.5 15.5 26 18C28.5 15.5 33.5 17 33.5 21C36.5 22 36.5 27 33.5 28C34 31.5 30 33.5 27.5 31.5C25.5 34 21 34 20 31C16.5 32 14 29.5 15.5 27.5Z"
      />
      <path d="M25.5 19V31M20 24.5C21.5 25.5 23 25.5 25.5 24.5M25.5 26C28 27 30 26.5 31 25" />
    </g>
    <!-- Kertas bergaris -->
    <g :mask="`url(#${idMask})`">
      <path stroke-width="3.5" d="M43 28H55L61 34V61H43Z" />
      <path stroke-width="3" d="M47.5 40H56.5M47.5 47H56.5M45 55.5H47.5" />
    </g>
    <!-- Pensil yang sedang menulis -->
    <g fill="currentColor" stroke="none">
      <path d="M47.5 55.5L53.1 54.1L48.9 49.9Z" />
      <path d="M49.6 49.2L59.5 39.3L63.7 43.5L53.8 53.4Z" />
    </g>
  </svg>
</template>
