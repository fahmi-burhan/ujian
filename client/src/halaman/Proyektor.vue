<!--
  client/src/halaman/Proyektor.vue — layar proyektor (alamat "/p").
  Cara pakai: guru menekan "Buka layar proyektor" (Fase 5) → jendela baru /p?kode=XXXXXXXX, atau
  guru mengetik kode 8 karakter di PC kelas. Kode langsung dihapus dari alamat setelah ditukar menjadi
  sesi proyektor, sehingga tidak terlihat bila layar ini terproyeksi.
  Saat ini (Fase 2) menampilkan judul & status ujian; sisa waktu, progres, dan aktivitas ditambahkan di Fase 5.
  Dipanggil oleh: client/src/router.ts. Memanggil: POST /api/proyektor/masuk, GET /api/proyektor/saya.
-->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ProyektorSayaSchema } from '../../../shared/auth.ts';
import type { ProyektorSaya, StatusUjian } from '../../../shared/auth.ts';
import { PANJANG_KODE_PROYEKTOR, rapikanKode } from '../../../shared/alfabet.ts';
import { api, GalatApi, pesanGalat } from '../api.ts';

const route = useRoute();
const router = useRouter();
const data = ref<ProyektorSaya | null>(null);
const kode = ref('');
const galat = ref('');
const memuat = ref(true);

const LABEL_STATUS: Record<StatusUjian, string> = {
  draf: 'Belum dibuka',
  menunggu: 'Menunggu dimulai',
  berlangsung: 'Sedang berlangsung',
  dijeda: 'DIJEDA',
  selesai: 'Selesai',
  penilaian: 'Selesai',
  dirilis: 'Selesai',
};

async function muatData(): Promise<void> {
  try {
    data.value = await api('GET', '/api/proyektor/saya', { skema: ProyektorSayaSchema });
  } catch (e) {
    data.value = null;
    if (!(e instanceof GalatApi && e.status === 401)) galat.value = pesanGalat(e);
  }
}

async function tukarKode(teks: string): Promise<void> {
  galat.value = '';
  memuat.value = true;
  try {
    await api('POST', '/api/proyektor/masuk', { body: { kode: rapikanKode(teks) } });
    await muatData();
  } catch (e) {
    galat.value = e instanceof GalatApi && e.kode === 'kode_salah' ? 'Kode tidak berlaku atau sudah dipakai. Minta kode baru di dasbor guru.' : pesanGalat(e);
  } finally {
    memuat.value = false;
  }
}

onMounted(async () => {
  const dariAlamat = route.query.kode;
  if (typeof dariAlamat === 'string' && dariAlamat.length > 0) {
    // Hapus kode dari alamat lebih dulu, baru ditukar.
    await router.replace({ path: '/p', query: {} });
    await tukarKode(dariAlamat);
    return;
  }
  await muatData();
  memuat.value = false;
});
</script>

<template>
  <main class="min-h-screen bg-base-100 flex items-center justify-center p-8" data-theme="light">
    <div v-if="memuat" class="loading loading-spinner loading-lg"></div>

    <div v-else-if="data" class="text-center flex flex-col gap-6">
      <h1 class="text-5xl md:text-7xl font-bold">{{ data.ujian.judul }}</h1>
      <p class="text-3xl md:text-4xl">
        <span class="badge badge-lg text-2xl p-6" :class="data.ujian.status === 'dijeda' ? 'badge-warning' : 'badge-neutral'">
          {{ LABEL_STATUS[data.ujian.status] }}
        </span>
      </p>
    </div>

    <form v-else class="card bg-base-200 w-full max-w-md" @submit.prevent="tukarKode(kode)">
      <div class="card-body gap-3">
        <h1 class="card-title text-2xl">
          <i class="fa-solid fa-display" aria-hidden="true"></i>
          Layar Proyektor
        </h1>
        <p class="text-base-content/70">Ketik kode proyektor dari dasbor guru (berlaku 10 menit, sekali pakai).</p>
        <div v-if="galat" role="alert" class="alert alert-error">
          <span>{{ galat }}</span>
        </div>
        <input
          v-model="kode"
          class="input input-bordered input-lg font-mono tracking-[0.3em] uppercase text-center"
          :maxlength="PANJANG_KODE_PROYEKTOR + 2"
          autocomplete="off"
          spellcheck="false"
          autofocus
        />
        <button class="btn btn-primary" type="submit" :disabled="rapikanKode(kode).length !== PANJANG_KODE_PROYEKTOR">
          Tampilkan
        </button>
      </div>
    </form>
  </main>
</template>
