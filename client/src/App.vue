<!--
  client/src/App.vue — komponen akar: halaman sesuai alamat (vue-router), plus modal konfirmasi bersama yang dibuka
  lewat konfirmasi() (client/src/konfirmasi.ts).
  Dipanggil oleh: client/src/main.ts. Memanggil: halaman di client/src/halaman/ lewat <RouterView>,
  client/src/komponen/DialogKonfirmasi.vue.
-->
<script setup lang="ts">
import DialogKonfirmasi from './komponen/DialogKonfirmasi.vue';
</script>

<template>
  <RouterView />
  <DialogKonfirmasi />
</template>
