<!--
  client/src/komponen/guru/DialogDuplikasi.vue — dialog "Duplikasi ujian": membuat salinan draf dari ujian
  (soal, rubrik, jawaban acuan, PDF, petunjuk, durasi), dengan pilihan ikut menyalin daftar peserta.
  Setelah berhasil, langsung membuka halaman penyusunan ujian salinan.
  Dipanggil oleh: client/src/halaman/BerandaGuru.vue, client/src/halaman/PenyusunanUjian.vue.
  Memanggil: POST /api/ujian/:id/duplikat (server/routes/ujian-duplikat.ts).
-->
<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { judulSalinan, UjianDetailSchema } from '../../../../shared/ujian.ts';
import { api, pesanGalat } from '../../api.ts';

const props = defineProps<{ ujian: { id: number; judul: string; jumlah_peserta: number } }>();
const emit = defineEmits<{ tutup: [] }>();

const router = useRouter();
const salinPeserta = ref(false);
const sibuk = ref(false);
const galat = ref('');

async function duplikasi(): Promise<void> {
  galat.value = '';
  sibuk.value = true;
  try {
    const baru = await api('POST', `/api/ujian/${props.ujian.id}/duplikat`, {
      body: { salin_peserta: salinPeserta.value },
      skema: UjianDetailSchema,
    });
    emit('tutup');
    await router.push(`/guru/ujian/${baru.id}`);
  } catch (e) {
    galat.value = pesanGalat(e);
  } finally {
    sibuk.value = false;
  }
}
</script>

<template>
  <dialog class="modal modal-open" open aria-labelledby="judul-duplikasi" @keydown.esc="emit('tutup')">
    <div class="modal-box flex flex-col gap-3">
      <h3 id="judul-duplikasi" class="font-bold text-lg">
        <i class="fa-solid fa-copy" aria-hidden="true"></i> Duplikasi ujian
      </h3>
      <p class="text-sm">
        Membuat ujian baru berstatus <strong>draf</strong> dengan kode baru:
        <span class="font-medium break-words">"{{ judulSalinan(ujian.judul) }}"</span>.
      </p>
      <ul class="text-sm list-disc ml-5 text-base-content/80">
        <li>Ikut disalin: petunjuk, durasi, semua soal beserta rubrik & jawaban acuan, dan buku PDF.</li>
        <li>Tidak ikut: jawaban siswa, catatan aktivitas, dan waktu ujian. Ujian asal tidak berubah.</li>
      </ul>
      <label class="flex items-start gap-2 cursor-pointer">
        <input v-model="salinPeserta" type="checkbox" class="checkbox checkbox-sm mt-0.5" :disabled="ujian.jumlah_peserta === 0" />
        <span class="text-sm">
          Salin juga daftar peserta ({{ ujian.jumlah_peserta }} nama)
          <span class="block text-base-content/60">Hanya nama & nomor. PIN tidak ikut, jadi siswa membuat PIN baru.</span>
        </span>
      </label>
      <div v-if="galat" role="alert" class="alert alert-error text-sm"><span>{{ galat }}</span></div>
      <div class="modal-action mt-0">
        <button type="button" class="btn" :disabled="sibuk" @click="emit('tutup')">Batal</button>
        <button type="button" class="btn btn-primary" :disabled="sibuk" @click="duplikasi">
          <span v-if="sibuk" class="loading loading-spinner"></span>
          <i v-else class="fa-solid fa-copy" aria-hidden="true"></i> Duplikasi
        </button>
      </div>
    </div>
  </dialog>
</template>
