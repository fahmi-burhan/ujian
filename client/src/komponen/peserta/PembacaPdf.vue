<!--
  client/src/komponen/peserta/PembacaPdf.vue — pembaca buku PDF di dalam halaman ujian: satu halaman per tampilan,
  tombol sebelumnya/berikutnya, lompat ke nomor halaman, perbesar/perkecil, dan pilihan buku bila lebih dari satu.
  Dipanggil oleh: client/src/komponen/peserta/RuangTunggu.vue dan Pengerjaan.vue (sebagai komponen async, jadi
  PDF.js hanya diunduh saat pembaca pertama kali tampil).
  Memanggil: client/src/pdf.ts (memuat dokumen), PDF.js (render canvas + lapisan teks).
  Dirender ke <canvas> di dokumen yang sama, bukan viewer bawaan browser (memicu blur & menampilkan tombol unduh).
  Lapisan teks transparan di atas canvas membuat teks buku bisa diseleksi & disalin ke jawaban.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { muatPdf } from '../../pdf.ts';

type Pdf = { id: number; nama_tampil: string };
// `n` dinaikkan pemanggil setiap kali meminta lompat (mis. dua kali klik tautan halaman yang sama).
type Permintaan = { pdfId: number; halaman: number | null; n: number };

const props = defineProps<{ daftar: Pdf[]; permintaan?: Permintaan | null }>();

const pdfId = ref<number | null>(props.daftar[0]?.id ?? null);
const dokumen = shallowRef<PDFDocumentProxy | null>(null);
const halaman = ref(1);
const isianHalaman = ref('1');
const zoom = ref(1);
const memuat = ref(false);
const galat = ref('');
const wadah = ref<HTMLDivElement | null>(null);
const kanvas = ref<HTMLCanvasElement | null>(null);
const lapisanTeks = ref<HTMLDivElement | null>(null);
const halamanWrapper = ref<HTMLDivElement | null>(null);

const jumlahHalaman = computed(() => dokumen.value?.numPages ?? 0);
let tugasRender: RenderTask | null = null;
let tugasTeks: TextLayer | null = null;
let nomorRender = 0;
let pengamatUkuran: ResizeObserver | null = null;
let pewaktuUkuran: ReturnType<typeof setTimeout> | undefined;
let lebarTerakhir = 0;

async function bukaPdf(id: number, ke = 1): Promise<void> {
  galat.value = '';
  memuat.value = true;
  dokumen.value = null;
  try {
    const doc = await muatPdf(id);
    if (pdfId.value !== id) return;
    dokumen.value = doc;
    halaman.value = Math.min(Math.max(1, ke), doc.numPages);
    await render();
  } catch {
    if (pdfId.value === id) galat.value = 'Buku gagal dimuat. Periksa koneksi, lalu tekan "Coba lagi".';
  } finally {
    memuat.value = false;
  }
}

async function render(): Promise<void> {
  const doc = dokumen.value;
  const elKanvas = kanvas.value;
  const elTeks = lapisanTeks.value;
  const elWadah = wadah.value;
  const elHalaman = halamanWrapper.value;
  if (!doc || !elKanvas || !elTeks || !elWadah || !elHalaman) return;
  const nomor = ++nomorRender;
  tugasRender?.cancel();
  tugasTeks?.cancel();
  isianHalaman.value = String(halaman.value);
  try {
    const page = await doc.getPage(halaman.value);
    if (nomor !== nomorRender) return;
    // Skala "pas lebar" dikali zoom pilihan siswa.
    const lebarTersedia = Math.max(200, elWadah.clientWidth - 16);
    const dasar = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (lebarTersedia / dasar.width) * zoom.value });
    // Canvas dibuat lebih tajam di layar beresolusi tinggi (devicePixelRatio), dibatasi agar hemat memori.
    const rasio = Math.min(window.devicePixelRatio || 1, 2);
    elKanvas.width = Math.floor(viewport.width * rasio);
    elKanvas.height = Math.floor(viewport.height * rasio);
    elKanvas.style.width = `${Math.floor(viewport.width)}px`;
    elKanvas.style.height = `${Math.floor(viewport.height)}px`;
    elHalaman.style.setProperty('--total-scale-factor', String(viewport.scale));
    tugasRender = page.render({
      canvas: elKanvas,
      viewport,
      transform: rasio !== 1 ? [rasio, 0, 0, rasio, 0, 0] : undefined,
    });
    await tugasRender.promise;
    if (nomor !== nomorRender) return;
    elTeks.replaceChildren();
    tugasTeks = new TextLayer({ textContentSource: page.streamTextContent(), container: elTeks, viewport });
    await tugasTeks.render();
    lebarTerakhir = elWadah.clientWidth;
  } catch (e) {
    // Render yang dibatalkan karena siswa sudah pindah halaman bukan galat.
    if (e instanceof Error && e.name === 'RenderingCancelledException') return;
    if (nomor === nomorRender) galat.value = 'Halaman ini gagal ditampilkan. Coba pindah halaman atau muat ulang.';
  }
}

function keHalaman(n: number): void {
  if (!dokumen.value) return;
  const tujuan = Math.min(Math.max(1, Math.round(n)), jumlahHalaman.value);
  if (tujuan === halaman.value) {
    isianHalaman.value = String(tujuan);
    return;
  }
  halaman.value = tujuan;
  wadah.value?.scrollTo({ top: 0 });
  void render();
}

function ubahZoom(arah: number): void {
  zoom.value = Math.min(3, Math.max(0.5, Math.round((zoom.value + arah * 0.25) * 100) / 100));
  void render();
}

function pasLebar(): void {
  zoom.value = 1;
  void render();
}

function gantiPdf(id: number, ke = 1): void {
  pdfId.value = id;
  void bukaPdf(id, ke);
}

// Lompat dari tautan "lihat halaman X" di soal.
watch(
  () => props.permintaan?.n,
  () => {
    const p = props.permintaan;
    if (!p) return;
    if (p.pdfId !== pdfId.value || !dokumen.value) gantiPdf(p.pdfId, p.halaman ?? 1);
    else keHalaman(p.halaman ?? 1);
  },
);

onMounted(async () => {
  await nextTick();
  const awal = props.permintaan;
  if (awal) gantiPdf(awal.pdfId, awal.halaman ?? 1);
  else if (pdfId.value !== null) void bukaPdf(pdfId.value);
  // Panel diperlebar/dipersempit (mis. jendela berubah) → gambar disesuaikan, ditunda agar tidak render berulang.
  if (wadah.value && typeof ResizeObserver !== 'undefined') {
    pengamatUkuran = new ResizeObserver(() => {
      clearTimeout(pewaktuUkuran);
      pewaktuUkuran = setTimeout(() => {
        if (wadah.value && Math.abs(wadah.value.clientWidth - lebarTerakhir) > 8) void render();
      }, 200);
    });
    pengamatUkuran.observe(wadah.value);
  }
});

onBeforeUnmount(() => {
  nomorRender += 1;
  tugasRender?.cancel();
  tugasTeks?.cancel();
  pengamatUkuran?.disconnect();
  clearTimeout(pewaktuUkuran);
});
</script>

<template>
  <section class="flex flex-col h-full min-h-0 bg-base-200 rounded-box overflow-hidden" aria-label="Pembaca buku PDF">
    <div class="flex flex-wrap items-center gap-1 p-2 bg-base-100 border-b border-base-300">
      <select
        v-if="daftar.length > 1"
        class="select select-sm max-w-48"
        :value="pdfId ?? undefined"
        aria-label="Pilih buku"
        @change="gantiPdf(Number(($event.target as HTMLSelectElement).value))"
      >
        <option v-for="p in daftar" :key="p.id" :value="p.id">{{ p.nama_tampil }}</option>
      </select>
      <span v-else-if="daftar[0]" class="text-sm font-semibold truncate max-w-48 px-1">{{ daftar[0].nama_tampil }}</span>

      <div class="join ml-auto">
        <button class="btn btn-sm join-item" type="button" :disabled="halaman <= 1" aria-label="Halaman sebelumnya" @click="keHalaman(halaman - 1)">
          <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
        </button>
        <form class="join-item flex items-center gap-1 px-2 bg-base-200 text-sm" @submit.prevent="keHalaman(Number(isianHalaman))">
          <input
            v-model="isianHalaman"
            class="input input-xs w-14 text-center"
            inputmode="numeric"
            aria-label="Nomor halaman"
            @blur="keHalaman(Number(isianHalaman))"
          />
          <span class="whitespace-nowrap">/ {{ jumlahHalaman || '…' }}</span>
        </form>
        <button
          class="btn btn-sm join-item"
          type="button"
          :disabled="halaman >= jumlahHalaman"
          aria-label="Halaman berikutnya"
          @click="keHalaman(halaman + 1)"
        >
          <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
        </button>
      </div>
      <div class="join">
        <button class="btn btn-sm join-item" type="button" aria-label="Perkecil" @click="ubahZoom(-1)">
          <i class="fa-solid fa-magnifying-glass-minus" aria-hidden="true"></i>
        </button>
        <button class="btn btn-sm join-item" type="button" aria-label="Pas lebar" @click="pasLebar">{{ Math.round(zoom * 100) }}%</button>
        <button class="btn btn-sm join-item" type="button" aria-label="Perbesar" @click="ubahZoom(1)">
          <i class="fa-solid fa-magnifying-glass-plus" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <div ref="wadah" class="flex-1 min-h-0 overflow-auto p-2">
      <div v-if="memuat" class="flex items-center gap-2 p-4"><span class="loading loading-spinner"></span> Memuat buku…</div>
      <div v-if="galat" role="alert" class="alert alert-warning m-2">
        <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
        <span>{{ galat }}</span>
        <button v-if="pdfId !== null" class="btn btn-sm" type="button" @click="gantiPdf(pdfId, halaman)">Coba lagi</button>
      </div>
      <div v-show="dokumen && !galat" ref="halamanWrapper" class="halaman-pdf relative mx-auto shadow bg-white w-fit">
        <canvas ref="kanvas" class="block"></canvas>
        <div ref="lapisanTeks" class="textLayer"></div>
      </div>
    </div>
  </section>
</template>
