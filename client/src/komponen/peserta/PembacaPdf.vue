<!--
  client/src/komponen/peserta/PembacaPdf.vue — pembaca buku PDF di dalam halaman ujian: semua halaman bersambung
  dan bisa digulir (permintaan pemilik 22 Nov), lompat ke nomor halaman, tombol sebelumnya/berikutnya,
  perbesar/perkecil, dan pilihan buku bila lebih dari satu.
  Dipanggil oleh: client/src/komponen/peserta/RuangTunggu.vue dan Pengerjaan.vue (sebagai komponen async, jadi
  PDF.js hanya diunduh saat pembaca pertama kali tampil).
  Memanggil: client/src/pdf.ts (memuat dokumen), client/src/buku.ts (progres unduhan & posisi baca), PDF.js (render
             canvas + lapisan teks). Buku dibaca dari memori setelah diunduh utuh; selama masih diunduh, progresnya tampil.
  Dirender ke <canvas> di dokumen yang sama, bukan viewer bawaan browser (memicu blur & menampilkan tombol unduh).
  Lapisan teks transparan di atas canvas membuat teks buku bisa diseleksi & disalin ke jawaban.
  Hemat memori: semua halaman berupa kotak kosong seukuran halaman; hanya halaman yang dekat layar (IntersectionObserver)
  yang digambar, dan gambar halaman yang jauh dilepas lagi. Buku ratusan halaman tetap ringan di laptop sekolah.
  Posisi baca (halaman & zoom) diingat per buku di client/src/buku.ts: ganti buku atau tutup-buka panel kembali ke
  halaman terakhir. Tautan soal yang menyebut halaman tertentu tetap melompat ke halaman itu.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { bukaTerakhir, formatMb, ingatPosisi, posisiBuku, statusBuku } from '../../buku.ts';
import { muatPdf } from '../../pdf.ts';

type Pdf = { id: number; nama_tampil: string; ukuran_byte: number };
// `n` dinaikkan pemanggil setiap kali meminta lompat (mis. dua kali klik tautan halaman yang sama).
type Permintaan = { pdfId: number; halaman: number | null; n: number };
type Ukuran = { w: number; h: number };
type Gambar = { skala: number; batal: boolean; render: RenderTask | null; teks: TextLayer | null };

const props = defineProps<{ daftar: Pdf[]; permintaan?: Permintaan | null }>();

const JARAK_HALAMAN = 8;
// Buku terakhir yang dibaca (bila masih ada di daftar), atau buku pertama.
const terakhir = bukaTerakhir();
const pdfId = ref<number | null>(props.daftar.some((p) => p.id === terakhir) ? terakhir : (props.daftar[0]?.id ?? null));
const dokumen = shallowRef<PDFDocumentProxy | null>(null);
const halaman = ref(1);
const isianHalaman = ref('1');
const zoom = ref(1);
const memuat = ref(false);
const galat = ref('');
const wadah = ref<HTMLDivElement | null>(null);
// Skala tampil = "pas lebar" (dari lebar halaman pertama) × zoom pilihan siswa.
const skala = ref(1);
// Dinaikkan setiap ukuran halaman berubah, supaya kotak halaman di template dihitung ulang.
const versiTata = ref(0);

const jumlahHalaman = computed(() => dokumen.value?.numPages ?? 0);
// Progres unduhan buku yang sedang dibuka (selama belum siap, pembaca menampilkan progres, bukan halaman putih).
const progres = computed(() => (pdfId.value === null ? undefined : statusBuku.get(pdfId.value)));
const kotak = new Map<number, HTMLDivElement>();
const ukuranDasar = new Map<number, Ukuran>();
let ukuranHalaman1: Ukuran = { w: 595, h: 842 };
const gambar = new Map<number, Gambar>();
const dekatLayar = new Set<number>();
let pengamat: IntersectionObserver | null = null;
let pengamatUkuran: ResizeObserver | null = null;
let pewaktuUkuran: ReturnType<typeof setTimeout> | undefined;
let lebarTerakhir = 0;
let bingkaiGulir = 0;

function ukuranTampil(n: number): Ukuran {
  void versiTata.value;
  const u = ukuranDasar.get(n) ?? ukuranHalaman1;
  return { w: Math.floor(u.w * skala.value), h: Math.floor(u.h * skala.value) };
}

function hitungSkala(): void {
  const el = wadah.value;
  if (!el) return;
  const lebarTersedia = Math.max(200, el.clientWidth - 24);
  skala.value = (lebarTersedia / ukuranHalaman1.w) * zoom.value;
  lebarTerakhir = el.clientWidth;
}

function daftarkanKotak(n: number, el: unknown): void {
  const lama = kotak.get(n);
  if (el instanceof HTMLDivElement) {
    if (lama === el) return;
    if (lama) pengamat?.unobserve(lama);
    kotak.set(n, el);
    pengamat?.observe(el);
  } else if (lama) {
    pengamat?.unobserve(lama);
    kotak.delete(n);
  }
}

function lepasGambar(n: number): void {
  const g = gambar.get(n);
  if (!g) return;
  g.batal = true;
  g.render?.cancel();
  g.teks?.cancel();
  gambar.delete(n);
  const el = kotak.get(n);
  // Kanvas dikosongkan dulu agar memorinya langsung dilepas browser.
  el?.querySelectorAll('canvas').forEach((c) => {
    c.width = 0;
    c.height = 0;
  });
  el?.replaceChildren();
}

function lepasSemua(): void {
  for (const n of [...gambar.keys()]) lepasGambar(n);
}

async function gambarHalaman(n: number): Promise<void> {
  const doc = dokumen.value;
  const el = kotak.get(n);
  if (!doc || !el) return;
  const s = skala.value;
  const ada = gambar.get(n);
  if (ada && ada.skala === s) return;
  if (ada) {
    // Gambar lama (skala lain) tetap tampil sampai gambar baru siap; hanya tugasnya yang dibatalkan.
    ada.batal = true;
    ada.render?.cancel();
    ada.teks?.cancel();
  }
  const g: Gambar = { skala: s, batal: false, render: null, teks: null };
  gambar.set(n, g);
  try {
    const page = await doc.getPage(n);
    if (g.batal) return;
    const dasar = page.getViewport({ scale: 1 });
    const lama = ukuranDasar.get(n) ?? ukuranHalaman1;
    if (Math.abs(lama.w - dasar.width) > 0.5 || Math.abs(lama.h - dasar.height) > 0.5) {
      ukuranDasar.set(n, { w: dasar.width, h: dasar.height });
      versiTata.value += 1;
    }
    const viewport = page.getViewport({ scale: s });
    // Canvas dibuat lebih tajam di layar beresolusi tinggi (devicePixelRatio), dibatasi agar hemat memori.
    const rasio = Math.min(window.devicePixelRatio || 1, 2);
    const kanvas = document.createElement('canvas');
    kanvas.width = Math.floor(viewport.width * rasio);
    kanvas.height = Math.floor(viewport.height * rasio);
    kanvas.className = 'block w-full h-full';
    g.render = page.render({ canvas: kanvas, viewport, transform: rasio !== 1 ? [rasio, 0, 0, rasio, 0, 0] : undefined });
    await g.render.promise;
    if (g.batal) return;
    const lapisan = document.createElement('div');
    lapisan.className = 'textLayer';
    el.style.setProperty('--total-scale-factor', String(viewport.scale));
    el.replaceChildren(kanvas, lapisan);
    g.teks = new TextLayer({ textContentSource: page.streamTextContent(), container: lapisan, viewport });
    await g.teks.render();
  } catch (e) {
    // Gambar yang dibatalkan (halaman sudah jauh dari layar / zoom berubah) bukan galat.
    if (e instanceof Error && e.name === 'RenderingCancelledException') return;
    if (!g.batal) gambar.delete(n);
  }
}

// Halaman dekat layar digambar; halaman lain dilepas.
function perbaruiGambar(): void {
  for (const n of dekatLayar) void gambarHalaman(n);
  for (const n of [...gambar.keys()]) if (!dekatLayar.has(n)) lepasGambar(n);
}

function pasangPengamat(): void {
  pengamat?.disconnect();
  dekatLayar.clear();
  if (!wadah.value || typeof IntersectionObserver === 'undefined') return;
  // rootMargin: halaman satu layar di atas & di bawah sudah disiapkan, jadi gulir terasa mulus.
  pengamat = new IntersectionObserver(
    (entri) => {
      for (const e of entri) {
        const n = Number((e.target as HTMLElement).dataset.halaman);
        if (e.isIntersecting) dekatLayar.add(n);
        else dekatLayar.delete(n);
      }
      perbaruiGambar();
    },
    { root: wadah.value, rootMargin: '100% 0px' },
  );
  for (const el of kotak.values()) pengamat.observe(el);
}

// Nomor halaman saat ini = halaman yang menempati sepertiga atas area baca.
function saatGulir(): void {
  if (bingkaiGulir) return;
  bingkaiGulir = requestAnimationFrame(() => {
    bingkaiGulir = 0;
    const el = wadah.value;
    if (!el || !dokumen.value) return;
    const garis = el.scrollTop + el.clientHeight / 3;
    let kini = 1;
    for (let n = 1; n <= jumlahHalaman.value; n++) {
      const k = kotak.get(n);
      if (!k) continue;
      if (k.offsetTop <= garis) kini = n;
      else break;
    }
    halaman.value = kini;
    if (document.activeElement?.getAttribute('aria-label') !== 'Nomor halaman') isianHalaman.value = String(kini);
  });
}

function gulirKe(n: number): void {
  const el = wadah.value;
  const k = kotak.get(n);
  if (!el || !k) return;
  el.scrollTo({ top: k.offsetTop - JARAK_HALAMAN });
}

async function bukaPdf(id: number, ke = 1): Promise<void> {
  galat.value = '';
  memuat.value = true;
  lepasSemua();
  dokumen.value = null;
  ukuranDasar.clear();
  try {
    const doc = await muatPdf(id);
    if (pdfId.value !== id) return;
    const p1 = await doc.getPage(1);
    const v = p1.getViewport({ scale: 1 });
    ukuranHalaman1 = { w: v.width, h: v.height };
    ukuranDasar.set(1, ukuranHalaman1);
    hitungSkala();
    dokumen.value = doc;
    const tujuan = Math.min(Math.max(1, ke), doc.numPages);
    halaman.value = tujuan;
    isianHalaman.value = String(tujuan);
    await nextTick();
    pasangPengamat();
    gulirKe(tujuan);
  } catch {
    if (pdfId.value === id) galat.value = 'Buku gagal diunduh atau dibuka. Periksa Wi-Fi, lalu tekan "Coba lagi".';
  } finally {
    memuat.value = false;
  }
}

function keHalaman(n: number): void {
  if (!dokumen.value || !Number.isFinite(n)) {
    isianHalaman.value = String(halaman.value);
    return;
  }
  const tujuan = Math.min(Math.max(1, Math.round(n)), jumlahHalaman.value);
  halaman.value = tujuan;
  isianHalaman.value = String(tujuan);
  gulirKe(tujuan);
}

// Zoom / lebar berubah: halaman yang sedang dibaca tetap di tempatnya, lalu halaman dekat layar digambar ulang.
async function tataUlang(): Promise<void> {
  const tetap = halaman.value;
  hitungSkala();
  await nextTick();
  gulirKe(tetap);
  perbaruiGambar();
}

function ubahZoom(arah: number): void {
  zoom.value = Math.min(3, Math.max(0.5, Math.round((zoom.value + arah * 0.25) * 100) / 100));
  void tataUlang();
}

function pasLebar(): void {
  zoom.value = 1;
  void tataUlang();
}

// `ke` null = halaman terakhir yang dibaca di buku itu (atau halaman 1). Zoom buku itu ikut dipulihkan.
function gantiPdf(id: number, ke: number | null = null): void {
  const ingat = posisiBuku(id);
  zoom.value = ingat?.zoom ?? 1;
  pdfId.value = id;
  void bukaPdf(id, ke ?? ingat?.halaman ?? 1);
}

watch([halaman, zoom], ([h, z]) => {
  if (pdfId.value !== null && dokumen.value) ingatPosisi(pdfId.value, { halaman: h, zoom: z });
});

// Lompat dari tautan "lihat halaman X" di soal.
watch(
  () => props.permintaan?.n,
  () => {
    const p = props.permintaan;
    if (!p) return;
    if (p.pdfId !== pdfId.value || !dokumen.value) gantiPdf(p.pdfId, p.halaman);
    else if (p.halaman !== null) keHalaman(p.halaman);
  },
);

onMounted(async () => {
  await nextTick();
  const awal = props.permintaan;
  if (awal) gantiPdf(awal.pdfId, awal.halaman);
  else if (pdfId.value !== null) gantiPdf(pdfId.value);
  // Panel diperlebar/dipersempit (mis. jendela berubah) → gambar disesuaikan, ditunda agar tidak render berulang.
  if (wadah.value && typeof ResizeObserver !== 'undefined') {
    pengamatUkuran = new ResizeObserver(() => {
      clearTimeout(pewaktuUkuran);
      pewaktuUkuran = setTimeout(() => {
        if (wadah.value && dokumen.value && Math.abs(wadah.value.clientWidth - lebarTerakhir) > 8) void tataUlang();
      }, 200);
    });
    pengamatUkuran.observe(wadah.value);
  }
});

onBeforeUnmount(() => {
  lepasSemua();
  pengamat?.disconnect();
  pengamatUkuran?.disconnect();
  clearTimeout(pewaktuUkuran);
  if (bingkaiGulir) cancelAnimationFrame(bingkaiGulir);
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
          <i class="fa-solid fa-chevron-up" aria-hidden="true"></i>
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
          <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
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

    <div ref="wadah" class="relative flex-1 min-h-0 overflow-auto p-2" @scroll.passive="saatGulir">
      <div v-if="memuat" class="flex flex-col gap-2 p-4 max-w-sm">
        <p class="flex items-center gap-2">
          <span class="loading loading-spinner"></span>
          {{ progres && progres.keadaan !== 'siap' ? 'Mengunduh buku…' : 'Membuka buku…' }}
        </p>
        <template v-if="progres && progres.keadaan !== 'siap'">
          <progress class="progress progress-primary" :value="progres.diterima" :max="Math.max(1, progres.total ?? 0)"></progress>
          <p class="text-sm text-base-content/70">
            {{ formatMb(progres.diterima) }} dari {{ progres.total ? formatMb(progres.total) : '…' }} MB. Setelah selesai, buku
            bisa dibaca lancar tanpa menunggu jaringan.
          </p>
        </template>
      </div>
      <div v-if="galat" role="alert" class="alert alert-warning m-2">
        <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
        <span>{{ galat }}</span>
        <button v-if="pdfId !== null" class="btn btn-sm" type="button" @click="gantiPdf(pdfId, halaman)">Coba lagi</button>
      </div>
      <template v-if="dokumen && !galat">
        <div
          v-for="n in jumlahHalaman"
          :key="`${pdfId}-${n}`"
          :ref="(el) => daftarkanKotak(n, el)"
          :data-halaman="n"
          class="halaman-pdf relative mx-auto shadow bg-white"
          :style="{ width: `${ukuranTampil(n).w}px`, height: `${ukuranTampil(n).h}px`, marginBottom: `${JARAK_HALAMAN}px` }"
          :aria-label="`Halaman ${n}`"
        ></div>
      </template>
    </div>
  </section>
</template>
