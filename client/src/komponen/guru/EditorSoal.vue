<!--
  client/src/komponen/guru/EditorSoal.vue — formulir tambah/ubah satu soal: judul, teks, bobot, rujukan buku (boleh
  lebih dari satu, maks. 5, masing-masing dengan halaman opsional), jawaban acuan, dan rubrik. Dengan `hanyaBaca` (ujian sudah dibuka/selesai) formulir hanya bisa dilihat: semua isian
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

// Halaman `null` = tidak diisi. Input angka yang dikosongkan memberi "" lewat v-model.number, jadi dirapikan saat simpan.
type IsianRujukan = { pdf_id: number | null; halaman: number | null | '' };

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
const rujukan = ref<IsianRujukan[]>((props.soal?.rujukan ?? []).map((r) => ({ ...r })));

function tambahRujukan(): void {
  rujukan.value.push({ pdf_id: props.ujian.pdf[0]?.id ?? null, halaman: null });
}
const rubrik = ref<Rubrik>(salinRubrik(props.soal?.rubrik ?? RUBRIK_KOSONG));
const galat = ref('');
const menyimpan = ref(false);

// Pesan untuk isian rujukan yang tidak sah, atau null bila semua baik.
function masalahRujukan(): string | null {
  const terisi = rujukan.value.filter((r) => r.pdf_id !== null);
  for (const [i, r] of rujukan.value.entries()) {
    if (r.halaman !== null && r.halaman !== '' && (!Number.isInteger(r.halaman) || r.halaman < 1)) {
      return `Halaman rujukan buku ${i + 1} harus angka bulat mulai dari 1 (atau dikosongkan).`;
    }
  }
  const kunci = terisi.map((r) => `${r.pdf_id}:${r.halaman === '' ? null : r.halaman}`);
  if (new Set(kunci).size !== kunci.length) return 'Ada rujukan buku & halaman yang sama dua kali. Hapus salah satunya.';
  return null;
}

async function simpan(): Promise<void> {
  galat.value = '';
  const m = masalahRujukan();
  if (m) {
    galat.value = m;
    return;
  }
  menyimpan.value = true;
  const body = {
    judul: judul.value,
    teks: teks.value,
    bobot: bobot.value,
    jawaban_acuan: jawabanAcuan.value,
    rubrik: rubrik.value,
    // Baris tanpa buku dibuang; halaman kosong ("") dianggap tidak diisi.
    rujukan: rujukan.value
      .filter((r): r is IsianRujukan & { pdf_id: number } => r.pdf_id !== null)
      .map((r) => ({ pdf_id: r.pdf_id, halaman: r.halaman === '' ? null : r.halaman })),
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

      <fieldset :disabled="hanyaBaca" class="grid gap-4 lg:grid-cols-2 items-start min-w-0">
        <div class="flex flex-col gap-3">
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium">Judul soal</span>
            <input v-model="judul" class="input w-full" :maxlength="BATAS.judul" required placeholder="mis. Penyebab inflasi" />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium">Teks soal</span>
            <textarea v-model="teks" class="textarea w-full h-40" :maxlength="BATAS.teks" placeholder="Pertanyaan esai yang dibaca siswa"></textarea>
          </label>
          <label class="flex flex-col gap-1 w-24">
            <span class="text-sm font-medium">Bobot</span>
            <input v-model.number="bobot" class="input w-full" type="number" min="1" max="100" required />
          </label>
          <div class="flex flex-col gap-2">
            <span class="text-sm font-medium">Rujukan buku (opsional, maks. {{ BATAS.rujukanSoal }})</span>
            <p v-if="ujian.pdf.length === 0" class="text-xs text-base-content/60">Unggah buku PDF di tab "Buku PDF" dulu untuk menambah rujukan.</p>
            <div v-for="(r, i) in rujukan" :key="i" class="flex flex-wrap gap-2 items-end">
              <label class="flex flex-col gap-1 flex-1 min-w-40">
                <span class="text-xs">Buku {{ i + 1 }}</span>
                <select v-model="r.pdf_id" class="select select-sm w-full">
                  <option :value="null">(pilih buku)</option>
                  <option v-for="p in ujian.pdf" :key="p.id" :value="p.id">{{ p.nama_tampil }}</option>
                </select>
              </label>
              <label class="flex flex-col gap-1 w-24">
                <span class="text-xs">Halaman</span>
                <input v-model.number="r.halaman" class="input input-sm w-full" type="number" min="1" />
              </label>
              <button v-if="!hanyaBaca" type="button" class="btn btn-sm btn-ghost" :aria-label="`Hapus rujukan ${i + 1}`" @click="rujukan.splice(i, 1)">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
              </button>
            </div>
            <button
              v-if="!hanyaBaca && ujian.pdf.length > 0 && rujukan.length < BATAS.rujukanSoal"
              type="button"
              class="btn btn-xs btn-ghost self-start"
              @click="tambahRujukan"
            >
              <i class="fa-solid fa-plus" aria-hidden="true"></i> Rujukan buku
            </button>
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
