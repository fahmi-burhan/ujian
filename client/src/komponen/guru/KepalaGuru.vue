<!--
  client/src/komponen/guru/KepalaGuru.vue — bilah atas semua halaman guru: nama aplikasi (kembali ke daftar
  ujian), nama guru, dan tombol keluar.
  Dipanggil oleh: client/src/halaman/BerandaGuru.vue, PenyusunanUjian.vue.
  Memanggil: GET /api/penguji/saya, POST /api/penguji/keluar.
-->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { PengujiSayaSchema } from '../../../../shared/auth.ts';
import type { PengujiSaya } from '../../../../shared/auth.ts';
import { api } from '../../api.ts';
import LogoUjian from '../LogoUjian.vue';

const router = useRouter();
const saya = ref<PengujiSaya | null>(null);

onMounted(async () => {
  try {
    saya.value = await api('GET', '/api/penguji/saya', { skema: PengujiSayaSchema });
  } catch {
    // Galat sesi ditangani penjaga router; nama guru sekadar tidak tampil.
  }
});

async function keluar(): Promise<void> {
  try {
    await api('POST', '/api/penguji/keluar');
  } finally {
    await router.replace('/guru/masuk');
  }
}
</script>

<template>
  <header class="navbar bg-base-100 shadow-sm px-4">
    <div class="flex-1">
      <RouterLink to="/guru" class="flex items-center gap-2 text-lg font-semibold">
        <LogoUjian class="w-8 h-8" />
        <span>Ujian <span class="text-base-content/40 font-normal">|</span> Guru</span>
      </RouterLink>
    </div>
    <div class="flex-none flex items-center gap-3">
      <span v-if="saya" class="hidden sm:inline text-sm">{{ saya.nama }}</span>
      <button class="btn btn-ghost btn-sm" type="button" @click="keluar">
        <i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i> Keluar
      </button>
    </div>
  </header>
</template>
