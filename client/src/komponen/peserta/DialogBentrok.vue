<!--
  client/src/komponen/peserta/DialogBentrok.vue — dialog saat teks jawaban di laptop ini berbeda dengan yang
  tersimpan di server (mis. siswa sempat mengerjakan di laptop lain, docs/DESAIN.md §5). Kedua teks ditampilkan
  utuh dan SISWA yang memilih; tidak ada teks yang dibuang tanpa pilihan siswa.
  Dipanggil oleh: client/src/halaman/UjianPeserta.vue.
  Memanggil: tidak ada (hanya menampilkan props & memancarkan pilihan).
-->
<script setup lang="ts">
import type { Bentrok } from '../../autosave.ts';

defineProps<{ bentrok: Bentrok; judulSoal: string }>();
defineEmits<{ pilih: [pilihan: 'server' | 'laptop'] }>();
</script>

<template>
  <dialog class="modal modal-open" open aria-labelledby="judul-bentrok">
    <div class="modal-box max-w-4xl">
      <h3 id="judul-bentrok" class="font-bold text-lg">
        <i class="fa-solid fa-code-compare text-warning" aria-hidden="true"></i>
        Ada dua versi jawaban untuk "{{ judulSoal }}"
      </h3>
      <p class="text-sm text-base-content/70 my-2">
        Teks di perangkat ini berbeda dengan yang tersimpan di server. Pilih teks yang ingin kamu pakai. Teks yang
        dipilih bisa diubah lagi setelahnya.
      </p>
      <div class="grid gap-3 md:grid-cols-2">
        <section class="border border-base-300 rounded-box p-3 flex flex-col gap-2">
          <h4 class="font-semibold"><i class="fa-solid fa-laptop" aria-hidden="true"></i> Di perangkat ini</h4>
          <p class="whitespace-pre-wrap break-words max-h-64 overflow-auto text-sm bg-base-200 rounded p-2">{{ bentrok.laptop.isi || '(kosong)' }}</p>
          <button type="button" class="btn btn-primary btn-sm" @click="$emit('pilih', 'laptop')">Pakai teks perangkat ini</button>
        </section>
        <section class="border border-base-300 rounded-box p-3 flex flex-col gap-2">
          <h4 class="font-semibold"><i class="fa-solid fa-server" aria-hidden="true"></i> Tersimpan di server</h4>
          <p class="whitespace-pre-wrap break-words max-h-64 overflow-auto text-sm bg-base-200 rounded p-2">{{ bentrok.server.isi || '(kosong)' }}</p>
          <button type="button" class="btn btn-sm" @click="$emit('pilih', 'server')">Pakai teks server</button>
        </section>
      </div>
    </div>
  </dialog>
</template>
