<!--
  client/src/halaman/BerandaGuru.vue — beranda guru (alamat "/guru"): daftar ujian milik guru dan
  form membuat ujian baru, dan tombol Duplikasi per ujian.
  Dipanggil oleh: client/src/router.ts (hanya setelah lolos penjaga sesi guru).
  Memanggil: GET /api/ujian, POST /api/ujian; komponen KepalaGuru, DialogDuplikasi, PerangkatDikenal.
-->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { DaftarUjianSchema, UjianDetailSchema } from '../../../shared/ujian.ts';
import type { UjianRingkas } from '../../../shared/ujian.ts';
import { api, pesanGalat } from '../api.ts';
import DialogDuplikasi from '../komponen/guru/DialogDuplikasi.vue';
import KepalaGuru from '../komponen/guru/KepalaGuru.vue';
import PerangkatDikenal from '../komponen/guru/PerangkatDikenal.vue';
import { LABEL_STATUS_UJIAN, WARNA_STATUS_UJIAN, waktuWib } from '../label.ts';

const router = useRouter();
const daftar = ref<UjianRingkas[] | null>(null);
const galat = ref('');
const judul = ref('');
const durasi = ref(90);
const membuat = ref(false);
const diduplikasi = ref<UjianRingkas | null>(null);

onMounted(async () => {
  try {
    daftar.value = await api('GET', '/api/ujian', { skema: DaftarUjianSchema });
  } catch (e) {
    galat.value = pesanGalat(e);
  }
});

async function buat(): Promise<void> {
  galat.value = '';
  membuat.value = true;
  try {
    const ujian = await api('POST', '/api/ujian', {
      body: { judul: judul.value, durasi_menit: durasi.value },
      skema: UjianDetailSchema,
    });
    await router.push(`/guru/ujian/${ujian.id}`);
  } catch (e) {
    galat.value = pesanGalat(e);
  } finally {
    membuat.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen bg-base-200">
    <KepalaGuru />
    <main class="max-w-5xl mx-auto p-4 flex flex-col gap-4">
      <div v-if="galat" role="alert" class="alert alert-error">
        <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
        <span>{{ galat }}</span>
      </div>

      <form class="card bg-base-100 shadow" @submit.prevent="buat">
        <div class="card-body">
          <h2 class="card-title"><i class="fa-solid fa-plus" aria-hidden="true"></i> Ujian baru</h2>
          <div class="flex flex-col sm:flex-row gap-3 sm:items-end">
            <label class="flex flex-col gap-1 flex-1">
              <span class="text-sm">Judul</span>
              <input v-model="judul" class="input w-full" maxlength="200" required placeholder="mis. Latihan Ekonomi Bab 3" />
            </label>
            <label class="flex flex-col gap-1 sm:w-40">
              <span class="text-sm">Durasi (menit)</span>
              <input v-model.number="durasi" class="input w-full" type="number" min="1" max="600" required />
            </label>
            <button class="btn btn-primary" type="submit" :disabled="membuat || !judul.trim()">
              <span v-if="membuat" class="loading loading-spinner"></span>
              Buat
            </button>
          </div>
        </div>
      </form>

      <section class="card bg-base-100 shadow">
        <div class="card-body">
          <h2 class="card-title"><i class="fa-solid fa-list" aria-hidden="true"></i> Ujian saya</h2>
          <div v-if="!daftar" class="flex items-center gap-2"><span class="loading loading-spinner"></span> Memuat…</div>
          <p v-else-if="daftar.length === 0" class="text-base-content/70">Belum ada ujian. Buat ujian pertama di atas.</p>
          <div v-else class="overflow-x-auto">
            <table class="table">
              <thead>
                <tr><th>Judul</th><th>Kode</th><th>Status</th><th>Soal</th><th>Peserta</th><th>Diubah</th><th><span class="sr-only">Aksi</span></th></tr>
              </thead>
              <tbody>
                <tr v-for="u in daftar" :key="u.id" class="hover:bg-base-200">
                  <td>
                    <RouterLink :to="`/guru/ujian/${u.id}`" class="link link-hover font-medium">{{ u.judul }}</RouterLink>
                  </td>
                  <td class="font-mono">{{ u.kode }}</td>
                  <td><span class="badge" :class="WARNA_STATUS_UJIAN[u.status]">{{ LABEL_STATUS_UJIAN[u.status] }}</span></td>
                  <td>{{ u.jumlah_soal }}</td>
                  <td>{{ u.jumlah_peserta }}</td>
                  <td class="text-sm text-base-content/70">{{ waktuWib(u.diubah_at) }}</td>
                  <td>
                    <button type="button" class="btn btn-xs btn-ghost" :aria-label="`Duplikasi ${u.judul}`" title="Duplikasi" @click="diduplikasi = u">
                      <i class="fa-solid fa-copy" aria-hidden="true"></i>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <PerangkatDikenal />
    </main>
    <DialogDuplikasi v-if="diduplikasi" :ujian="diduplikasi" @tutup="diduplikasi = null" />
  </div>
</template>
