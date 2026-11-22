<!--
  client/src/komponen/guru/DaftarSoal.vue — tab "Soal & rubrik": daftar soal berurutan, naik/turun urutan,
  hapus, dan membuka EditorSoal untuk menambah/mengubah.
  Dipanggil oleh: client/src/halaman/PenyusunanUjian.vue.
  Memanggil: PUT /api/ujian/:id/soal/urutan, DELETE /api/ujian/:id/soal/:soalId; komponen EditorSoal.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { BATAS, masalahRubrik } from '../../../../shared/ujian.ts';
import type { SoalGuru, UjianDetail } from '../../../../shared/ujian.ts';
import { api, pesanGalat } from '../../api.ts';
import EditorSoal from './EditorSoal.vue';

const props = defineProps<{ ujian: UjianDetail }>();
const emit = defineEmits<{ 'muat-ulang': [] }>();

// null = daftar; 'baru' = soal baru; objek = soal yang diubah.
const disunting = ref<SoalGuru | 'baru' | null>(null);
const galat = ref('');
const draf = computed(() => props.ujian.status === 'draf');

// Bobot soal bersifat RELATIF (docs/DESAIN.md §9): nilai ujian = Σ(nilai soal × bobot) ÷ Σ bobot × 100.
// Persentase ditampilkan agar guru tahu porsi sebenarnya tiap soal (mis. bobot 20 dari total 100 = 20%).
const totalBobot = computed(() => props.ujian.soal.reduce((n, s) => n + s.bobot, 0));
function persen(bobot: number): string {
  if (totalBobot.value === 0) return '0';
  return (Math.round((bobot / totalBobot.value) * 1000) / 10).toLocaleString('id-ID');
}

function lengkap(s: SoalGuru): boolean {
  return s.teks.trim() !== '' && s.jawaban_acuan.trim() !== '' && masalahRubrik(s.rubrik).length === 0;
}

function namaPdf(id: number | null): string {
  return props.ujian.pdf.find((p) => p.id === id)?.nama_tampil ?? '';
}

async function geser(i: number, arah: -1 | 1): Promise<void> {
  const ids = props.ujian.soal.map((s) => s.id);
  const j = i + arah;
  const a = ids[i];
  const b = ids[j];
  if (a === undefined || b === undefined) return;
  ids[i] = b;
  ids[j] = a;
  galat.value = '';
  try {
    await api('PUT', `/api/ujian/${props.ujian.id}/soal/urutan`, { body: { ids } });
  } catch (e) {
    galat.value = pesanGalat(e);
  }
  emit('muat-ulang');
}

async function hapus(s: SoalGuru): Promise<void> {
  if (!window.confirm(`Hapus soal ${s.urutan} "${s.judul}" beserta rubriknya?`)) return;
  galat.value = '';
  try {
    await api('DELETE', `/api/ujian/${props.ujian.id}/soal/${s.id}`);
  } catch (e) {
    galat.value = pesanGalat(e);
  }
  emit('muat-ulang');
}

function selesaiSunting(): void {
  disunting.value = null;
  emit('muat-ulang');
}
</script>

<template>
  <EditorSoal
    v-if="disunting"
    :ujian="ujian"
    :soal="disunting === 'baru' ? null : disunting"
    @selesai="selesaiSunting"
  />

  <section v-else class="card bg-base-100 shadow">
    <div class="card-body gap-3">
      <div v-if="galat" role="alert" class="alert alert-error"><span>{{ galat }}</span></div>
      <p v-if="!draf" class="text-sm text-base-content/70">
        <i class="fa-solid fa-lock" aria-hidden="true"></i> Soal & rubrik terkunci setelah ujian dibuka.
      </p>

      <p v-if="ujian.soal.length === 0" class="text-base-content/70">Belum ada soal.</p>
      <ol v-else class="flex flex-col gap-2">
        <li v-for="(s, i) in ujian.soal" :key="s.id" class="border border-base-300 rounded-box p-3 flex flex-wrap items-center gap-3">
          <span class="font-mono font-bold w-6 text-right">{{ s.urutan }}</span>
          <div class="flex-1 min-w-48">
            <p class="font-medium break-words">{{ s.judul }}</p>
            <p class="text-xs text-base-content/60">
              Bobot {{ s.bobot }} · {{ persen(s.bobot) }}% dari nilai · {{ s.rubrik.kriteria.length }} kriteria
              <template v-if="s.pdf_id"> · {{ namaPdf(s.pdf_id) }}<template v-if="s.pdf_halaman"> hal. {{ s.pdf_halaman }}</template></template>
            </p>
          </div>
          <span v-if="lengkap(s)" class="badge badge-success badge-sm gap-1"><i class="fa-solid fa-check" aria-hidden="true"></i> Lengkap</span>
          <span v-else class="badge badge-warning badge-sm">Belum lengkap</span>
          <div v-if="draf" class="flex gap-1">
            <button type="button" class="btn btn-sm btn-ghost" :disabled="i === 0" aria-label="Naikkan urutan" @click="geser(i, -1)">
              <i class="fa-solid fa-arrow-up" aria-hidden="true"></i>
            </button>
            <button type="button" class="btn btn-sm btn-ghost" :disabled="i === ujian.soal.length - 1" aria-label="Turunkan urutan" @click="geser(i, 1)">
              <i class="fa-solid fa-arrow-down" aria-hidden="true"></i>
            </button>
            <button type="button" class="btn btn-sm" @click="disunting = s">
              <i class="fa-solid fa-pen" aria-hidden="true"></i> Ubah
            </button>
            <button type="button" class="btn btn-sm btn-ghost text-error" :aria-label="`Hapus soal ${s.urutan}`" @click="hapus(s)">
              <i class="fa-solid fa-trash" aria-hidden="true"></i>
            </button>
          </div>
        </li>
      </ol>
      <p v-if="ujian.soal.length > 0" class="text-sm">
        <i class="fa-solid fa-scale-balanced" aria-hidden="true"></i>
        Total bobot <strong>{{ totalBobot }}</strong>.
        <span class="text-base-content/70">Bobot bersifat relatif: porsi tiap soal = bobotnya ÷ total bobot.</span>
      </p>

      <button v-if="draf && ujian.soal.length < BATAS.jumlahSoal" type="button" class="btn btn-primary self-start" @click="disunting = 'baru'">
        <i class="fa-solid fa-plus" aria-hidden="true"></i> Tambah soal
      </button>
    </div>
  </section>
</template>
