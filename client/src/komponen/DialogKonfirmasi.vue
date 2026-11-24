<!--
  client/src/komponen/DialogKonfirmasi.vue — modal konfirmasi untuk aksi hapus/reset (pengganti window.confirm):
  ikon, judul, nama benda yang terkena, rincian apa saja yang ikut hilang, tombol Batal & tombol aksi berwarna.
  Tanpa animasi/transisi (permintaan pemilik 22 Nov). Fokus awal di "Batal" supaya Enter tidak langsung menghapus;
  Esc = batal.
  Dipanggil oleh: client/src/App.vue (dipasang sekali), dibuka lewat konfirmasi() di client/src/konfirmasi.ts.
  Memanggil: tidak ada.
-->
<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { konfirmasiAktif } from '../konfirmasi.ts';

const tombolBatal = ref<HTMLButtonElement | null>(null);

watch(konfirmasiAktif, async (k) => {
  if (!k) return;
  await nextTick();
  tombolBatal.value?.focus();
});
</script>

<template>
  <dialog
    v-if="konfirmasiAktif"
    class="modal modal-open"
    open
    style="transition: none; animation: none"
    aria-labelledby="judul-konfirmasi"
    @keydown.esc.prevent="konfirmasiAktif.jawab(false)"
    @cancel.prevent="konfirmasiAktif.jawab(false)"
  >
    <div class="modal-box flex flex-col gap-4 max-w-md" style="transition: none; animation: none; transform: none">
      <div class="flex items-start gap-3">
        <div
          class="shrink-0 rounded-full size-11 flex items-center justify-center"
          :class="konfirmasiAktif.warna === 'warning' ? 'bg-warning/20 text-warning' : 'bg-error/15 text-error'"
        >
          <i class="fa-solid text-lg" :class="`fa-${konfirmasiAktif.ikon ?? 'trash'}`" aria-hidden="true"></i>
        </div>
        <div class="flex flex-col gap-1 min-w-0">
          <h3 id="judul-konfirmasi" class="font-bold text-lg leading-snug">{{ konfirmasiAktif.judul }}</h3>
          <p v-if="konfirmasiAktif.subjek" class="font-semibold break-words">"{{ konfirmasiAktif.subjek }}"</p>
        </div>
      </div>
      <ul v-if="konfirmasiAktif.rincian?.length" class="list-disc ml-5 text-sm flex flex-col gap-1">
        <li v-for="(r, i) in konfirmasiAktif.rincian" :key="i">{{ r }}</li>
      </ul>
      <p v-if="konfirmasiAktif.catatan" class="text-sm text-base-content/70">{{ konfirmasiAktif.catatan }}</p>
      <div class="modal-action mt-0">
        <button ref="tombolBatal" type="button" class="btn" @click="konfirmasiAktif.jawab(false)">Batal</button>
        <button
          type="button"
          class="btn"
          :class="konfirmasiAktif.warna === 'warning' ? 'btn-warning' : 'btn-error'"
          @click="konfirmasiAktif.jawab(true)"
        >
          <i class="fa-solid" :class="`fa-${konfirmasiAktif.ikon ?? 'trash'}`" aria-hidden="true"></i>
          {{ konfirmasiAktif.labelOk }}
        </button>
      </div>
    </div>
  </dialog>
</template>
