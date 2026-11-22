<!--
  client/src/komponen/guru/EditorSoal.vue — formulir tambah/ubah satu soal: judul, teks, bobot, rujukan PDF,
  jawaban acuan, dan rubrik. Dengan `hanyaBaca` (ujian sudah dibuka/selesai) formulir hanya bisa dilihat: semua isian
  dinonaktifkan lewat <fieldset disabled> dan tombol Simpan tidak ada (server juga menolak perubahan di luar draf).
  Dipanggil oleh: client/src/komponen/guru/DaftarSoal.vue.
  Memanggil: POST /api/ujian/:id/soal, PATCH /api/ujian/:id/soal/:soalId; komponen EditorRubrik.
-->
<script setup lang="ts">
import { ref } from 'vue';
import { BATAS, RUBRIK_KOSONG, SoalGuruSchema } from '../../../../shared/ujian.ts';
import type { Rubrik, SoalGuru, UjianDetail } from '../../../../shared/ujian.ts';
import { api, pesanGalat } from '../../api.ts';
import EditorRubrik from './EditorRubrik.vue';

const props = defineProps<{ ujian: UjianDetail; soal: SoalGuru | null; hanyaBaca?: boolean }>();
const emit = defineEmits<{ selesai: [] }>();

// Salinan dalam agar perubahan di formulir tidak langsung mengubah data induk sebelum disimpan.
// Lewat JSON (bukan structuredClone) karena data dari Vue berupa Proxy reaktif yang tidak bisa di-clone.
function salinRubrik(r: Rubrik): Rubrik {
  return JSON.parse(JSON.stringify(r)) as Rubrik;
}
const judul = ref(props.soal?.judul ?? '');
const teks = ref(props.soal?.teks ?? '');
const bobot = ref(props.soal?.bobot ?? 1);
const jawabanAcuan = ref(props.soal?.jawaban_acuan ?? '');
const pdfId = ref<number | null>(props.soal?.pdf_id ?? null);
const pdfHalaman = ref<number | null>(props.soal?.pdf_halaman ?? null);
const rubrik = ref<Rubrik>(salinRubrik(props.soal?.rubrik ?? RUBRIK_KOSONG));
const galat = ref('');
const menyimpan = ref(false);

async function simpan(): Promise<void> {
  galat.value = '';
  menyimpan.value = true;
  const body = {
    judul: judul.value,
    teks: teks.value,
    bobot: bobot.value,
    jawaban_acuan: jawabanAcuan.value,
    rubrik: rubrik.value,
    pdf_id: pdfId.value,
    // Halaman kosong ("") dari input angka dianggap tidak diisi.
    pdf_halaman: pdfId.value === null || !pdfHalaman.value ? null : pdfHalaman.value,
  };
  try {
    if (props.soal) {
      await api('PATCH', `/api/ujian/${props.ujian.id}/soal/${props.soal.id}`, { body, skema: SoalGuruSchema });
    } else {
      await api('POST', `/api/ujian/${props.ujian.id}/soal`, { body, skema: SoalGuruSchema });
    }
    emit('selesai');
  } catch (e) {
    galat.value = pesanGalat(e);
  } finally {
    menyimpan.value = false;
  }
}
</script>

<template>
  <form class="card bg-base-100 shadow" @submit.prevent="simpan">
    <div class="card-body gap-4">
      <h2 class="card-title">
        {{ hanyaBaca ? `Soal ${soal?.urutan}` : soal ? `Ubah soal ${soal.urutan}` : 'Soal baru' }}
        <span v-if="hanyaBaca" class="badge badge-ghost gap-1"><i class="fa-solid fa-lock" aria-hidden="true"></i> hanya dilihat</span>
      </h2>
      <div v-if="galat" role="alert" class="alert alert-error"><span>{{ galat }}</span></div>

      <fieldset :disabled="hanyaBaca" class="grid gap-4 lg:grid-cols-2 min-w-0">
        <div class="flex flex-col gap-3">
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium">Judul soal</span>
            <input v-model="judul" class="input w-full" :maxlength="BATAS.judul" required placeholder="mis. Penyebab inflasi" />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium">Teks soal</span>
            <textarea v-model="teks" class="textarea w-full h-40" :maxlength="BATAS.teks" placeholder="Pertanyaan esai yang dibaca siswa"></textarea>
          </label>
          <div class="flex flex-wrap gap-3">
            <label class="flex flex-col gap-1 w-24">
              <span class="text-sm font-medium">Bobot</span>
              <input v-model.number="bobot" class="input w-full" type="number" min="1" max="100" required />
            </label>
            <label class="flex flex-col gap-1 flex-1 min-w-40">
              <span class="text-sm font-medium">Rujukan buku (opsional)</span>
              <select v-model="pdfId" class="select w-full">
                <option :value="null">— tidak ada —</option>
                <option v-for="p in ujian.pdf" :key="p.id" :value="p.id">{{ p.nama_tampil }}</option>
              </select>
            </label>
            <label v-if="pdfId !== null" class="flex flex-col gap-1 w-28">
              <span class="text-sm font-medium">Halaman</span>
              <input v-model.number="pdfHalaman" class="input w-full" type="number" min="1" />
            </label>
          </div>
          <p class="text-xs text-base-content/60">
            Teks, judul, dan rujukan halaman baru terlihat siswa setelah ujian dimulai.
          </p>
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium">Jawaban acuan</span>
            <textarea v-model="jawabanAcuan" class="textarea w-full h-32" :maxlength="BATAS.jawabanAcuan"
              placeholder="Contoh jawaban ideal, dipakai saat penilaian"></textarea>
            <span class="text-xs text-base-content/60"><i class="fa-solid fa-lock" aria-hidden="true"></i> Tidak pernah terlihat siswa.</span>
          </label>
        </div>
        <EditorRubrik v-model="rubrik" :hanya-baca="hanyaBaca" />
      </fieldset>

      <div class="flex justify-end gap-2">
        <button type="button" class="btn btn-ghost" @click="emit('selesai')">{{ hanyaBaca ? 'Kembali' : 'Batal' }}</button>
        <button v-if="!hanyaBaca" type="submit" class="btn btn-primary" :disabled="menyimpan">
          <span v-if="menyimpan" class="loading loading-spinner"></span> Simpan soal
        </button>
      </div>
    </div>
  </form>
</template>
