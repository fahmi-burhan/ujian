<!--
  client/src/halaman/PenyusunanUjian.vue — penyusunan satu ujian (alamat "/guru/ujian/:id"): tab Info, Soal &
  rubrik, Buku PDF, Peserta, Pratinjau; daftar periksa kelengkapan; tombol Buka ujian / Kembali ke draf / Hapus /
  Duplikasi,
  dan selama ujian: Mulai / Jeda / Lanjutkan / Akhiri beserta sisa waktu global.
  Dipanggil oleh: client/src/router.ts (hanya setelah lolos penjaga sesi guru).
  Memanggil: GET/DELETE /api/ujian/:id, POST /api/ujian/:id/{buka,kembali-draf,mulai,jeda,lanjutkan,akhiri};
             komponen di komponen/guru/.
  Daftar periksa memakai fungsi yang SAMA dengan server (masalahUjian di shared/ujian.ts), jadi yang
  tertulis di sini persis alasan server menolak "Buka ujian".
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { masalahUjian, UjianDetailSchema } from '../../../shared/ujian.ts';
import type { UjianDetail } from '../../../shared/ujian.ts';
import { api, GalatApi, pesanGalat } from '../api.ts';
import BukuPdf from '../komponen/guru/BukuPdf.vue';
import DaftarPeserta from '../komponen/guru/DaftarPeserta.vue';
import DaftarSoal from '../komponen/guru/DaftarSoal.vue';
import DialogDuplikasi from '../komponen/guru/DialogDuplikasi.vue';
import InfoUjian from '../komponen/guru/InfoUjian.vue';
import KepalaGuru from '../komponen/guru/KepalaGuru.vue';
import PratinjauUjian from '../komponen/guru/PratinjauUjian.vue';
import { LABEL_STATUS_UJIAN, WARNA_STATUS_UJIAN } from '../label.ts';
import { formatSisa } from '../../../shared/time.ts';

type Tab = 'info' | 'soal' | 'pdf' | 'peserta' | 'pratinjau';
const TAB: { id: Tab; label: string; ikon: string }[] = [
  { id: 'info', label: 'Info', ikon: 'fa-circle-info' },
  { id: 'soal', label: 'Soal & rubrik', ikon: 'fa-list-ol' },
  { id: 'pdf', label: 'Buku PDF', ikon: 'fa-file-pdf' },
  { id: 'peserta', label: 'Peserta', ikon: 'fa-users' },
  { id: 'pratinjau', label: 'Pratinjau', ikon: 'fa-eye' },
];

const route = useRoute();
const router = useRouter();
// Mengikuti alamat: komponen ini dipakai ulang bila alamat berpindah dari /guru/ujian/1 ke /guru/ujian/2.
const id = computed(() => Number(route.params.id));
const ujian = ref<UjianDetail | null>(null);
const tab = ref<Tab>('info');
const galat = ref('');
const masalahServer = ref<string[]>([]);
const sibuk = ref(false);
const dialogDuplikasi = ref(false);

const draf = computed(() => ujian.value?.status === 'draf');
const masalah = computed(() => (ujian.value ? masalahUjian(ujian.value) : []));
const berjalan = computed(() => ujian.value?.status === 'berlangsung' || ujian.value?.status === 'dijeda');
// "Akhiri" dua langkah (docs/DESAIN.md §3): klik pertama hanya menampilkan konfirmasi.
const konfirmasiAkhiri = ref(false);

// Sisa waktu GLOBAL dihitung mundur dengan jam monoton browser, diselaraskan setiap data ujian dimuat.
const acuanWaktu = ref<{ sisaMs: number; dijeda: boolean; t: number } | null>(null);
const kini = ref(performance.now());
const sisaGlobal = computed(() => {
  const a = acuanWaktu.value;
  if (!a) return null;
  return a.dijeda ? a.sisaMs : a.sisaMs - (kini.value - a.t);
});
watch(ujian, (u) => {
  acuanWaktu.value = u?.waktu ? { sisaMs: u.waktu.sisa_ms, dijeda: u.waktu.dijeda, t: performance.now() } : null;
});
// Selama ujian berjalan, data dimuat ulang tiap 15 dtk supaya jeda otomatis oleh server (server sempat mati)
// terlihat. Pemantauan real-time per siswa ada di dasbor pemantauan (/guru/ujian/:id/pantau).
const detik = setInterval(() => {
  kini.value = performance.now();
}, 500);
const pemuatUlang = setInterval(() => {
  if (berjalan.value && !sibuk.value) void muat();
}, 15_000);
onBeforeUnmount(() => {
  clearInterval(detik);
  clearInterval(pemuatUlang);
});

async function muat(): Promise<void> {
  try {
    ujian.value = await api('GET', `/api/ujian/${id.value}`, { skema: UjianDetailSchema });
  } catch (e) {
    if (e instanceof GalatApi && e.status === 404) {
      await router.replace('/guru');
      return;
    }
    galat.value = pesanGalat(e);
  }
}

function perbarui(baru: UjianDetail): void {
  ujian.value = baru;
}

type Aksi = 'buka' | 'kembali-draf' | 'mulai' | 'jeda' | 'lanjutkan' | 'akhiri';

async function jalankan(aksi: Aksi): Promise<void> {
  galat.value = '';
  masalahServer.value = [];
  konfirmasiAkhiri.value = false;
  sibuk.value = true;
  try {
    ujian.value = await api('POST', `/api/ujian/${id.value}/${aksi}`, { skema: UjianDetailSchema });
  } catch (e) {
    galat.value = pesanGalat(e);
    if (e instanceof GalatApi && Array.isArray(e.data.masalah)) masalahServer.value = e.data.masalah as string[];
    await muat();
  } finally {
    sibuk.value = false;
  }
}

async function hapus(): Promise<void> {
  if (!ujian.value) return;
  if (!window.confirm(`Hapus ujian "${ujian.value.judul}" beserta soal, PDF, dan daftar pesertanya? Ini tidak bisa dibatalkan.`)) return;
  try {
    await api('DELETE', `/api/ujian/${id.value}`);
    await router.replace('/guru');
  } catch (e) {
    galat.value = pesanGalat(e);
  }
}

watch(
  id,
  async () => {
    ujian.value = null;
    galat.value = '';
    tab.value = 'info';
    await muat();
  },
  { immediate: true },
);
</script>

<template>
  <div class="min-h-screen bg-base-200">
    <KepalaGuru />
    <main class="max-w-6xl mx-auto p-4 flex flex-col gap-4">
      <div v-if="galat" role="alert" class="alert alert-error">
        <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
        <div>
          <p>{{ galat }}</p>
          <ul v-if="masalahServer.length" class="list-disc ml-5 text-sm">
            <li v-for="m in masalahServer" :key="m">{{ m }}</li>
          </ul>
        </div>
      </div>

      <div v-if="!ujian && !galat" class="flex items-center gap-2"><span class="loading loading-spinner"></span> Memuat…</div>

      <template v-if="ujian">
        <section class="card bg-base-100 shadow">
          <div class="card-body gap-3">
            <div class="flex flex-wrap items-center gap-3">
              <h1 class="text-2xl font-bold flex-1 min-w-0 break-words">{{ ujian.judul }}</h1>
              <span class="badge badge-lg" :class="WARNA_STATUS_UJIAN[ujian.status]">{{ LABEL_STATUS_UJIAN[ujian.status] }}</span>
            </div>
            <p class="text-sm text-base-content/70">
              Kode ujian untuk siswa:
              <span class="font-mono text-lg font-bold tracking-widest text-base-content">{{ ujian.kode }}</span>
              · {{ ujian.durasi_menit }} menit · {{ ujian.soal.length }} soal · {{ ujian.jumlah_peserta }} peserta
            </p>

            <!-- Daftar periksa & aksi status -->
            <div v-if="draf">
              <div v-if="masalah.length" class="alert alert-warning items-start">
                <i class="fa-solid fa-list-check mt-1" aria-hidden="true"></i>
                <div>
                  <p class="font-semibold">Lengkapi dulu sebelum ujian dibuka:</p>
                  <ul class="list-disc ml-5 text-sm">
                    <li v-for="m in masalah" :key="m">{{ m }}</li>
                  </ul>
                </div>
              </div>
              <div v-else class="alert alert-success">
                <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
                <span>Ujian lengkap. Setelah dibuka, siswa bisa masuk ke ruang tunggu, sedangkan soal & rubrik terkunci.</span>
              </div>
            </div>
            <div v-else-if="ujian.status === 'menunggu'" class="alert alert-info">
              <i class="fa-solid fa-door-open" aria-hidden="true"></i>
              <span>Ujian dibuka: siswa bisa masuk ke ruang tunggu dengan kode di atas. Soal & rubrik terkunci.
                Tekan <strong>Mulai</strong> saat semua siap; soal langsung muncul di semua laptop siswa.
                Untuk mengubah soal, kembalikan ke draf.</span>
            </div>
            <div v-else-if="berjalan" class="flex flex-wrap items-center gap-3">
              <div
                class="font-mono text-3xl font-bold tabular-nums"
                :class="{ 'text-warning': ujian.status === 'dijeda', 'text-error': sisaGlobal !== null && sisaGlobal <= 0 }"
                role="timer"
              >
                <i class="fa-solid" :class="ujian.status === 'dijeda' ? 'fa-pause' : 'fa-clock'" aria-hidden="true"></i>
                {{ sisaGlobal === null ? '–' : formatSisa(sisaGlobal) }}
              </div>
              <p class="text-sm text-base-content/70 flex-1 min-w-60">
                <template v-if="ujian.status === 'dijeda'">Waktu semua siswa berhenti. Soal tetap terlihat, kotak jawaban terkunci.</template>
                <template v-else-if="sisaGlobal !== null && sisaGlobal <= 0">
                  Waktu habis: jawaban siswa dikumpulkan otomatis. Tekan <strong>Akhiri</strong> bila sudah selesai.
                </template>
                <template v-else>Sisa waktu global. Siswa yang belum mengumpulkan dikumpulkan otomatis saat waktu habis.</template>
              </p>
            </div>
            <div v-if="konfirmasiAkhiri" role="alert" class="alert alert-warning">
              <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
              <span>Akhiri ujian sekarang? Semua siswa yang masih mengerjakan langsung dikumpulkan dan tidak bisa
                mengetik lagi.</span>
              <div class="flex gap-2">
                <button class="btn btn-sm" type="button" @click="konfirmasiAkhiri = false">Batal</button>
                <button class="btn btn-sm btn-error" type="button" :disabled="sibuk" @click="jalankan('akhiri')">Ya, akhiri</button>
              </div>
            </div>

            <div class="flex flex-wrap gap-2 justify-end">
              <RouterLink v-if="!draf" :to="`/guru/ujian/${ujian.id}/pantau`" class="btn btn-primary btn-outline">
                <i class="fa-solid fa-chart-column" aria-hidden="true"></i> Dasbor pemantauan
              </RouterLink>
              <button class="btn btn-ghost" type="button" @click="dialogDuplikasi = true">
                <i class="fa-solid fa-copy" aria-hidden="true"></i> Duplikasi
              </button>
              <button v-if="draf" class="btn btn-ghost text-error" type="button" @click="hapus">
                <i class="fa-solid fa-trash" aria-hidden="true"></i> Hapus ujian
              </button>
              <button v-if="ujian.status === 'menunggu'" class="btn" type="button" :disabled="sibuk" @click="jalankan('kembali-draf')">
                <i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Kembali ke draf
              </button>
              <button v-if="draf" class="btn btn-primary" type="button" :disabled="sibuk || masalah.length > 0" @click="jalankan('buka')">
                <span v-if="sibuk" class="loading loading-spinner"></span>
                <i v-else class="fa-solid fa-door-open" aria-hidden="true"></i> Buka ujian
              </button>
              <button v-if="ujian.status === 'menunggu'" class="btn btn-success" type="button" :disabled="sibuk" @click="jalankan('mulai')">
                <i class="fa-solid fa-play" aria-hidden="true"></i> Mulai ujian
              </button>
              <button v-if="ujian.status === 'berlangsung'" class="btn btn-warning" type="button" :disabled="sibuk" @click="jalankan('jeda')">
                <i class="fa-solid fa-pause" aria-hidden="true"></i> Jeda
              </button>
              <button v-if="ujian.status === 'dijeda'" class="btn btn-success" type="button" :disabled="sibuk" @click="jalankan('lanjutkan')">
                <i class="fa-solid fa-play" aria-hidden="true"></i> Lanjutkan
              </button>
              <button v-if="berjalan && !konfirmasiAkhiri" class="btn btn-error btn-outline" type="button" :disabled="sibuk" @click="konfirmasiAkhiri = true">
                <i class="fa-solid fa-flag-checkered" aria-hidden="true"></i> Akhiri ujian
              </button>
            </div>
          </div>
        </section>

        <div role="tablist" class="tabs tabs-box bg-base-100 shadow">
          <button
            v-for="t in TAB"
            :key="t.id"
            role="tab"
            type="button"
            class="tab gap-2"
            :class="{ 'tab-active': tab === t.id }"
            :aria-selected="tab === t.id"
            :aria-label="t.label"
            @click="tab = t.id"
          >
            <i class="fa-solid" :class="t.ikon" aria-hidden="true"></i>
            <span class="hidden sm:inline">{{ t.label }}</span>
          </button>
        </div>

        <InfoUjian v-if="tab === 'info'" :ujian="ujian" @perbarui="perbarui" />
        <DaftarSoal v-else-if="tab === 'soal'" :ujian="ujian" @muat-ulang="muat" />
        <BukuPdf v-else-if="tab === 'pdf'" :ujian="ujian" @muat-ulang="muat" />
        <DaftarPeserta v-else-if="tab === 'peserta'" :ujian="ujian" @muat-ulang="muat" />
        <PratinjauUjian v-else :ujian="ujian" />
        <DialogDuplikasi v-if="dialogDuplikasi" :ujian="ujian" @tutup="dialogDuplikasi = false" />
      </template>
    </main>
  </div>
</template>
