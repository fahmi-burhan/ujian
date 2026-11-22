<!--
  client/src/komponen/LogoUjian.vue — tanda logo (keputusan pemilik 22 Nov): otak padat dengan lekuk sebagai celah,
  dan pena yang menulis satu garis. Satu warna tanpa latar: warnanya mengikuti `color` pemanggil (currentColor),
  jadi cocok di tema terang & gelap. Ukuran diatur lewat class (mis. class="w-8 h-8").
  Dipanggil oleh: client/src/komponen/MerekUjian.vue (logo + nama "ujian").
  Memanggil: tidak ada. Bentuk yang sama untuk ikon tab browser: client/public/logo.svg (harus disamakan).
  Lekuk otak dan celah di sekitar pena dibuat dengan mask. id mask dibuat unik per logo (useId) karena logo bisa
  tampil lebih dari sekali di satu halaman.
-->
<script setup lang="ts">
import { useId } from 'vue';

const idMask = `logo-ujian-${useId()}`;
// Bentuk otak digambar kecil lalu diperbesar 2× di sekitar titik (28, 26).
const SKALA_OTAK = 'translate(28 26) scale(2) translate(-26 -28.5)';
</script>

<template>
  <svg viewBox="0 0 64 64" role="img" aria-label="Logo ujian" class="shrink-0">
    <defs>
      <mask :id="idMask">
        <rect width="64" height="64" fill="#fff" />
        <!-- Lekuk otak -->
        <g :transform="SKALA_OTAK" stroke="#000" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" fill="none">
          <path d="M26 21.6V36.4" />
          <path d="M20.4 26.6C21.9 25.8 23.4 26.4 23.4 28M31.6 26.6C30.1 25.8 28.6 26.4 28.6 28" />
          <path d="M18.6 31.6C20 32.4 21.8 32 22.4 30.8M33.4 31.6C32 32.4 30.2 32 29.6 30.8" />
        </g>
        <!-- Celah di sekitar pena -->
        <path d="M42 50L54 38L57.5 41.5L45.5 53.5Z M41 51L44.5 54.5L39 56.5Z" fill="#000" stroke="#000" stroke-width="6" stroke-linejoin="round" />
      </mask>
    </defs>
    <!-- Otak -->
    <path
      fill="currentColor"
      :mask="`url(#${idMask})`"
      :transform="SKALA_OTAK"
      d="M26 20.5C23.5 18.5 19.5 19.5 19 23C15.5 23.5 14.5 28 17 30C15 32.5 17 36.5 20.5 36C21.5 38.5 25 39 26 37C27 39 30.5 38.5 31.5 36C35 36.5 37 32.5 35 30C37.5 28 36.5 23.5 33 23C32.5 19.5 28.5 18.5 26 20.5Z"
    />
    <!-- Pena & garis tulisan -->
    <path fill="currentColor" d="M42 50L54 38L57.5 41.5L45.5 53.5Z" />
    <path fill="currentColor" d="M41 51L44.5 54.5L39 56.5Z" />
    <path stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M20 59.5H35" />
  </svg>
</template>
