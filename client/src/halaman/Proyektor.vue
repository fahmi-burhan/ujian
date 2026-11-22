<!--
  client/src/halaman/Proyektor.vue — layar proyektor (alamat "/p"), hanya-baca, untuk ditampilkan ke kelas.
  Cara pakai: guru menekan "Buka layar proyektor" di dasbor → jendela baru /p?kode=XXXXXXXX, atau guru mengetik
  kode 8 karakter di PC kelas. Kode langsung dihapus dari alamat setelah ditukar menjadi sesi proyektor, sehingga
  tidak terlihat bila layar ini terproyeksi.
  Isi mengikuti status: ruang tunggu (kode ujian besar + siapa yang sudah hadir) → berlangsung (sisa waktu, progres,
  aktivitas di luar halaman) → selesai (rekap).
  Dipanggil oleh: client/src/router.ts. Memanggil: POST /api/proyektor/masuk, SSE /api/proyektor/stream.
  Data yang diterima sudah disaring server (docs/DESAIN.md §8.1): tanpa teks soal, isi jawaban, upaya tempel, atau
  aktivitas yang ditandai "wajar". Kata-kata netral (aturan keras #3): "keluar halaman 2× · 15 dtk", bukan vonis.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { StatusUjian } from '../../../shared/auth.ts';
import { PANJANG_KODE_PROYEKTOR, rapikanKode } from '../../../shared/alfabet.ts';
import { JENIS_KEPERGIAN, LABEL_EVENT, ProyektorDataSchema } from '../../../shared/pantau.ts';
import type { ProyektorData } from '../../../shared/pantau.ts';
import { formatSisa } from '../../../shared/time.ts';
import { api, GalatApi, pesanGalat } from '../api.ts';
import LogoUjian from '../komponen/LogoUjian.vue';
import { durasiSingkat, jamWib } from '../label.ts';

const route = useRoute();
const router = useRouter();
const data = ref<ProyektorData | null>(null);
const kode = ref('');
const galat = ref('');
const memuat = ref(true);
const terputus = ref(false);
const alamatSiswa = window.location.origin;

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

function aktivitas(p: ProyektorData['peserta'][number]): string[] {
  return JENIS_KEPERGIAN.filter((j) => p.aktivitas[j]).map((j) => {
    const r = p.aktivitas[j] as { kali: number; total_ms: number };
    return `${LABEL_EVENT[j]} ${r.kali}× · ${durasiSingkat(r.total_ms)}`;
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
  tutupAliran();
});
</script>

<template>
  <main class="min-h-screen bg-base-100 p-6 md:p-10" data-theme="light">
    <div v-if="memuat" class="min-h-[80vh] flex items-center justify-center"><span class="loading loading-spinner loading-lg"></span></div>

    <div v-else-if="data" class="flex flex-col gap-6">
      <header class="flex flex-wrap items-center gap-4">
        <h1 class="text-4xl md:text-5xl font-bold flex-1 min-w-0 break-words">{{ data.judul }}</h1>
        <span class="badge badge-lg text-xl p-5" :class="data.status === 'dijeda' ? 'badge-warning' : data.status === 'berlangsung' ? 'badge-success' : 'badge-neutral'">
          {{ LABEL_STATUS[data.status] }}
        </span>
        <span v-if="terputus" class="badge badge-ghost"><i class="fa-solid fa-wifi" aria-hidden="true"></i>&nbsp;menyambung ulang…</span>
      </header>

      <!-- Ruang tunggu -->
      <section v-if="data.status === 'menunggu'" class="flex flex-col items-center gap-6 text-center">
        <p class="text-2xl md:text-3xl">Buka <span class="font-mono font-bold">{{ alamatSiswa }}</span> lalu masukkan kode:</p>
        <p class="font-mono font-bold tracking-[0.3em] text-7xl md:text-9xl">{{ data.kode }}</p>
        <p class="text-3xl"><strong>{{ data.hadir }}</strong> dari {{ data.total }} siswa sudah masuk</p>
        <div class="flex flex-wrap justify-center gap-2 max-w-5xl">
          <span v-for="(n, i) in hadirNama" :key="i" class="badge badge-lg badge-outline text-lg p-4">{{ n }}</span>
        </div>
      </section>

      <!-- Berlangsung / dijeda -->
      <section v-else-if="berjalan" class="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div class="flex flex-col gap-6">
          <div class="flex flex-wrap items-center gap-8">
            <div
              class="font-mono font-bold tabular-nums text-7xl md:text-8xl"
              :class="{ 'text-warning': data.status === 'dijeda', 'text-error': sisa !== null && sisa <= 5 * 60_000 && data.status === 'berlangsung' }"
              role="timer"
            >
              {{ sisa === null ? '–' : formatSisa(sisa) }}
            </div>
            <div class="text-2xl">
              <p><strong>{{ data.terkumpul }}</strong> dari {{ data.hadir }} sudah mengumpulkan</p>
              <p v-if="data.status === 'dijeda'" class="text-warning font-bold">Ujian dijeda pengawas</p>
            </div>
          </div>
          <div class="grid gap-3 grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]">
            <div
              v-for="(p, i) in data.peserta.filter((x) => x.status !== 'belum_masuk')"
              :key="i"
              class="card bg-base-200"
              :class="{ 'opacity-60': p.status === 'dikumpulkan' }"
            >
              <div class="card-body p-3 gap-1">
                <p class="font-semibold text-lg truncate">
                  <i v-if="p.status === 'dikumpulkan'" class="fa-solid fa-circle-check text-success" aria-hidden="true"></i>
                  {{ p.label }}
                </p>
                <progress class="progress progress-primary" :value="p.terjawab" :max="Math.max(1, p.jumlah_soal)"></progress>
                <p class="text-sm">{{ p.terjawab }}/{{ p.jumlah_soal }} soal terjawab</p>
                <p v-for="a in aktivitas(p)" :key="a" class="text-sm text-warning-content bg-warning/30 rounded px-1">{{ a }}</p>
              </div>
            </div>
          </div>
        </div>
        <aside class="card bg-base-200 h-fit">
          <div class="card-body p-4 gap-2">
            <h2 class="font-bold text-xl">Aktivitas terbaru</h2>
            <p v-if="data.terbaru.length === 0" class="text-base-content/60">Belum ada.</p>
            <ul v-else class="flex flex-col gap-1">
              <li v-for="(e, i) in data.terbaru" :key="i" class="text-lg">
                <span class="font-mono text-base">{{ jamWib(e.mulai_at) }}</span>
                {{ e.label }} · {{ LABEL_EVENT[e.jenis] }}
                <span class="text-base-content/60">· {{ e.durasi_ms === null ? 'sedang' : durasiSingkat(e.durasi_ms) }}</span>
              </li>
            </ul>
          </div>
        </aside>
      </section>

      <!-- Selesai -->
      <section v-else-if="selesai" class="flex flex-col items-center gap-4 text-center mt-16">
        <i class="fa-solid fa-flag-checkered text-7xl" aria-hidden="true"></i>
        <p class="text-5xl font-bold">Ujian selesai</p>
        <p class="text-3xl">{{ data.terkumpul }} dari {{ data.hadir }} siswa mengumpulkan jawaban. Terima kasih!</p>
      </section>

      <section v-else class="flex items-center justify-center mt-16">
        <p class="text-4xl">Ujian belum dibuka.</p>
      </section>
    </div>

    <div v-else class="min-h-[80vh] flex items-center justify-center">
      <form class="card bg-base-200 w-full max-w-md" @submit.prevent="tukarKode(kode)">
        <div class="card-body gap-3">
          <h1 class="card-title text-2xl">
            <LogoUjian class="w-10 h-10 text-primary" />
            Layar Proyektor
          </h1>
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
