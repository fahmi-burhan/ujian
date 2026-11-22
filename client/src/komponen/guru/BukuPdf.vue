<!--
  client/src/komponen/guru/BukuPdf.vue — tab "Buku PDF": unggah, buka (pratinjau di tab baru), dan hapus PDF.
  Dipanggil oleh: client/src/halaman/PenyusunanUjian.vue.
  Memanggil: POST /api/ujian/:id/pdf (body mentah, tanpa pustaka unggah), DELETE /api/ujian/:id/pdf/:pdfId.
  Nama berkas TERLIHAT siswa di ruang tunggu, dan berkasnya boleh dibaca siswa sejak ruang tunggu
  (keputusan pemilik), jadi jangan mengunggah kunci jawaban sebagai "buku".
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { BATAS, PdfInfoSchema } from '../../../../shared/ujian.ts';
import type { UjianDetail } from '../../../../shared/ujian.ts';
import { api, pesanGalat } from '../../api.ts';
import { ukuranMb, waktuWib } from '../../label.ts';

const props = defineProps<{ ujian: UjianDetail }>();
const emit = defineEmits<{ 'muat-ulang': [] }>();

const galat = ref('');
const mengunggah = ref(false);
const pemilih = ref<HTMLInputElement | null>(null);
const draf = computed(() => props.ujian.status === 'draf');

function dirujuk(pdfId: number): number {
  return props.ujian.soal.filter((s) => s.rujukan.some((r) => r.pdf_id === pdfId)).length;
}

async function unggah(): Promise<void> {
  const berkas = pemilih.value?.files?.[0];
  if (!berkas) return;
  galat.value = '';
  // Dicek di browser dulu supaya guru tidak menunggu unggahan 100 MB yang pasti ditolak server.
  if (berkas.size > BATAS.pdfByte) {
    galat.value = `Berkas ${ukuranMb(berkas.size)}; maksimal ${ukuranMb(BATAS.pdfByte)}.`;
    return;
  }
  mengunggah.value = true;
  try {
    await api('POST', `/api/ujian/${props.ujian.id}/pdf`, {
      mentah: { isi: berkas, tipe: 'application/pdf', header: { 'X-Nama-Berkas': encodeURIComponent(berkas.name) } },
      skema: PdfInfoSchema,
    });
    emit('muat-ulang');
  } catch (e) {
    galat.value = pesanGalat(e);
  } finally {
    mengunggah.value = false;
    if (pemilih.value) pemilih.value.value = '';
  }
}

async function hapus(pdfId: number, nama: string): Promise<void> {
  const n = dirujuk(pdfId);
  const tambahan = n > 0 ? ` Rujukan di ${n} soal ikut dikosongkan.` : '';
  if (!window.confirm(`Hapus PDF "${nama}"?${tambahan}`)) return;
  galat.value = '';
  try {
    await api('DELETE', `/api/ujian/${props.ujian.id}/pdf/${pdfId}`);
  } catch (e) {
    galat.value = pesanGalat(e);
  }
  emit('muat-ulang');
}
</script>

<template>
  <section class="card bg-base-100 shadow">
    <div class="card-body gap-3">
      <div v-if="galat" role="alert" class="alert alert-error"><span>{{ galat }}</span></div>
      <div class="alert">
        <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
        <span class="text-sm">
          Siswa boleh membaca PDF ini sejak ruang tunggu, dan nama berkasnya terlihat. Jangan mengunggah
          kunci jawaban, dan beri nama berkas yang tidak membocorkan soal. Maksimal {{ ukuranMb(BATAS.pdfByte) }} per berkas.
        </span>
      </div>

      <p v-if="ujian.pdf.length === 0" class="text-base-content/70">Belum ada PDF.</p>
      <ul v-else class="flex flex-col gap-2">
        <li v-for="p in ujian.pdf" :key="p.id" class="border border-base-300 rounded-box p-3 flex flex-wrap items-center gap-3">
          <i class="fa-solid fa-file-pdf text-error text-xl" aria-hidden="true"></i>
          <div class="flex-1 min-w-48">
            <p class="font-medium break-words">{{ p.nama_tampil }}</p>
            <p class="text-xs text-base-content/60">
              {{ ukuranMb(p.ukuran_byte) }} · diunggah {{ waktuWib(p.diunggah_at) }} · dirujuk {{ dirujuk(p.id) }} soal
            </p>
          </div>
          <a class="btn btn-sm" :href="`/api/ujian/${ujian.id}/pdf/${p.id}`" target="_blank" rel="noopener">
            <i class="fa-solid fa-up-right-from-square" aria-hidden="true"></i> Buka
          </a>
          <button v-if="draf" type="button" class="btn btn-sm btn-ghost text-error" :aria-label="`Hapus ${p.nama_tampil}`" @click="hapus(p.id, p.nama_tampil)">
            <i class="fa-solid fa-trash" aria-hidden="true"></i>
          </button>
        </li>
      </ul>

      <div v-if="draf && ujian.pdf.length < BATAS.jumlahPdf" class="flex flex-wrap items-center gap-2">
        <input ref="pemilih" type="file" accept="application/pdf,.pdf" class="file-input" :disabled="mengunggah" @change="unggah" />
        <span v-if="mengunggah" class="flex items-center gap-2 text-sm"><span class="loading loading-spinner"></span> Mengunggah…</span>
      </div>
      <p v-else-if="!draf" class="text-sm text-base-content/70">
        <i class="fa-solid fa-lock" aria-hidden="true"></i> PDF terkunci setelah ujian dibuka.
      </p>
    </div>
  </section>
</template>
