<!--
  client/src/halaman/UjianPeserta.vue — halaman siswa setelah masuk (alamat "/ujian").
  Saat ini (Fase 2) menampilkan identitas siswa dan status ujian. Ruang tunggu dengan PDF, pengerjaan
  soal, autosave, dan timer ditambahkan di Fase 4 pada halaman yang sama.
  Dipanggil oleh: client/src/router.ts.
  Memanggil: GET /api/peserta/saya, POST /api/peserta/keluar.
-->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { PesertaSayaSchema } from '../../../shared/auth.ts';
import type { PesertaSaya, StatusPeserta, StatusUjian } from '../../../shared/auth.ts';
import { api, GalatApi, pesanGalat } from '../api.ts';

const router = useRouter();
const saya = ref<PesertaSaya | null>(null);
const galat = ref('');

const KETERANGAN_UJIAN: Record<StatusUjian, string> = {
  // Siswa hanya bisa melihat status draf bila guru menutup kembali ujian yang sudah dibuka.
  draf: 'Ujian ditutup kembali oleh guru. Tunggu sampai dibuka lagi.',
  menunggu: 'Ujian belum dimulai. Tunggu aba-aba dari guru.',
  berlangsung: 'Ujian sedang berlangsung.',
  dijeda: 'Ujian sedang dijeda oleh pengawas.',
  selesai: 'Ujian sudah selesai.',
  penilaian: 'Jawaban sedang dinilai. Nilai belum dirilis.',
  dirilis: 'Nilai sudah dirilis.',
};
const KETERANGAN_PESERTA: Record<StatusPeserta, string> = {
  belum_masuk: 'Belum masuk',
  menunggu: 'Menunggu dimulai',
  mengerjakan: 'Mengerjakan',
  dikumpulkan: 'Jawaban sudah dikumpulkan',
};

onMounted(async () => {
  try {
    saya.value = await api('GET', '/api/peserta/saya', { skema: PesertaSayaSchema });
  } catch (e) {
    if (e instanceof GalatApi && e.status === 401) {
      await router.replace('/');
      return;
    }
    galat.value = pesanGalat(e);
  }
});

async function keluar(): Promise<void> {
  try {
    await api('POST', '/api/peserta/keluar');
  } finally {
    await router.replace('/');
  }
}
</script>

<template>
  <main class="min-h-screen bg-base-200 flex items-center justify-center p-4">
    <div class="card bg-base-100 shadow-xl w-full max-w-lg">
      <div class="card-body gap-4">
        <div v-if="galat" role="alert" class="alert alert-error">
          <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
          <span>{{ galat }}</span>
        </div>
        <div v-else-if="!saya" class="flex items-center gap-2">
          <span class="loading loading-spinner"></span> Memuat…
        </div>
        <template v-else>
          <p class="text-sm text-base-content/60">{{ saya.ujian.judul }}</p>
          <h1 class="card-title text-2xl">
            <i class="fa-solid fa-user-check text-success" aria-hidden="true"></i>
            {{ saya.nama }}
            <span v-if="saya.nomor" class="badge badge-ghost font-mono">{{ saya.nomor }}</span>
          </h1>
          <div class="alert">
            <i class="fa-solid fa-hourglass-half" aria-hidden="true"></i>
            <span>{{ KETERANGAN_UJIAN[saya.ujian.status] }}</span>
          </div>
          <p class="text-sm">Status kamu: <span class="font-semibold">{{ KETERANGAN_PESERTA[saya.status] }}</span></p>
          <div class="card-actions justify-end">
            <button class="btn btn-ghost btn-sm" type="button" @click="keluar">
              <i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i> Keluar
            </button>
          </div>
        </template>
      </div>
    </div>
  </main>
</template>
