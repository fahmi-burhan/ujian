<!--
  client/src/komponen/guru/EditorRubrik.vue — penyunting rubrik satu soal (format docs/DESAIN.md §9):
  kriteria (nama, bobot, level skor + deskriptor) dan poin wajib.
  Dipanggil oleh: client/src/komponen/guru/EditorSoal.vue (v-model="rubrik").
  Memanggil: shared/ujian.ts (batas & cek kelengkapan rubrik).
  Rubrik ini hanya untuk guru & penilaian (Fase 6); tidak pernah dikirim ke siswa atau proyektor.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { BATAS, masalahRubrik } from '../../../../shared/ujian.ts';
import type { Kriteria, Rubrik } from '../../../../shared/ujian.ts';

const rubrik = defineModel<Rubrik>({ required: true });
const masalah = computed(() => masalahRubrik(rubrik.value));

// id kriteria berikutnya: k1, k2, … (unik dalam satu soal).
function idBaru(): string {
  const angka = rubrik.value.kriteria.map((k) => Number(/^k(\d+)$/.exec(k.id)?.[1] ?? 0));
  return `k${Math.max(0, ...angka) + 1}`;
}

function tambahKriteria(): void {
  const baru: Kriteria = {
    id: idBaru(),
    nama: '',
    bobot: 10,
    level: [
      { skor: 0, deskriptor: '' },
      { skor: 2, deskriptor: '' },
      { skor: 4, deskriptor: '' },
    ],
  };
  rubrik.value.kriteria.push(baru);
}

function hapusKriteria(i: number): void {
  rubrik.value.kriteria.splice(i, 1);
}

function tambahLevel(k: Kriteria): void {
  const tertinggi = Math.max(-1, ...k.level.map((l) => l.skor));
  k.level.push({ skor: Math.min(10, tertinggi + 1), deskriptor: '' });
}

function tambahPoin(): void {
  rubrik.value.poin_wajib.push('');
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between gap-2">
      <h3 class="font-semibold">Rubrik penilaian</h3>
      <span class="text-xs text-base-content/60"><i class="fa-solid fa-lock" aria-hidden="true"></i> Tidak terlihat siswa</span>
    </div>

    <div v-for="(k, i) in rubrik.kriteria" :key="k.id" class="border border-base-300 rounded-box p-3 flex flex-col gap-2">
      <div class="flex flex-wrap gap-2 items-end">
        <label class="flex flex-col gap-1 flex-1 min-w-48">
          <span class="text-xs">Kriteria {{ i + 1 }}</span>
          <input v-model="k.nama" class="input input-sm w-full" :maxlength="BATAS.namaKriteria" placeholder="mis. Analisis masalah" />
        </label>
        <label class="flex flex-col gap-1 w-24">
          <span class="text-xs">Bobot</span>
          <input v-model.number="k.bobot" class="input input-sm w-full" type="number" min="1" max="100" required />
        </label>
        <button type="button" class="btn btn-sm btn-ghost text-error" :aria-label="`Hapus kriteria ${i + 1}`" @click="hapusKriteria(i)">
          <i class="fa-solid fa-trash" aria-hidden="true"></i>
        </button>
      </div>

      <div class="flex flex-col gap-1">
        <div v-for="(l, j) in k.level" :key="j" class="flex gap-2 items-center">
          <input v-model.number="l.skor" class="input input-sm w-20" type="number" min="0" max="10" required :aria-label="`Skor level ${j + 1}`" />
          <input v-model="l.deskriptor" class="input input-sm flex-1" :maxlength="BATAS.deskriptor"
            :placeholder="l.skor === 0 ? 'mis. Tidak menjawab / tidak relevan' : 'Ciri jawaban pada skor ini'" :aria-label="`Deskriptor level ${j + 1}`" />
          <button type="button" class="btn btn-xs btn-ghost" :aria-label="`Hapus level ${j + 1}`" @click="k.level.splice(j, 1)">
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </div>
        <button v-if="k.level.length < BATAS.jumlahLevel" type="button" class="btn btn-xs btn-ghost self-start" @click="tambahLevel(k)">
          <i class="fa-solid fa-plus" aria-hidden="true"></i> Level
        </button>
      </div>
    </div>

    <button v-if="rubrik.kriteria.length < BATAS.jumlahKriteria" type="button" class="btn btn-sm self-start" @click="tambahKriteria">
      <i class="fa-solid fa-plus" aria-hidden="true"></i> Kriteria
    </button>

    <div class="flex flex-col gap-1">
      <span class="text-sm font-medium">Poin wajib (opsional)</span>
      <div v-for="(_, i) in rubrik.poin_wajib" :key="i" class="flex gap-2">
        <input v-model="rubrik.poin_wajib[i]" class="input input-sm flex-1" :maxlength="BATAS.poinWajib" placeholder="mis. Menyebut konsep X" />
        <button type="button" class="btn btn-xs btn-ghost" :aria-label="`Hapus poin ${i + 1}`" @click="rubrik.poin_wajib.splice(i, 1)">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </div>
      <button v-if="rubrik.poin_wajib.length < BATAS.jumlahPoinWajib" type="button" class="btn btn-xs btn-ghost self-start" @click="tambahPoin">
        <i class="fa-solid fa-plus" aria-hidden="true"></i> Poin wajib
      </button>
    </div>

    <ul v-if="masalah.length" class="text-sm text-warning list-disc ml-5">
      <li v-for="m in masalah" :key="m">{{ m }}</li>
    </ul>
    <p class="text-xs text-base-content/60">
      Tiap kriteria butuh 2–6 level dengan skor 0–10 yang berbeda, termasuk skor 0. Boleh disimpan dulu walau belum lengkap.
    </p>
  </div>
</template>
