<!--
  client/src/komponen/guru/PratinjauUjian.vue — tab "Pratinjau": tampilan ujian dari sisi siswa, dirender dari
  data guru tanpa sesi siswa (docs/DESAIN.md §2, fase draf).
  Dipanggil oleh: client/src/halaman/PenyusunanUjian.vue.
  Memanggil: tidak ada (hanya menampilkan props).
  Sengaja TIDAK menampilkan rubrik & jawaban acuan, karena siswa tidak pernah melihatnya. Teks dirender
  sebagai teks biasa ({{ }}), bukan HTML. Tampilan pengerjaan lengkap (timer, autosave, PDF) dibuat di Fase 4.
-->
<script setup lang="ts">
import type { UjianDetail } from '../../../../shared/ujian.ts';

const props = defineProps<{ ujian: UjianDetail }>();

function rujukan(pdfId: number | null, halaman: number | null): string {
  const nama = props.ujian.pdf.find((p) => p.id === pdfId)?.nama_tampil;
  if (!nama) return '';
  return halaman ? `${nama}, halaman ${halaman}` : nama;
}
</script>

<template>
  <section class="flex flex-col gap-4">
    <div class="alert">
      <i class="fa-solid fa-eye" aria-hidden="true"></i>
      <span class="text-sm">
        Di ruang tunggu siswa hanya melihat bagian <strong>Ruang tunggu</strong>. Bagian <strong>Soal</strong>
        baru terkirim ke laptop siswa setelah Anda menekan Mulai.
      </span>
    </div>

    <div class="card bg-base-100 shadow">
      <div class="card-body gap-2">
        <span class="badge badge-ghost">Ruang tunggu</span>
        <h2 class="text-2xl font-bold break-words">{{ ujian.judul }}</h2>
        <p class="text-sm text-base-content/70">{{ ujian.durasi_menit }} menit · {{ ujian.soal.length }} soal</p>
        <p v-if="ujian.petunjuk" class="whitespace-pre-wrap">{{ ujian.petunjuk }}</p>
        <div v-if="ujian.pdf.length" class="flex flex-wrap gap-2">
          <span v-for="p in ujian.pdf" :key="p.id" class="badge badge-outline gap-1">
            <i class="fa-solid fa-book" aria-hidden="true"></i> {{ p.nama_tampil }}
          </span>
        </div>
      </div>
    </div>

    <div class="card bg-base-100 shadow">
      <div class="card-body gap-4">
        <span class="badge badge-ghost">Soal (setelah Mulai)</span>
        <p v-if="ujian.soal.length === 0" class="text-base-content/70">Belum ada soal.</p>
        <article v-for="s in ujian.soal" :key="s.id" class="flex flex-col gap-1">
          <h3 class="font-semibold break-words">{{ s.urutan }}. {{ s.judul }} <span class="text-sm font-normal text-base-content/60">(bobot {{ s.bobot }})</span></h3>
          <p class="whitespace-pre-wrap break-words">{{ s.teks || '(teks soal masih kosong)' }}</p>
          <p v-for="(r, j) in s.rujukan" :key="j" class="text-sm text-base-content/70">
            <i class="fa-solid fa-book-open" aria-hidden="true"></i> Lihat: {{ rujukan(r.pdf_id, r.halaman) }}
          </p>
        </article>
      </div>
    </div>
  </section>
</template>
