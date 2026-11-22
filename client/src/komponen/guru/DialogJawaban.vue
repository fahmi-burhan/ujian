<!--
  client/src/komponen/guru/DialogJawaban.vue — jawaban satu siswa untuk guru: jawaban terkini per soal, riwayat
  versi, kiriman yang tiba setelah waktu habis (jawaban terlambat), dan semua aktivitasnya. Hanya untuk dibaca;
  keputusan jawaban terlambat & pemulihan versi dibuat bersama penilaian (Fase 6).
  Dipanggil oleh: client/src/halaman/PantauUjian.vue.
  Memanggil: GET /api/ujian/:id/peserta/:pid/jawaban.
  Teks jawaban dirender sebagai teks ({{ }}), tidak pernah sebagai HTML (aturan keras #9).
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { JawabanGuruSchema, LABEL_EVENT } from '../../../../shared/pantau.ts';
import type { JawabanGuru } from '../../../../shared/pantau.ts';
import { api, pesanGalat } from '../../api.ts';
import { durasiSingkat, jamWib, LABEL_STATUS_PESERTA, waktuWib } from '../../label.ts';

const props = defineProps<{ ujianId: number; pesertaId: number }>();
const emit = defineEmits<{ tutup: [] }>();

const data = ref<JawabanGuru | null>(null);
const galat = ref('');
const riwayatTerbuka = ref<number | null>(null);

const LABEL_ALASAN: Record<string, string> = {
  berkala: 'tersimpan berkala',
  kumpul: 'saat dikumpulkan',
  konflik: 'dipilih siswa saat ada dua versi',
  pulih: 'dipulihkan guru',
  terlambat: 'jawaban terlambat diterima',
};
const LABEL_TERLAMBAT: Record<string, string> = {
  waktu_habis: 'setelah waktu habis',
  diakhiri: 'setelah ujian diakhiri',
  sudah_dikumpulkan: 'setelah mengumpulkan',
};

const perSoal = computed(() =>
  (data.value?.soal ?? []).map((s) => ({
    soal: s,
    jawaban: data.value?.jawaban.find((j) => j.soal_id === s.id) ?? null,
    riwayat: data.value?.riwayat.filter((r) => r.soal_id === s.id) ?? [],
    terlambat: data.value?.terlambat.filter((t) => t.soal_id === s.id) ?? [],
  })),
);

onMounted(async () => {
  try {
    data.value = await api('GET', `/api/ujian/${props.ujianId}/peserta/${props.pesertaId}/jawaban`, { skema: JawabanGuruSchema });
  } catch (e) {
    galat.value = pesanGalat(e);
  }
});
</script>

<template>
  <dialog class="modal modal-open" open aria-labelledby="judul-jawaban" @keydown.esc="emit('tutup')">
    <div class="modal-box max-w-4xl flex flex-col gap-3">
      <div class="flex items-start gap-2">
        <h3 id="judul-jawaban" class="font-bold text-lg flex-1">
          <i class="fa-solid fa-file-lines" aria-hidden="true"></i>
          Jawaban {{ data?.peserta.nama ?? '…' }}
          <span v-if="data" class="badge badge-sm align-middle">{{ LABEL_STATUS_PESERTA[data.peserta.status] }}</span>
        </h3>
        <button type="button" class="btn btn-sm btn-ghost" aria-label="Tutup" @click="emit('tutup')">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </div>
      <div v-if="galat" role="alert" class="alert alert-error"><span>{{ galat }}</span></div>
      <div v-if="!data && !galat" class="flex items-center gap-2"><span class="loading loading-spinner"></span> Memuat…</div>

      <template v-if="data">
        <section v-for="x in perSoal" :key="x.soal.id" class="border border-base-300 rounded-box p-3 flex flex-col gap-2">
          <h4 class="font-semibold">
            Soal {{ x.soal.urutan }}: {{ x.soal.judul }}
            <i v-if="x.jawaban?.ditandai" class="fa-solid fa-flag text-warning" title="Ditandai siswa untuk dicek lagi" aria-label="ditandai cek lagi"></i>
          </h4>
          <p v-if="!x.jawaban || x.jawaban.isi.trim() === ''" class="text-base-content/50 italic">(tidak dijawab)</p>
          <p v-else class="whitespace-pre-wrap break-words bg-base-200 rounded p-2">{{ x.jawaban.isi }}</p>
          <p v-if="x.jawaban && x.jawaban.versi > 0" class="text-xs text-base-content/60">
            Versi {{ x.jawaban.versi }} · disimpan {{ waktuWib(x.jawaban.diubah_at) }}
          </p>

          <div v-for="t in x.terlambat" :key="t.id" class="alert alert-warning items-start text-sm">
            <i class="fa-solid fa-clock mt-0.5" aria-hidden="true"></i>
            <div class="flex flex-col gap-1 min-w-0">
              <p>Kiriman {{ LABEL_TERLAMBAT[t.alasan] ?? t.alasan }} ({{ jamWib(t.diterima_at) }} WIB) · keputusan: {{ t.keputusan }}</p>
              <p class="whitespace-pre-wrap break-words">{{ t.isi }}</p>
            </div>
          </div>

          <div v-if="x.riwayat.length > 1">
            <button type="button" class="link text-sm" @click="riwayatTerbuka = riwayatTerbuka === x.soal.id ? null : x.soal.id">
              {{ riwayatTerbuka === x.soal.id ? 'Sembunyikan' : 'Lihat' }} riwayat ({{ x.riwayat.length }} versi)
            </button>
            <ol v-if="riwayatTerbuka === x.soal.id" class="flex flex-col gap-2 mt-2">
              <li v-for="r in x.riwayat" :key="r.versi" class="text-sm border-l-2 border-base-300 pl-2">
                <p class="text-xs text-base-content/60">
                  Versi {{ r.versi }} · {{ jamWib(r.disimpan_at) }} WIB · {{ LABEL_ALASAN[r.alasan] ?? r.alasan }}
                </p>
                <p class="whitespace-pre-wrap break-words">{{ r.isi }}</p>
              </li>
            </ol>
          </div>
        </section>

        <section class="flex flex-col gap-1">
          <h4 class="font-semibold">Aktivitas</h4>
          <p v-if="data.event.length === 0" class="text-sm text-base-content/60">Tidak ada.</p>
          <ul v-else class="text-sm flex flex-col gap-1">
            <li v-for="e in data.event" :key="e.id" :class="{ 'opacity-50': e.ditandai_wajar }">
              <span class="font-mono">{{ jamWib(e.mulai_at) }}</span> · {{ LABEL_EVENT[e.jenis] }}
              <template v-if="e.durasi_ms !== null"> · {{ durasiSingkat(e.durasi_ms) }}</template>
              <template v-if="e.ditandai_wajar"> · ditandai wajar</template>
              <template v-if="e.catatan_penguji"> · "{{ e.catatan_penguji }}"</template>
            </li>
          </ul>
        </section>
      </template>
    </div>
    <div class="modal-backdrop" @click="emit('tutup')"></div>
  </dialog>
</template>
