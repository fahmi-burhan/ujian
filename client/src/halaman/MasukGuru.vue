<!--
  client/src/halaman/MasukGuru.vue — login guru (alamat "/guru/masuk").
  Dipanggil oleh: client/src/router.ts (juga tujuan pengalihan bila sesi guru habis).
  Memanggil: POST /api/penguji/masuk.
  Akun guru dibuat lewat terminal (`npm run penguji:buat`), tidak ada pendaftaran di web.
-->
<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, pesanGalat } from '../api.ts';
import MerekUjian from '../komponen/MerekUjian.vue';

const router = useRouter();
const route = useRoute();
const username = ref('');
const password = ref('');
const galat = ref('');
const memuat = ref(false);

// Hanya kembali ke halaman guru; alamat lain diabaikan agar tautan aneh tidak bisa membelokkan guru.
function tujuanSetelahMasuk(): string {
  const lanjut = route.query.lanjut;
  return typeof lanjut === 'string' && lanjut.startsWith('/guru') ? lanjut : '/guru';
}

async function masuk(): Promise<void> {
  galat.value = '';
  memuat.value = true;
  try {
    await api('POST', '/api/penguji/masuk', { body: { username: username.value, password: password.value } });
    await router.replace(tujuanSetelahMasuk());
  } catch (e) {
    galat.value = pesanGalat(e);
    password.value = '';
  } finally {
    memuat.value = false;
  }
}
</script>

<template>
  <main class="min-h-screen bg-base-200 flex items-center justify-center p-4">
    <form class="card bg-base-100 shadow-xl w-full max-w-sm" @submit.prevent="masuk">
      <div class="card-body gap-3">
        <MerekUjian ukuran="besar" class="self-center mb-1" />
        <h1 class="card-title text-2xl">Masuk Guru</h1>
        <div v-if="galat" role="alert" class="alert alert-error">
          <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
          <span>{{ galat }}</span>
        </div>
        <label class="form-control w-full">
          <span class="label-text mb-1">Username</span>
          <input v-model="username" class="input input-bordered w-full" autocomplete="username" autofocus required />
        </label>
        <label class="form-control w-full">
          <span class="label-text mb-1">Password</span>
          <input
            v-model="password"
            class="input input-bordered w-full"
            type="password"
            autocomplete="current-password"
            minlength="10"
            required
          />
        </label>
        <button class="btn btn-primary mt-2" type="submit" :disabled="memuat">
          <span v-if="memuat" class="loading loading-spinner"></span>
          Masuk
        </button>
      </div>
    </form>
  </main>
</template>
