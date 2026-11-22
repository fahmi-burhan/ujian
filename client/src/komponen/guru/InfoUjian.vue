<!--
  client/src/komponen/guru/InfoUjian.vue — tab "Info": judul, petunjuk umum, durasi (hanya saat draf) dan
  cara nama tampil di proyektor (kapan saja).
  Dipanggil oleh: client/src/halaman/PenyusunanUjian.vue.
  Memanggil: PATCH /api/ujian/:id, PATCH /api/ujian/:id/tampilan.
  Petunjuk TERLIHAT siswa di ruang tunggu sebelum ujian dimulai, jadi jangan berisi soal.
-->
<script setup lang="ts">
import { ref, watch } from 'vue';
import { BATAS, UjianDetailSchema } from '../../../../shared/ujian.ts';
import type { UjianDetail } from '../../../../shared/ujian.ts';
import { api, pesanGalat } from '../../api.ts';

const props = defineProps<{ ujian: UjianDetail }>();
const emit = defineEmits<{ perbarui: [ujian: UjianDetail] }>();

const judul = ref('');
const petunjuk = ref('');
const durasi = ref(0);
const galat = ref('');
const tersimpan = ref(false);
const menyimpan = ref(false);

function isiUlang(u: UjianDetail): void {
  judul.value = u.judul;
  petunjuk.value = u.petunjuk;
  durasi.value = u.durasi_menit;
}
// Formulir diisi ulang hanya saat ujian lain dibuka (atau setelah tersimpan), BUKAN setiap data ujian
// berubah: mengganti mode tampil tidak boleh menimpa isian yang belum disimpan.
watch(() => props.ujian.id, () => isiUlang(props.ujian), { immediate: true });

async function simpan(): Promise<void> {
  galat.value = '';
  tersimpan.value = false;
  menyimpan.value = true;
  try {
    const baru = await api('PATCH', `/api/ujian/${props.ujian.id}`, {
      body: { judul: judul.value, petunjuk: petunjuk.value, durasi_menit: durasi.value },
      skema: UjianDetailSchema,
    });
    emit('perbarui', baru);
    isiUlang(baru);
    tersimpan.value = true;
  } catch (e) {
    galat.value = pesanGalat(e);
  } finally {
    menyimpan.value = false;
  }
}

async function ubahTampilan(mode: 'nama' | 'inisial'): Promise<void> {
  galat.value = '';
  try {
    emit('perbarui', await api('PATCH', `/api/ujian/${props.ujian.id}/tampilan`, { body: { mode_tampil: mode }, skema: UjianDetailSchema }));
  } catch (e) {
    galat.value = pesanGalat(e);
  }
}
</script>

<template>
  <section class="card bg-base-100 shadow">
    <form class="card-body gap-4" @submit.prevent="simpan">
      <div v-if="galat" role="alert" class="alert alert-error"><span>{{ galat }}</span></div>
      <div v-if="tersimpan" role="status" class="alert alert-success"><span>Tersimpan.</span></div>

      <fieldset :disabled="ujian.status !== 'draf'" class="flex flex-col gap-4">
        <label class="flex flex-col gap-1">
          <span class="text-sm font-medium">Judul</span>
          <input v-model="judul" class="input w-full" :maxlength="BATAS.judul" required />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm font-medium">Petunjuk umum</span>
          <textarea v-model="petunjuk" class="textarea w-full h-32" :maxlength="BATAS.petunjuk"
            placeholder="mis. Kerjakan semua soal. Boleh membuka buku PDF di halaman ujian."></textarea>
          <span class="text-xs text-base-content/60">
            <i class="fa-solid fa-eye" aria-hidden="true"></i>
            Terlihat siswa di ruang tunggu sebelum ujian dimulai. Jangan menulis isi soal di sini.
          </span>
        </label>
        <label class="flex flex-col gap-1 sm:w-48">
          <span class="text-sm font-medium">Durasi (menit)</span>
          <input v-model.number="durasi" class="input w-full" type="number" min="1" max="600" required />
        </label>
        <div class="flex justify-end">
          <button class="btn btn-primary" type="submit" :disabled="menyimpan">
            <span v-if="menyimpan" class="loading loading-spinner"></span> Simpan
          </button>
        </div>
      </fieldset>
      <p v-if="ujian.status !== 'draf'" class="text-sm text-base-content/70">
        <i class="fa-solid fa-lock" aria-hidden="true"></i> Info ujian terkunci setelah dibuka. Kembalikan ke draf untuk mengubahnya.
      </p>

      <div class="divider my-0"></div>
      <div class="flex flex-col gap-2">
        <span class="text-sm font-medium">Nama siswa di layar proyektor</span>
        <div class="join">
          <button type="button" class="btn join-item" :class="{ 'btn-active btn-primary': ujian.mode_tampil === 'nama' }" @click="ubahTampilan('nama')">
            Nama lengkap
          </button>
          <button type="button" class="btn join-item" :class="{ 'btn-active btn-primary': ujian.mode_tampil === 'inisial' }" @click="ubahTampilan('inisial')">
            Inisial saja
          </button>
        </div>
        <span class="text-xs text-base-content/60">Bisa diganti kapan saja, juga saat ujian berlangsung.</span>
      </div>
    </form>
  </section>
</template>
