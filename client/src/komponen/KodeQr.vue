<!--
  client/src/komponen/KodeQr.vue — gambar QR code dari sebuah teks (dipakai untuk alamat masuk siswa + kode ujian).
  Dipanggil oleh: client/src/halaman/Proyektor.vue. Memanggil: uqr (pustaka QR tanpa dependensi, dibundel Vite).
  Kotak-kotak QR digambar sebagai satu <path> SVG di template (tanpa v-html), hitam di atas putih dengan tepi kosong
  supaya mudah dipindai kamera HP dari layar proyektor, juga saat tema gelap.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { encode } from 'uqr';

const props = defineProps<{ teks: string; label: string }>();

// Koreksi galat tingkat M: cukup tahan pantulan/silau proyektor, kotaknya tetap besar.
const qr = computed(() => {
  const hasil = encode(props.teks, { ecc: 'M', border: 2 });
  let d = '';
  hasil.data.forEach((baris, y) =>
    baris.forEach((hitam, x) => {
      if (hitam) d += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return { ukuran: hasil.size, d };
});
</script>

<template>
  <svg :viewBox="`0 0 ${qr.ukuran} ${qr.ukuran}`" shape-rendering="crispEdges" role="img" :aria-label="label">
    <rect :width="qr.ukuran" :height="qr.ukuran" fill="#ffffff" />
    <path :d="qr.d" fill="#000000" />
  </svg>
</template>
