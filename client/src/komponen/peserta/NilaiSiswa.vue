<!--
  client/src/komponen/peserta/NilaiSiswa.vue — hasil ujian untuk siswa setelah nilai dirilis: nilai akhir, lalu per
  soal: nilai, jawaban sendiri, kriteria beserta level yang dicapai, catatan guru, dan jawaban acuan (keputusan pemilik
  22 Nov; aturan keras #1 mengizinkan ini HANYA setelah dirilis, dicek server).
  Dipanggil oleh: client/src/halaman/UjianPeserta.vue (status ujian 'dirilis').
  Memanggil: GET /api/peserta/nilai.
  Semua teks dirender sebagai teks ({{ }}), tidak pernah sebagai HTML.
-->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { angka, NilaiPesertaSchema } from '../../../../shared/nilai.ts';
import type { NilaiPeserta } from '../../../../shared/nilai.ts';
import { api, pesanGalat } from '../../api.ts';

const data = ref<NilaiPeserta | null>(null);
const galat = ref('');

onMounted(async () => {
  try {
    data.value = await api('GET', '/api/peserta/nilai', { skema: NilaiPesertaSchema });
  } catch (e) {
    galat.value = pesanGalat(e);
  }
});
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-if="galat" role="alert" class="alert alert-error"><span>{{ galat }}</span></div>
    <div v-if="!data && !galat" class="flex items-center gap-2"><span class="loading loading-spinner"></span> Memuat nilai…</div>
    <template v-if="data">
      <div v-if="!data.hadir" role="status" class="alert">
        <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
        <span>Kamu tercatat tidak mengikuti ujian ini, jadi tidak ada nilai.</span>
      </div>
      <template v-else>
        <div class="stats shadow bg-base-200">
          <div class="stat">
            <div class="stat-title">Nilai akhir</div>
            <div class="stat-value text-primary">{{ angka(data.nilai_akhir ?? 0) }}</div>
            <div class="stat-desc">dari 100</div>
          </div>
        </div>
        <section v-for="s in data.soal" :key="s.urutan" class="border border-base-300 rounded-box p-3 flex flex-col gap-2">
          <div class="flex flex-wrap items-baseline gap-2">
            <h2 class="font-semibold flex-1">Soal {{ s.urutan }}: {{ s.judul }}</h2>
            <span class="font-mono font-bold">{{ angka(s.nilai_persen) }}%</span>
            <span class="text-xs text-base-content/60">({{ angka(s.porsi_persen) }}% dari nilai akhir)</span>
          </div>
          <p class="whitespace-pre-wrap break-words text-sm">{{ s.teks }}</p>
          <div>
            <p class="text-xs font-medium text-base-content/60">Jawabanmu</p>
            <p v-if="s.jawaban.trim()" class="whitespace-pre-wrap break-words bg-base-200 rounded p-2 text-sm">{{ s.jawaban }}</p>
            <p v-else class="italic text-base-content/50 text-sm">(tidak dijawab)</p>
          </div>
          <ul class="flex flex-col gap-1">
            <li v-for="(k, i) in s.kriteria" :key="i" class="text-sm">
              <span class="font-medium">{{ k.nama }}</span>
              <span class="badge badge-sm ml-1" :class="k.skor === k.skor_maks ? 'badge-success' : k.skor === 0 ? 'badge-ghost' : 'badge-warning'">
                {{ k.skor }}/{{ k.skor_maks }}
              </span>
              <span v-if="k.deskriptor" class="text-base-content/70"> · {{ k.deskriptor }}</span>
            </li>
          </ul>
          <div v-if="s.catatan" class="alert alert-info text-sm py-2">
            <i class="fa-solid fa-comment" aria-hidden="true"></i>
            <span class="whitespace-pre-wrap break-words">{{ s.catatan }}</span>
          </div>
          <details class="text-sm">
            <summary class="cursor-pointer link">Lihat jawaban acuan</summary>
            <p class="whitespace-pre-wrap break-words bg-base-200 rounded p-2 mt-1">{{ s.acuan }}</p>
          </details>
        </section>
      </template>
    </template>
  </div>
</template>
