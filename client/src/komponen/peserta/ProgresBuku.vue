<!--
  client/src/komponen/peserta/ProgresBuku.vue — daftar buku PDF beserta progres unduhannya di perangkat siswa
  (menunggu / mengunduh xx% / siap / gagal + "Coba lagi"), supaya siswa tahu kapan buku bisa dibaca lancar.
  Dipanggil oleh: client/src/komponen/peserta/RuangTunggu.vue. Memanggil: client/src/buku.ts (statusBuku, ulangiBuku).
-->
<script setup lang="ts">
import { computed } from 'vue';
import { formatMb, statusBuku, ulangiBuku } from '../../buku.ts';

const props = defineProps<{ daftar: { id: number; nama_tampil: string; ukuran_byte: number }[] }>();

const baris = computed(() =>
  props.daftar.map((p) => {
    const s = statusBuku.get(p.id);
    const total = s?.total ?? p.ukuran_byte;
    const diterima = s?.diterima ?? 0;
    return { ...p, s, total, diterima, persen: total > 0 ? Math.min(100, Math.floor((diterima / total) * 100)) : 0 };
  }),
);
const semuaSiap = computed(() => baris.value.every((b) => b.s?.keadaan === 'siap'));
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Hanya ringkasan yang diumumkan pembaca layar, bukan setiap perubahan persen. -->
    <p class="text-sm font-medium" aria-live="polite">
      <i class="fa-solid" :class="semuaSiap ? 'fa-circle-check text-success' : 'fa-download'" aria-hidden="true"></i>
      {{ semuaSiap ? 'Semua buku sudah siap dibaca.' : 'Menyiapkan buku di perangkat ini…' }}
    </p>
    <ul class="flex flex-col gap-2">
      <li v-for="b in baris" :key="b.id" class="flex flex-col gap-1 text-sm">
        <div class="flex items-center gap-2">
          <span class="truncate flex-1 min-w-0" :title="b.nama_tampil">{{ b.nama_tampil }}</span>
          <span v-if="b.s?.keadaan === 'siap'" class="text-success shrink-0"><i class="fa-solid fa-check" aria-hidden="true"></i> siap</span>
          <span v-else-if="b.s?.keadaan === 'gagal'" class="text-warning shrink-0">gagal</span>
          <span v-else-if="b.s?.keadaan === 'mengunduh'" class="tabular-nums shrink-0">{{ b.persen }}%</span>
          <span v-else class="text-base-content/60 shrink-0">menunggu</span>
        </div>
        <progress
          v-if="b.s?.keadaan !== 'siap' && b.s?.keadaan !== 'gagal'"
          class="progress progress-primary h-1.5"
          :value="b.diterima"
          :max="Math.max(1, b.total)"
        ></progress>
        <p v-if="b.s?.keadaan === 'mengunduh'" class="text-xs text-base-content/60">{{ formatMb(b.diterima) }} dari {{ formatMb(b.total) }} MB</p>
        <div v-if="b.s?.keadaan === 'gagal'" class="flex items-center gap-2 text-xs">
          <span class="text-base-content/70">{{ b.s.tetap ? 'Buku belum bisa diunduh.' : 'Unduhan terputus. Periksa Wi-Fi.' }}</span>
          <button class="btn btn-xs" type="button" @click="ulangiBuku(b.id)">Coba lagi</button>
        </div>
      </li>
    </ul>
  </div>
</template>
