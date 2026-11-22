<!--
  client/src/komponen/guru/DialogHapusUjian.vue — dialog "Hapus ujian" PERMANEN (bukan soft delete; keputusan pemilik
  22 Nov 2026). Menampilkan apa saja yang ikut terhapus, lalu meminta guru mengetik HAPUS sebelum tombolnya aktif,
  supaya ujian beserta jawaban & nilai siswa tidak terhapus karena salah klik. Modal tanpa animasi (sama dengan
  dialog lain di aplikasi ini).
  Dipanggil oleh: client/src/halaman/BerandaGuru.vue (tombol di tabel), client/src/halaman/PenyusunanUjian.vue.
  Memanggil: DELETE /api/ujian/:id (server/routes/ujian.ts).
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { StatusUjian } from '../../../../shared/auth.ts';
import { api, pesanGalat } from '../../api.ts';
import { LABEL_STATUS_UJIAN } from '../../label.ts';

const props = defineProps<{
  ujian: { id: number; judul: string; status: StatusUjian; jumlah_soal: number; jumlah_peserta: number };
}>();
const emit = defineEmits<{ tutup: []; terhapus: [] }>();

const KATA_KONFIRMASI = 'HAPUS';
const ketikan = ref('');
const sibuk = ref(false);
const galat = ref('');
const isian = ref<HTMLInputElement | null>(null);
const cocok = computed(() => ketikan.value.trim().toUpperCase() === KATA_KONFIRMASI);
// Ujian yang sudah dikerjakan punya jawaban & nilai siswa: peringatannya dipertegas.
const adaJawaban = computed(() => ['selesai', 'penilaian', 'dirilis'].includes(props.ujian.status));

onMounted(() => isian.value?.focus());

async function hapus(): Promise<void> {
  if (!cocok.value) return;
  galat.value = '';
  sibuk.value = true;
  try {
    await api('DELETE', `/api/ujian/${props.ujian.id}`);
    emit('terhapus');
  } catch (e) {
    galat.value = pesanGalat(e);
  } finally {
    sibuk.value = false;
  }
}
</script>

<template>
  <dialog class="modal modal-open" open style="transition: none; animation: none" aria-labelledby="judul-hapus-ujian" @keydown.esc="emit('tutup')">
    <form class="modal-box flex flex-col gap-3" style="transition: none; animation: none; transform: none" @submit.prevent="hapus">
      <h3 id="judul-hapus-ujian" class="font-bold text-lg text-error flex items-center gap-2">
        <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Hapus ujian permanen
      </h3>
      <p class="text-sm">
        <span class="font-semibold break-words">"{{ ujian.judul }}"</span>
        <span class="text-base-content/60"> | {{ LABEL_STATUS_UJIAN[ujian.status] }}</span>
      </p>
      <div role="alert" class="alert alert-error alert-soft text-sm items-start">
        <i class="fa-solid fa-circle-exclamation mt-0.5" aria-hidden="true"></i>
        <div class="flex flex-col gap-1">
          <p><strong>Tidak bisa dibatalkan.</strong> Data benar-benar dihapus dari server, bukan dipindah ke tempat sampah.</p>
          <ul class="list-disc ml-5">
            <li>{{ ujian.jumlah_soal }} soal beserta rubrik & jawaban acuan, dan semua buku PDF-nya</li>
            <li>{{ ujian.jumlah_peserta }} peserta beserta PIN-nya</li>
            <li v-if="adaJawaban">Semua jawaban siswa & riwayat versinya, nilai, catatan guru, dan draf nilai AI</li>
            <li v-if="adaJawaban">Catatan aktivitas (keluar halaman, dll.) dan jejak aksi guru</li>
          </ul>
          <p v-if="adaJawaban">Bila nilainya masih diperlukan, unduh dulu nilai (Excel) dari halaman Penilaian.</p>
        </div>
      </div>
      <label class="flex flex-col gap-1">
        <span class="text-sm">Ketik <strong class="font-mono">{{ KATA_KONFIRMASI }}</strong> untuk mengonfirmasi</span>
        <input ref="isian" v-model="ketikan" class="input w-full font-mono" autocomplete="off" spellcheck="false" :disabled="sibuk" />
      </label>
      <div v-if="galat" role="alert" class="alert alert-error text-sm"><span>{{ galat }}</span></div>
      <div class="modal-action mt-0">
        <button type="button" class="btn" :disabled="sibuk" @click="emit('tutup')">Batal</button>
        <button type="submit" class="btn btn-error" :disabled="sibuk || !cocok">
          <span v-if="sibuk" class="loading loading-spinner"></span>
          <i v-else class="fa-solid fa-trash" aria-hidden="true"></i> Hapus permanen
        </button>
      </div>
    </form>
  </dialog>
</template>
