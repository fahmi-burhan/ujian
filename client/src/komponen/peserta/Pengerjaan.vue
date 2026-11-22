<!--
  client/src/komponen/peserta/Pengerjaan.vue — layar mengerjakan: daftar soal (bebas urutan), teks soal, kotak
  jawaban dengan status simpan, tanda "cek lagi", panel buku PDF, sisa waktu, dan tombol Kumpulkan.
  Dipanggil oleh: client/src/halaman/UjianPeserta.vue (yang memegang autosave, aliran SSE, dan waktu).
  Memanggil: client/src/autosave.ts (lewat props), PembacaPdf.vue (async), client/src/layar-penuh.ts.
  Isi jawaban selalu dibaca dari autosave (satu sumber kebenaran), jadi pilihan saat bentrok langsung tampil.
  Teks soal & jawaban dirender sebagai teks ({{ }}), tidak pernah sebagai HTML.
-->
<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import type { SoalPeserta, UjianPeserta } from '../../../../shared/peserta.ts';
import { BATAS_ISI_JAWABAN } from '../../../../shared/peserta.ts';
import { formatSisa } from '../../../../shared/time.ts';
import type { Autosave, KeadaanSoal } from '../../autosave.ts';
import { layarPenuh, masukLayarPenuh } from '../../layar-penuh.ts';

const PembacaPdf = defineAsyncComponent(() => import('./PembacaPdf.vue'));

const props = defineProps<{
  ujian: UjianPeserta;
  autosave: Autosave;
  // Dinaikkan setiap autosave berubah, supaya tampilan membaca ulang isi & status simpan.
  versi: number;
  sisaMs: number;
  // Editor terkunci (dijeda / waktu habis / tab lain aktif) beserta alasannya untuk ditampilkan.
  kunci: string | null;
  mengumpulkan: boolean;
  galatKumpul: string;
}>();
const emit = defineEmits<{ kumpulkan: [] }>();

const soal = computed<SoalPeserta[]>(() => props.ujian.soal ?? []);
const aktifId = ref<number | null>(soal.value[0]?.id ?? null);
const aktif = computed(() => soal.value.find((s) => s.id === aktifId.value) ?? null);
const nomorAktif = computed(() => soal.value.findIndex((s) => s.id === aktifId.value));
const panelBuku = ref(false);
const permintaanPdf = ref<{ pdfId: number; halaman: number | null; n: number } | null>(null);
const konfirmasi = ref(false);

// Autosave bukan objek reaktif Vue. Membaca `props.versi` membuat computed dihitung ulang setiap autosave berubah.
function ikutiAutosave<T>(baca: () => T) {
  return computed<T>(() => {
    void props.versi;
    return baca();
  });
}
const isiAktif = ikutiAutosave(() => (aktifId.value === null ? '' : props.autosave.isi(aktifId.value)));
const ditandaiAktif = ikutiAutosave(() => aktifId.value !== null && props.autosave.ditandai(aktifId.value));
const keadaanAktif = ikutiAutosave<KeadaanSoal>(() =>
  aktifId.value === null ? 'tersimpan' : props.autosave.keadaan(aktifId.value),
);
const tertunda = ikutiAutosave(() => props.autosave.jumlahTertunda());
const terjawab = ikutiAutosave(() => soal.value.filter((s) => props.autosave.isi(s.id).trim() !== '').length);
const ditandaiSemua = ikutiAutosave(() => soal.value.filter((s) => props.autosave.ditandai(s.id)).length);
const editorTerkunci = computed(() => props.kunci !== null || keadaanAktif.value === 'bentrok' || keadaanAktif.value === 'terlambat');
const waktuMenipis = computed(() => props.sisaMs <= 5 * 60_000);

const LABEL_KEADAAN: Record<KeadaanSoal, { teks: string; kelas: string; ikon: string }> = {
  tersimpan: { teks: 'Tersimpan', kelas: 'text-success', ikon: 'fa-circle-check' },
  menunggu: { teks: 'Menyimpan…', kelas: 'text-base-content/60', ikon: 'fa-pen' },
  mengirim: { teks: 'Menyimpan…', kelas: 'text-base-content/60', ikon: 'fa-arrows-rotate' },
  gagal: { teks: 'Belum tersimpan di server — disimpan di laptop, dicoba lagi otomatis', kelas: 'text-warning', ikon: 'fa-wifi' },
  dijeda: { teks: 'Disimpan di laptop; dikirim setelah ujian dilanjutkan', kelas: 'text-warning', ikon: 'fa-pause' },
  terlambat: { teks: 'Terkirim setelah waktu habis; guru yang memutuskan', kelas: 'text-warning', ikon: 'fa-clock' },
  bentrok: { teks: 'Pilih teks yang dipakai', kelas: 'text-error', ikon: 'fa-code-compare' },
  ditolak: { teks: 'Belum terkirim — disimpan di laptop', kelas: 'text-warning', ikon: 'fa-triangle-exclamation' },
};

function namaPdf(id: number | null): string {
  return props.ujian.pdf.find((p) => p.id === id)?.nama_tampil ?? 'Buku';
}

function bukaRujukan(s: SoalPeserta): void {
  if (s.pdf_id === null) return;
  panelBuku.value = true;
  permintaanPdf.value = { pdfId: s.pdf_id, halaman: s.pdf_halaman, n: (permintaanPdf.value?.n ?? 0) + 1 };
}

function ketik(e: Event): void {
  if (aktifId.value === null || editorTerkunci.value) return;
  props.autosave.ubah(aktifId.value, (e.target as HTMLTextAreaElement).value, ditandaiAktif.value);
}

function tandai(): void {
  if (aktifId.value === null || editorTerkunci.value) return;
  props.autosave.ubah(aktifId.value, isiAktif.value, !ditandaiAktif.value);
}

function pindah(selisih: number): void {
  const tujuan = soal.value[nomorAktif.value + selisih];
  if (tujuan) aktifId.value = tujuan.id;
}

function minta(): void {
  konfirmasi.value = false;
  emit('kumpulkan');
}

// Soal aktif hilang (mis. data dimuat ulang) → kembali ke soal pertama.
watch(soal, (daftar) => {
  if (!daftar.some((s) => s.id === aktifId.value)) aktifId.value = daftar[0]?.id ?? null;
});
</script>

<template>
  <div class="h-screen flex flex-col bg-base-200">
    <header class="flex flex-wrap items-center gap-3 px-4 py-2 bg-base-100 shadow z-10">
      <div class="min-w-0 flex-1">
        <p class="font-bold truncate">{{ ujian.judul }}</p>
        <p class="text-xs text-base-content/60 truncate">{{ ujian.saya.nama }}</p>
      </div>
      <div
        class="font-mono text-2xl font-bold tabular-nums px-3 rounded-box"
        :class="ujian.waktu.dijeda ? 'bg-warning/20' : waktuMenipis ? 'bg-error/15 text-error' : ''"
        role="timer"
        :aria-label="`Sisa waktu ${formatSisa(sisaMs)}`"
      >
        <i class="fa-solid" :class="ujian.waktu.dijeda ? 'fa-pause' : 'fa-clock'" aria-hidden="true"></i>
        {{ formatSisa(sisaMs) }}
      </div>
      <p class="text-sm hidden md:block" :class="tertunda ? 'text-warning' : 'text-success'">
        <i class="fa-solid" :class="tertunda ? 'fa-arrows-rotate' : 'fa-cloud'" aria-hidden="true"></i>
        {{ tertunda ? `${tertunda} jawaban belum tersimpan` : 'Semua jawaban tersimpan' }}
      </p>
      <button v-if="!layarPenuh" class="btn btn-sm" type="button" @click="masukLayarPenuh">
        <i class="fa-solid fa-expand" aria-hidden="true"></i> Layar penuh
      </button>
      <button v-if="ujian.pdf.length" class="btn btn-sm" :class="{ 'btn-active': panelBuku }" type="button" @click="panelBuku = !panelBuku">
        <i class="fa-solid fa-book-open" aria-hidden="true"></i> Buku
      </button>
      <button class="btn btn-sm btn-primary" type="button" :disabled="mengumpulkan || kunci !== null" @click="konfirmasi = true">
        <i class="fa-solid fa-paper-plane" aria-hidden="true"></i> Kumpulkan
      </button>
    </header>

    <div v-if="kunci" role="status" class="alert alert-warning rounded-none">
      <i class="fa-solid fa-lock" aria-hidden="true"></i>
      <span>{{ kunci }}</span>
    </div>
    <div v-if="galatKumpul" role="alert" class="alert alert-error rounded-none">
      <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
      <span>{{ galatKumpul }}</span>
    </div>

    <div class="flex-1 min-h-0 flex flex-col lg:flex-row gap-3 p-3">
      <nav class="lg:w-20 shrink-0 flex lg:flex-col gap-2 overflow-auto" aria-label="Daftar soal">
        <button
          v-for="(s, i) in soal"
          :key="s.id"
          type="button"
          class="btn btn-square relative shrink-0"
          :class="s.id === aktifId ? 'btn-primary' : autosave.isi(s.id).trim() ? 'btn-soft btn-success' : 'btn-outline'"
          :aria-label="`Soal ${i + 1}${autosave.isi(s.id).trim() ? ', sudah dijawab' : ''}${autosave.ditandai(s.id) ? ', ditandai' : ''}`"
          :aria-current="s.id === aktifId ? 'true' : undefined"
          :data-versi="versi"
          @click="aktifId = s.id"
        >
          {{ i + 1 }}
          <i v-if="autosave.ditandai(s.id)" class="fa-solid fa-flag text-warning absolute -top-1 -right-1 text-xs" aria-hidden="true"></i>
        </button>
      </nav>

      <main v-if="aktif" class="flex-1 min-w-0 min-h-0 flex flex-col gap-2">
        <article class="card bg-base-100 shadow max-h-[40%] overflow-auto shrink-0">
          <div class="card-body gap-2 py-4">
            <h2 class="font-semibold break-words">
              Soal {{ nomorAktif + 1 }} dari {{ soal.length }}: {{ aktif.judul }}
              <span class="text-sm font-normal text-base-content/60">(bobot {{ aktif.bobot }})</span>
            </h2>
            <p class="whitespace-pre-wrap break-words">{{ aktif.teks }}</p>
            <button v-if="aktif.pdf_id !== null" type="button" class="link link-primary text-sm self-start" @click="bukaRujukan(aktif)">
              <i class="fa-solid fa-book-open" aria-hidden="true"></i>
              Lihat {{ namaPdf(aktif.pdf_id) }}<template v-if="aktif.pdf_halaman">, halaman {{ aktif.pdf_halaman }}</template>
            </button>
          </div>
        </article>

        <div class="flex-1 min-h-40 flex flex-col">
          <label :for="`jawaban-${aktif.id}`" class="sr-only">Jawaban soal {{ nomorAktif + 1 }}</label>
          <textarea
            :id="`jawaban-${aktif.id}`"
            :key="aktif.id"
            class="textarea w-full flex-1 text-base leading-relaxed resize-none"
            :value="isiAktif"
            :readonly="editorTerkunci"
            :maxlength="BATAS_ISI_JAWABAN"
            data-jawaban="1"
            placeholder="Tulis jawabanmu di sini…"
            spellcheck="false"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="sentences"
            writingsuggestions="false"
            @input="ketik"
          ></textarea>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <p class="text-sm flex-1 min-w-48" :class="LABEL_KEADAAN[keadaanAktif].kelas" aria-live="polite">
            <i class="fa-solid" :class="LABEL_KEADAAN[keadaanAktif].ikon" aria-hidden="true"></i>
            {{ LABEL_KEADAAN[keadaanAktif].teks }}
            <span class="text-base-content/50"> · {{ isiAktif.length.toLocaleString('id-ID') }} karakter</span>
          </p>
          <button type="button" class="btn btn-sm" :class="{ 'btn-warning': ditandaiAktif }" :disabled="editorTerkunci" @click="tandai">
            <i class="fa-solid fa-flag" aria-hidden="true"></i> {{ ditandaiAktif ? 'Ditandai cek lagi' : 'Tandai cek lagi' }}
          </button>
          <div class="join">
            <button type="button" class="btn btn-sm join-item" :disabled="nomorAktif <= 0" @click="pindah(-1)">
              <i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Sebelumnya
            </button>
            <button type="button" class="btn btn-sm join-item" :disabled="nomorAktif >= soal.length - 1" @click="pindah(1)">
              Berikutnya <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </main>

      <aside v-if="panelBuku && ujian.pdf.length" class="lg:w-[45%] h-[60vh] lg:h-auto min-h-0 shrink-0">
        <PembacaPdf :daftar="ujian.pdf" :permintaan="permintaanPdf" />
      </aside>
    </div>

    <dialog class="modal" :open="konfirmasi" aria-labelledby="judul-kumpul">
      <div class="modal-box">
        <h3 id="judul-kumpul" class="font-bold text-lg">Kumpulkan jawaban?</h3>
        <ul class="my-3 list-disc ml-5">
          <li>{{ terjawab }} dari {{ soal.length }} soal sudah dijawab.</li>
          <li v-if="ditandaiSemua">{{ ditandaiSemua }} soal masih ditandai "cek lagi".</li>
          <li v-if="tertunda" class="text-warning">{{ tertunda }} jawaban belum tersimpan. Tunggu sampai tersimpan.</li>
        </ul>
        <p class="text-sm text-base-content/70">Setelah dikumpulkan, jawaban tidak bisa diubah lagi.</p>
        <div class="modal-action">
          <button type="button" class="btn" @click="konfirmasi = false">Kembali mengerjakan</button>
          <button type="button" class="btn btn-primary" :disabled="tertunda > 0 || mengumpulkan" @click="minta">
            <span v-if="mengumpulkan" class="loading loading-spinner"></span> Ya, kumpulkan
          </button>
        </div>
      </div>
      <div class="modal-backdrop" @click="konfirmasi = false"></div>
    </dialog>
  </div>
</template>
