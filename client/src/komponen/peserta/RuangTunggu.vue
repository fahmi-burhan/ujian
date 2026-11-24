<!--
  client/src/komponen/peserta/RuangTunggu.vue — ruang tunggu siswa (ujian "menunggu"): judul, petunjuk umum, durasi,
  jumlah soal, buku PDF yang sudah boleh dibaca, dan tombol layar penuh. Soal belum dikirim server sama sekali.
  Dipanggil oleh: client/src/halaman/UjianPeserta.vue.
  Memanggil: PembacaPdf.vue (async: PDF.js baru diunduh saat komponen ini tampil), ProgresBuku.vue (unduhan buku
             yang sudah berjalan sejak data ujian dimuat), client/src/layar-penuh.ts.
-->
<script setup lang="ts">
import { defineAsyncComponent } from 'vue';
import type { UjianPeserta } from '../../../../shared/peserta.ts';
import { layarPenuh, masukLayarPenuh } from '../../layar-penuh.ts';
import ProgresBuku from './ProgresBuku.vue';

const PembacaPdf = defineAsyncComponent(() => import('./PembacaPdf.vue'));

defineProps<{ ujian: UjianPeserta }>();
defineEmits<{ keluar: [] }>();
</script>

<template>
  <main class="min-h-screen bg-base-200 p-4">
    <div class="max-w-6xl mx-auto grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <section class="card bg-base-100 shadow self-start">
        <div class="card-body gap-3">
          <p class="text-sm text-base-content/60">Halo, <span class="font-semibold">{{ ujian.saya.nama }}</span></p>
          <h1 class="text-2xl font-bold break-words">{{ ujian.judul }}</h1>
          <p class="text-sm text-base-content/70">
            <i class="fa-solid fa-clock" aria-hidden="true"></i> {{ ujian.durasi_menit }} menit ·
            <i class="fa-solid fa-list-ol" aria-hidden="true"></i> {{ ujian.jumlah_soal }} soal
          </p>
          <div role="status" class="alert alert-info">
            <i class="fa-solid fa-hourglass-half" aria-hidden="true"></i>
            <span>Ujian belum dimulai. Soal akan muncul otomatis saat guru menekan <strong>Mulai</strong>.</span>
          </div>
          <p v-if="ujian.petunjuk" class="whitespace-pre-wrap break-words">{{ ujian.petunjuk }}</p>
          <ul class="text-sm list-disc ml-5 text-base-content/80">
            <li>Selama ujian, jangan membuka tab atau jendela lain. Aktivitas di luar halaman tercatat.</li>
            <li>Jawaban tersimpan otomatis, juga di perangkat ini bila Wi-Fi sempat putus.</li>
            <li v-if="ujian.pdf.length">Buku boleh dibaca dari sekarang.</li>
          </ul>
          <ProgresBuku v-if="ujian.pdf.length" :daftar="ujian.pdf" class="border-t border-base-300 pt-3" />
          <button v-if="!layarPenuh" class="btn btn-primary" type="button" @click="masukLayarPenuh">
            <i class="fa-solid fa-expand" aria-hidden="true"></i> Masuk layar penuh
          </button>
          <p v-else class="text-sm text-success"><i class="fa-solid fa-check" aria-hidden="true"></i> Layar penuh aktif.</p>
          <button class="btn btn-ghost btn-sm self-start" type="button" @click="$emit('keluar')">
            <i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i> Bukan saya / keluar
          </button>
        </div>
      </section>

      <section v-if="ujian.pdf.length" class="h-[80vh] min-h-96">
        <PembacaPdf :daftar="ujian.pdf" />
      </section>
      <section v-else class="card bg-base-100 shadow self-start">
        <div class="card-body text-base-content/70">Ujian ini tidak memakai buku PDF.</div>
      </section>
    </div>
  </main>
</template>
