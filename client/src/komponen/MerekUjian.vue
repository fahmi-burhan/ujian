<!--
  client/src/komponen/MerekUjian.vue — merek aplikasi: tanda logo + nama "ujian" (huruf kecil, tebal, rapat;
  keputusan pemilik 22 Nov). Prop `ukuran`: 'sedang' untuk bilah atas guru, 'besar' untuk halaman masuk & proyektor.
  Dipanggil oleh: KepalaGuru.vue, MasukGuru.vue, MasukPeserta.vue, Proyektor.vue.
  Memanggil: client/src/komponen/LogoUjian.vue.
-->
<script setup lang="ts">
import LogoUjian from './LogoUjian.vue';

withDefaults(defineProps<{ ukuran?: 'sedang' | 'besar' }>(), { ukuran: 'sedang' });
</script>

<template>
  <span class="inline-flex items-center gap-2 text-base-content">
    <LogoUjian :class="ukuran === 'besar' ? 'w-11 h-11' : 'w-8 h-8'" />
    <span class="font-bold tracking-tight leading-none" :class="ukuran === 'besar' ? 'text-3xl' : 'text-2xl'">ujian</span>
  </span>
</template>
