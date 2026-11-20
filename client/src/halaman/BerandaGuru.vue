<!--
  client/src/halaman/BerandaGuru.vue — beranda guru (alamat "/guru").
  Saat ini (Fase 2) menampilkan akun yang sedang masuk dan tombol keluar. Daftar & penyusunan ujian
  ditambahkan di Fase 3 pada halaman ini.
  Dipanggil oleh: client/src/router.ts (hanya setelah lolos penjaga sesi guru).
  Memanggil: GET /api/penguji/saya, POST /api/penguji/keluar.
-->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { PengujiSayaSchema } from '../../../shared/auth.ts';
import type { PengujiSaya } from '../../../shared/auth.ts';
import { api, pesanGalat } from '../api.ts';

const router = useRouter();
const saya = ref<PengujiSaya | null>(null);
const galat = ref('');

onMounted(async () => {
  try {
    saya.value = await api('GET', '/api/penguji/saya', { skema: PengujiSayaSchema });
  } catch (e) {
    galat.value = pesanGalat(e);
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
  <div class="min-h-screen bg-base-200">
    <header class="navbar bg-base-100 shadow-sm px-4">
      <div class="flex-1 gap-2 text-lg font-semibold">
        <i class="fa-solid fa-pen-to-square text-primary" aria-hidden="true"></i>
        Ujian Esai — Guru
      </div>
      <div v-if="saya" class="flex-none gap-3 flex items-center">
        <span class="hidden sm:inline text-sm">{{ saya.nama }}</span>
        <button class="btn btn-ghost btn-sm" type="button" @click="keluar">
          <i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i> Keluar
        </button>
      </div>
    </header>
    <main class="max-w-6xl mx-auto p-4">
      <div v-if="galat" role="alert" class="alert alert-error">
        <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
        <span>{{ galat }}</span>
      </div>
      <div v-else-if="saya" class="card bg-base-100 shadow">
        <div class="card-body">
          <h1 class="card-title">Selamat datang, {{ saya.nama }}</h1>
          <p class="text-base-content/70">Anda masuk sebagai <span class="font-mono">{{ saya.username }}</span>.</p>
        </div>
      </div>
    </main>
  </div>
</template>
