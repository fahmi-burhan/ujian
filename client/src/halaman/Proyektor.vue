<!--
  client/src/halaman/Proyektor.vue — layar proyektor (alamat "/p"), hanya-baca, untuk ditampilkan ke kelas.
  Cara pakai: guru menekan "Buka layar proyektor" di dasbor → jendela baru /p?kode=XXXXXXXX, atau guru mengetik
  kode 8 karakter di PC kelas. Kode langsung dihapus dari alamat setelah ditukar menjadi sesi proyektor, sehingga
  tidak terlihat bila layar ini terproyeksi.
  Isi mengikuti status: ruang tunggu (kode ujian besar + siapa yang sudah hadir) → berlangsung (sisa waktu, kode ujian
  untuk siswa yang terlambat, progres, aktivitas di luar halaman) → selesai (rekap).
  Selama ujian semuanya muat satu layar tanpa gulir: maks. 30 kartu per halaman, siswa yang punya catatan aktivitas di
  atas, dan halaman berganti sendiri tiap 10 dtk bila lebih dari 30 (client/src/proyektor.ts). Aktivitas baru
  dibunyikan bila guru menekan "Aktifkan suara" (client/src/bunyi.ts; browser mewajibkan klik dulu).
  Dipanggil oleh: client/src/router.ts. Memanggil: POST /api/proyektor/masuk, SSE /api/proyektor/stream.
  Data yang diterima sudah disaring server (docs/DESAIN.md §8.1): tanpa teks soal, isi jawaban, upaya tempel, atau
  aktivitas yang ditandai "wajar". Kata-kata netral (aturan keras #3): "keluar halaman 2× · 15 dtk", bukan vonis.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { StatusUjian } from '../../../shared/auth.ts';
import { PANJANG_KODE_PROYEKTOR, rapikanKode } from '../../../shared/alfabet.ts';
import { JENIS_KEPERGIAN, LABEL_EVENT, ProyektorDataSchema } from '../../../shared/pantau.ts';
import type { ProyektorData } from '../../../shared/pantau.ts';
import { formatSisa } from '../../../shared/time.ts';
import { api, GalatApi, pesanGalat } from '../api.ts';
import { aktifkanSuara, bunyikan, matikanSuara, suaraAktif } from '../bunyi.ts';
import KodeQr from '../komponen/KodeQr.vue';
import MerekUjian from '../komponen/MerekUjian.vue';
import { durasiSingkat, jamWib } from '../label.ts';
import { cekAktivitasBaru, JEDA_GANTI_HALAMAN_MS, susunHalaman } from '../proyektor.ts';

const route = useRoute();
const router = useRouter();
const data = ref<ProyektorData | null>(null);
const kode = ref('');
const galat = ref('');
const memuat = ref(true);
const terputus = ref(false);
const alamatSiswa = window.location.origin;
// QR: halaman masuk siswa dengan kode ujian sudah terisi (MasukPeserta.vue membaca ?kode=).
const alamatQr = computed(() => (data.value?.kode ? `${alamatSiswa}/?kode=${encodeURIComponent(data.value.kode)}` : null));

const LABEL_STATUS: Record<StatusUjian, string> = {
  draf: 'Belum dibuka',
  menunggu: 'Menunggu dimulai',
  berlangsung: 'Sedang berlangsung',
  dijeda: 'DIJEDA',
  selesai: 'Selesai',
  penilaian: 'Selesai',
  dirilis: 'Selesai',
};

// ---- Waktu: dihitung mundur dengan jam monoton sejak data diterima ----
const tData = ref(performance.now());
const kini = ref(performance.now());
const detik = setInterval(() => {
  kini.value = performance.now();
}, 500);
const sisa = computed(() => {
  const w = data.value?.waktu;
  if (!w) return null;
  return w.dijeda || data.value?.status !== 'berlangsung' ? w.sisa_ms : w.sisa_ms - (kini.value - tData.value);
});
const berjalan = computed(() => data.value?.status === 'berlangsung' || data.value?.status === 'dijeda');
const selesai = computed(() => ['selesai', 'penilaian', 'dirilis'].includes(data.value?.status ?? ''));
const hadirNama = computed(() => (data.value?.peserta ?? []).filter((p) => p.status !== 'belum_masuk').map((p) => p.label));

// ---- Halaman kartu (maks. 30 per layar) ----
const halaman = computed(() => susunHalaman(data.value?.peserta ?? []));
const halamanKe = ref(0);
const kartu = computed(() => halaman.value[Math.min(halamanKe.value, halaman.value.length - 1)] ?? []);
const gantiHalaman = setInterval(() => {
  halamanKe.value = halaman.value.length > 1 ? (halamanKe.value + 1) % halaman.value.length : 0;
}, JEDA_GANTI_HALAMAN_MS);
// Siswa bertanda baru muncul di halaman pertama: langsung tampilkan halaman itu.
const jumlahBertanda = computed(() => (data.value?.peserta ?? []).filter((p) => Object.keys(p.aktivitas).length > 0).length);
watch(jumlahBertanda, (n, sebelum) => {
  if (n > sebelum) halamanKe.value = 0;
});

// ---- Bunyi saat ada aktivitas baru ----
let aktivitasTerakhir: number | null = null;
async function alihSuara(): Promise<void> {
  if (suaraAktif.value) matikanSuara();
  else await aktifkanSuara();
}

// Label pendek untuk kartu yang sempit (teks tetap netral, aturan keras #3); daftar "Aktivitas terbaru" memakai label lengkap.
const LABEL_KARTU: Record<(typeof JENIS_KEPERGIAN)[number], string> = {
  tab_tersembunyi: 'Pindah tab',
  fokus_hilang: 'Jendela tidak aktif',
  keluar_layar_penuh: 'Keluar layar penuh',
};

function aktivitas(p: ProyektorData['peserta'][number]): string[] {
  return JENIS_KEPERGIAN.filter((j) => p.aktivitas[j]).map((j) => {
    const r = p.aktivitas[j] as { kali: number; total_ms: number };
    return `${LABEL_KARTU[j]} ${r.kali}× · ${durasiSingkat(r.total_ms)}`;
  });
}

// ---- Aliran ----
let aliran: EventSource | null = null;
let pewaktuSambung: ReturnType<typeof setTimeout> | undefined;

function tutupAliran(): void {
  clearTimeout(pewaktuSambung);
  aliran?.close();
  aliran = null;
}

function bukaAliran(): void {
  tutupAliran();
  const es = new EventSource('/api/proyektor/stream');
  aliran = es;
  es.addEventListener('proyektor', (ev) => {
    try {
      const hasil = ProyektorDataSchema.safeParse(JSON.parse((ev as MessageEvent<string>).data));
      if (!hasil.success) return;
      data.value = hasil.data;
      tData.value = performance.now();
      const cek = cekAktivitasBaru(hasil.data.terbaru, aktivitasTerakhir);
      aktivitasTerakhir = cek.terakhir;
      if (cek.baru && hasil.data.status === 'berlangsung') bunyikan();
      terputus.value = false;
      memuat.value = false;
    } catch {
      // Data rusak diabaikan; data berikutnya datang paling lambat 5 dtk lagi.
    }
  });
  es.addEventListener('sesi_dicabut', () => {
    tutupAliran();
    data.value = null;
    galat.value = 'Layar proyektor ditutup oleh guru. Minta kode baru di dasbor guru.';
  });
  es.onopen = () => {
    terputus.value = false;
  };
  es.onerror = () => {
    terputus.value = true;
    if (es.readyState !== EventSource.CLOSED) return;
    // Ditolak permanen: belum masuk (401) → tampilkan form kode; selain itu coba lagi 5 dtk kemudian.
    tutupAliran();
    void cekSesi();
  };
}

async function cekSesi(): Promise<void> {
  try {
    await api('GET', '/api/proyektor/saya');
    pewaktuSambung = setTimeout(bukaAliran, 5000);
  } catch (e) {
    if (e instanceof GalatApi && e.status === 401) {
      data.value = null;
      memuat.value = false;
      return;
    }
    pewaktuSambung = setTimeout(bukaAliran, 5000);
  }
}

async function tukarKode(teks: string): Promise<void> {
  galat.value = '';
  memuat.value = true;
  try {
    await api('POST', '/api/proyektor/masuk', { body: { kode: rapikanKode(teks) } });
    kode.value = '';
    bukaAliran();
  } catch (e) {
    galat.value = e instanceof GalatApi && e.kode === 'kode_salah' ? 'Kode tidak berlaku atau sudah dipakai. Minta kode baru di dasbor guru.' : pesanGalat(e);
    memuat.value = false;
  }
}

onMounted(async () => {
  const dariAlamat = route.query.kode;
  if (typeof dariAlamat === 'string' && dariAlamat.length > 0) {
    // Hapus kode dari alamat lebih dulu, baru ditukar.
    await router.replace({ path: '/p', query: {} });
    await tukarKode(dariAlamat);
    return;
  }
  bukaAliran();
});

onBeforeUnmount(() => {
  clearInterval(detik);
  clearInterval(gantiHalaman);
  tutupAliran();
});
</script>

<template>
  <!-- Satu layar penuh tanpa gulir (h-dvh + overflow-hidden): proyektor tidak disentuh selama ujian. -->
  <main class="h-dvh overflow-hidden bg-base-100 p-4 xl:p-6 flex flex-col" data-theme="light">
    <div v-if="memuat" class="flex-1 flex items-center justify-center"><span class="loading loading-spinner loading-lg"></span></div>

    <div v-else-if="data" class="flex-1 min-h-0 flex flex-col gap-4">
      <header class="flex items-center gap-3 shrink-0">
        <h1 class="text-3xl xl:text-4xl font-bold flex-1 min-w-0 truncate" :title="data.judul">{{ data.judul }}</h1>
        <span v-if="terputus" class="badge badge-ghost"><i class="fa-solid fa-wifi" aria-hidden="true"></i>&nbsp;menyambung ulang…</span>
        <button
          class="btn btn-sm"
          :class="suaraAktif ? 'btn-ghost' : 'btn-outline'"
          type="button"
          :aria-pressed="suaraAktif"
          :title="suaraAktif ? 'Matikan bunyi aktivitas' : 'Bunyikan tanda saat ada aktivitas di luar halaman ujian'"
          @click="alihSuara"
        >
          <i class="fa-solid" :class="suaraAktif ? 'fa-volume-high' : 'fa-volume-xmark'" aria-hidden="true"></i>
          {{ suaraAktif ? 'Suara aktif' : 'Aktifkan suara' }}
        </button>
        <span class="badge badge-lg text-xl p-5" :class="data.status === 'dijeda' ? 'badge-warning' : data.status === 'berlangsung' ? 'badge-success' : 'badge-neutral'">
          {{ LABEL_STATUS[data.status] }}
        </span>
      </header>

      <!-- Ruang tunggu -->
      <section v-if="data.status === 'menunggu'" class="flex-1 min-h-0 overflow-hidden flex flex-col items-center justify-center gap-6 text-center">
        <div class="flex items-center justify-center gap-10">
          <KodeQr v-if="alamatQr" :teks="alamatQr" label="QR code halaman masuk ujian" class="size-48 xl:size-64 shrink-0 rounded-box" />
          <div class="flex flex-col gap-3">
            <p class="text-2xl xl:text-3xl">Pindai QR, atau buka <span class="font-mono font-bold">{{ alamatSiswa }}</span> lalu masukkan kode:</p>
            <p class="font-mono font-bold tracking-[0.3em] text-7xl xl:text-9xl">{{ data.kode }}</p>
          </div>
        </div>
        <p class="text-3xl"><strong>{{ data.hadir }}</strong> dari {{ data.total }} siswa sudah masuk</p>
        <div class="flex flex-wrap justify-center gap-2 max-w-6xl">
          <span v-for="(n, i) in hadirNama" :key="i" class="badge badge-lg badge-outline text-lg p-4">{{ n }}</span>
        </div>
      </section>

      <!-- Berlangsung / dijeda -->
      <section v-else-if="berjalan" class="flex-1 min-h-0 grid gap-4 grid-cols-[1fr_14rem] xl:grid-cols-[1fr_18rem] 2xl:grid-cols-[1fr_21rem]">
        <div class="min-h-0 flex flex-col gap-3">
          <div class="flex items-center gap-6 shrink-0">
            <div
              class="font-mono font-bold tabular-nums text-6xl xl:text-7xl"
              :class="{ 'text-warning': data.status === 'dijeda', 'text-error': sisa !== null && sisa <= 5 * 60_000 && data.status === 'berlangsung' }"
              role="timer"
            >
              {{ sisa === null ? '–' : formatSisa(sisa) }}
            </div>
            <div class="text-xl xl:text-2xl min-w-0">
              <span class="badge badge-success badge-lg h-auto gap-2 px-4 py-1 text-xl xl:text-2xl font-semibold tabular-nums whitespace-nowrap">
                <i class="fa-solid fa-circle-check" aria-hidden="true"></i> {{ data.terkumpul }} / {{ data.hadir }} mengumpulkan
              </span>
              <p v-if="data.status === 'dijeda'" class="text-warning font-bold">Ujian dijeda pengawas</p>
            </div>
            <div v-if="data.kode" class="ml-auto flex items-center gap-3 shrink-0">
              <div class="text-right">
                <p class="text-sm xl:text-base text-base-content/70">Kode ujian | {{ alamatSiswa }}</p>
                <p class="font-mono font-bold tracking-[0.25em] text-4xl xl:text-5xl">{{ data.kode }}</p>
              </div>
              <KodeQr v-if="alamatQr" :teks="alamatQr" label="QR code halaman masuk ujian" class="size-20 xl:size-24 rounded" />
            </div>
          </div>

          <!-- 30 kartu per halaman: 5×6 di layar sedang, 6×5 di layar lebar. -->
          <div class="flex-1 min-h-0 grid gap-2 grid-cols-5 grid-rows-6 xl:grid-cols-6 xl:grid-rows-5">
            <div
              v-for="(p, i) in kartu"
              :key="`${halamanKe}-${i}`"
              class="rounded-box p-2 flex flex-col gap-1 min-h-0 overflow-hidden border-2"
              :class="[
                Object.keys(p.aktivitas).length > 0 ? 'border-warning bg-warning/15' : 'border-transparent bg-base-200',
                { 'opacity-60': p.status === 'dikumpulkan' },
              ]"
            >
              <div class="flex items-baseline gap-2 shrink-0">
                <p class="font-semibold truncate leading-tight flex-1 min-w-0 text-[clamp(0.85rem,2.2vh,1.4rem)]" :title="p.label">
                  <i v-if="p.status === 'dikumpulkan'" class="fa-solid fa-circle-check text-success" aria-hidden="true"></i>
                  {{ p.label }}
                </p>
                <span class="tabular-nums shrink-0 text-[clamp(0.7rem,1.7vh,1.05rem)]">{{ p.terjawab }}/{{ p.jumlah_soal }}</span>
              </div>
              <progress class="progress progress-primary h-1.5 shrink-0" :value="p.terjawab" :max="Math.max(1, p.jumlah_soal)"></progress>
              <div class="flex-1 min-h-0 overflow-hidden flex flex-col gap-0.5">
                <p v-for="a in aktivitas(p)" :key="a" class="leading-tight text-[clamp(0.7rem,1.7vh,1.05rem)]">{{ a }}</p>
              </div>
            </div>
          </div>
          <p v-if="halaman.length > 1" class="shrink-0 text-center text-base-content/70">
            Halaman {{ Math.min(halamanKe, halaman.length - 1) + 1 }} dari {{ halaman.length }} | berganti sendiri
          </p>
        </div>

        <aside class="card bg-base-200 min-h-0 overflow-hidden">
          <div class="card-body p-4 gap-2 min-h-0">
            <h2 class="font-bold text-xl">Aktivitas terbaru</h2>
            <p v-if="data.terbaru.length === 0" class="text-base-content/60">Belum ada.</p>
            <ul v-else class="flex flex-col gap-1 overflow-hidden">
              <li v-for="(e, i) in data.terbaru" :key="i" class="text-base xl:text-lg leading-snug">
                <span class="font-mono text-sm xl:text-base">{{ jamWib(e.mulai_at) }}</span>
                {{ e.label }} | {{ LABEL_EVENT[e.jenis] }}
                <span class="text-base-content/60">| {{ e.durasi_ms === null ? 'sedang' : durasiSingkat(e.durasi_ms) }}</span>
              </li>
            </ul>
          </div>
        </aside>
      </section>

      <!-- Selesai -->
      <section v-else-if="selesai" class="flex-1 flex flex-col items-center justify-center gap-4 text-center">
        <i class="fa-solid fa-flag-checkered text-7xl" aria-hidden="true"></i>
        <p class="text-5xl font-bold">Ujian selesai</p>
        <p class="text-3xl">{{ data.terkumpul }} dari {{ data.hadir }} siswa mengumpulkan jawaban. Terima kasih!</p>
      </section>

      <section v-else class="flex-1 flex items-center justify-center">
        <p class="text-4xl">Ujian belum dibuka.</p>
      </section>
    </div>

    <div v-else class="flex-1 overflow-auto flex items-center justify-center">
      <form class="card bg-base-200 w-full max-w-md" @submit.prevent="tukarKode(kode)">
        <div class="card-body gap-3">
          <MerekUjian ukuran="besar" class="self-center mb-1" />
          <h1 class="card-title text-2xl">Layar Proyektor</h1>
          <p class="text-base-content/70">Ketik kode proyektor dari dasbor guru (berlaku 10 menit, sekali pakai).</p>
          <div v-if="galat" role="alert" class="alert alert-error">
            <span>{{ galat }}</span>
          </div>
          <input
            v-model="kode"
            class="input input-bordered input-lg font-mono tracking-[0.3em] uppercase text-center"
            :maxlength="PANJANG_KODE_PROYEKTOR + 2"
            autocomplete="off"
            spellcheck="false"
            aria-label="Kode proyektor"
            autofocus
          />
          <button class="btn btn-primary" type="submit" :disabled="rapikanKode(kode).length !== PANJANG_KODE_PROYEKTOR">
            Tampilkan
          </button>
        </div>
      </form>
    </div>
  </main>
</template>
