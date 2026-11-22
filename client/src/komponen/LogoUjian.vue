<!--
  client/src/komponen/LogoUjian.vue — tanda logo (keputusan pemilik 22 Nov, kandidat "D"): kepala padat menghadap
  kanan dengan otak sebagai celah di dalamnya, dan pena emas yang sedang menulis satu garis. Gaya padat-minimal tanpa
  latar. Warna utama mengikuti `color` pemanggil (currentColor), jadi cocok di tema terang & gelap; aksen pena emas.
  Ukuran diatur lewat class (mis. class="w-8 h-8").
  Dipanggil oleh: client/src/komponen/MerekUjian.vue (logo + nama "ujian").
  Memanggil: tidak ada. Bentuk yang sama untuk ikon tab browser: client/public/logo.svg (harus disamakan).
  Otak dibuat dengan mask (bagian kepala yang "dilubangi"). id mask dibuat unik per logo (useId) karena logo bisa
  tampil lebih dari sekali di satu halaman.
-->
<script setup lang="ts">
import { useId } from 'vue';

const idMask = `logo-ujian-otak-${useId()}`;
</script>

<template>
  <svg viewBox="0 0 64 64" role="img" aria-label="Logo ujian" class="shrink-0">
    <defs>
      <mask :id="idMask">
        <rect width="64" height="64" fill="#fff" />
        <g stroke="#000" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none">
          <path d="M26 20.5C23.5 18.5 19.5 19.5 19 23C15.5 23.5 14.5 28 17 30C15 32.5 17 36.5 20.5 36C21.5 38.5 25 39 26 37Z" />
          <path d="M26 20.5C28.5 18.5 32.5 19.5 33 23C36.5 23.5 37.5 28 35 30C37 32.5 35 36.5 31.5 36C30.5 38.5 27 39 26 37" />
          <path d="M21 27.5C22.5 26.5 24 27 24 28.5M31 27.5C29.5 26.5 28 27 28 28.5" />
        </g>
      </mask>
    </defs>
    <!-- Kepala (otak = celah dari mask) -->
    <path
      fill="currentColor"
      :mask="`url(#${idMask})`"
      d="M13 60V50.5C7.6 46.4 4.5 40.4 4.5 33.5C4.5 21.3 14.3 12 26.5 12C36.6 12 43.4 18.3 44.5 26.5L47.6 34.4C48 35.5 47.2 36.6 46 36.6H43.5V41.5C43.5 44.5 41.2 46.8 38.2 46.8H34V60Z"
    />
    <!-- Pena emas & garis tulisan -->
    <path fill="#f59e0b" d="M51 44L60.5 34.5L63.5 37.5L54 47Z" />
    <path fill="#f59e0b" d="M50 45L53 48L48.5 49.5Z" />
    <path stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M40 56H55" />
  </svg>
</template>
