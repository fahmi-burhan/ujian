<!--
  client/src/halaman/PantauUjian.vue — dasbor pemantauan guru (alamat "/guru/ujian/:id/pantau"): status & sisa waktu,
  tombol jalannya ujian (Mulai/Jeda/Lanjutkan/Akhiri/Perpanjang semua), tabel siswa (koneksi, progres, sisa waktu,
  aktivitas di luar halaman) dengan aksi per siswa, daftar aktivitas terbaru (tandai "wajar"), log aksi, dan tombol
  layar proyektor.
  Dipanggil oleh: client/src/router.ts (hanya setelah lolos penjaga sesi guru).
  Memanggil: SSE /api/ujian/:id/pantau/stream (potret `pantau`), POST /api/ujian/:id/{mulai,jeda,lanjutkan,akhiri,
             perpanjang,tautan-proyektor,proyektor/cabut,peserta/buka-kunci-semua}, POST .../peserta/:pid/{reset-pin,
             buka-kunci,buka-kembali}, PATCH .../event/:eventId; komponen DialogJawaban & DialogIsian (pengganti
             prompt/confirm bawaan browser).
  Kata-kata di halaman ini netral (aturan keras #3): aktivitas adalah CATATAN, bukan vonis. Batas deteksi ditulis jujur
  (aturan keras #4).
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { TautanProyektorSchema } from '../../../shared/auth.ts';
import { BukaKunciSemuaHasilSchema, JENIS_EVENT, LABEL_EVENT, PantauSchema } from '../../../shared/pantau.ts';
import type { EventGuru, JenisEvent, Pantau, PesertaPantau } from '../../../shared/pantau.ts';
import { formatSisa } from '../../../shared/time.ts';
import { api, GalatApi, pesanGalat } from '../api.ts';
import DialogIsian from '../komponen/DialogIsian.vue';
import type { PermintaanDialog } from '../komponen/DialogIsian.vue';
import DialogJawaban from '../komponen/guru/DialogJawaban.vue';
import KepalaGuru from '../komponen/guru/KepalaGuru.vue';
import { durasiSingkat, jamWib, LABEL_AKSI, LABEL_STATUS_PESERTA, LABEL_STATUS_UJIAN, WARNA_STATUS_UJIAN } from '../label.ts';

const route = useRoute();
const router = useRouter();
const id = computed(() => Number(route.params.id));
const data = ref<Pantau | null>(null);
const galat = ref('');
const info = ref('');
const sibuk = ref(false);
const terputus = ref(false);
const konfirmasiAkhiri = ref(false);
const konfirmasiBukaKunci = ref(false);
const menitSemua = ref(5);
const dilihat = ref<PesertaPantau | null>(null);
const tampilLog = ref(false);
const saringJenis = ref<JenisEvent | ''>('');

// ---- Waktu: potret membawa sisa_ms; dihitung mundur dengan jam monoton sejak potret diterima ----
const tPotret = ref(performance.now());
const kini = ref(performance.now());
const detik = setInterval(() => {
  kini.value = performance.now();
}, 500);
const berjalan = computed(() => data.value?.ujian.status === 'berlangsung');
function sisaKini(sisa: number | null): number | null {
  if (sisa === null) return null;
  return berjalan.value ? sisa - (kini.value - tPotret.value) : sisa;
}
const sisaGlobal = computed(() => sisaKini(data.value?.ujian.waktu?.sisa_ms ?? null));

const namaPeserta = computed(() => new Map((data.value?.peserta ?? []).map((p) => [p.id, p.nama])));
const ringkas = computed(() => {
  const p = data.value?.peserta ?? [];
  return {
    total: p.length,
    hadir: p.filter((x) => x.status !== 'belum_masuk').length,
    mengerjakan: p.filter((x) => x.status === 'mengerjakan').length,
    terkumpul: p.filter((x) => x.status === 'dikumpulkan').length,
    tersambung: p.filter((x) => x.tersambung).length,
    terkunci: p.filter((x) => x.terkunci).length,
  };
});

// "Server sempat mati X menit, ujian dijeda otomatis" (docs/DESAIN.md §3): tampil selama jeda otomatis itu belum
// dilanjutkan guru.
const jedaOtomatis = computed(() => {
  const d = data.value;
  if (!d || d.ujian.status !== 'dijeda') return null;
  const terakhir = d.log.find((l) => l.aksi === 'jeda' || l.aksi === 'lanjutkan' || l.aksi === 'jeda_otomatis');
  if (terakhir?.aksi !== 'jeda_otomatis') return null;
  const mati = typeof terakhir.detail.mati_ms === 'number' ? terakhir.detail.mati_ms : 0;
  return { mati, pada: terakhir.dibuat_at };
});

const eventTampil = computed(() => {
  const semua = data.value?.event ?? [];
  return saringJenis.value ? semua.filter((e) => e.jenis === saringJenis.value) : semua;
});

const LABEL_CARA: Record<string, string> = {
  manual: 'dikumpulkan sendiri',
  waktu_habis: 'waktu habis',
  diakhiri_penguji: 'diakhiri guru',
};

function ringkasAktivitas(p: PesertaPantau): { jenis: JenisEvent; teks: string }[] {
  return JENIS_EVENT.filter((j) => p.aktivitas[j]).map((j) => {
    const r = p.aktivitas[j] as { kali: number; total_ms: number };
    const lama = r.total_ms > 0 ? ` · ${durasiSingkat(r.total_ms)}` : '';
    return { jenis: j, teks: `${LABEL_EVENT[j]} ${r.kali}×${lama}` };
  });
}

function teksDetail(e: EventGuru): string {
  if (e.jenis === 'tempel_dari_luar' && typeof e.detail.panjang === 'number') {
    return `${e.detail.panjang.toLocaleString('id-ID')} karakter (diblokir)`;
  }
  if (e.jenis === 'masuk_ulang' && typeof e.detail.perangkat === 'string') return e.detail.perangkat;
  const sinyal = Array.isArray(e.detail.sinyal) ? (e.detail.sinyal as JenisEvent[]) : [];
  return sinyal.length > 1 ? `sinyal: ${sinyal.map((s) => LABEL_EVENT[s] ?? s).join(', ')}` : '';
}

function lamaEvent(e: EventGuru): string {
  if (e.durasi_ms !== null) return durasiSingkat(e.durasi_ms);
  if (e.selesai_at !== null) return durasiSingkat(e.selesai_at - e.mulai_at);
  if (e.jenis === 'tempel_dari_luar' || e.jenis === 'masuk_ulang' || e.jenis === 'akses_sebelum_mulai') return '';
  return 'masih berlangsung';
}

// ---- Aliran SSE ----
let aliran: EventSource | null = null;
function bukaAliran(): void {
  aliran?.close();
  const es = new EventSource(`/api/ujian/${id.value}/pantau/stream`);
  aliran = es;
  es.addEventListener('pantau', (ev) => {
    try {
      const hasil = PantauSchema.safeParse(JSON.parse((ev as MessageEvent<string>).data));
      if (!hasil.success) return;
      data.value = hasil.data;
      tPotret.value = performance.now();
      terputus.value = false;
    } catch {
      // Potret rusak diabaikan; potret berikutnya datang paling lambat 5 dtk lagi.
    }
  });
  es.addEventListener('sesi_dicabut', () => {
    es.close();
    void router.replace({ path: '/guru/masuk', query: { lanjut: route.fullPath } });
  });
  es.onopen = () => {
    terputus.value = false;
  };
  es.onerror = () => {
    terputus.value = true;
    if (es.readyState === EventSource.CLOSED) {
      // Ditolak (mis. sesi guru habis / ujian tidak ditemukan): cek lewat GET biasa.
      void cekLaluSambung();
    }
  };
}

let pewaktuSambung: ReturnType<typeof setTimeout> | undefined;
async function cekLaluSambung(): Promise<void> {
  try {
    data.value = await api('GET', `/api/ujian/${id.value}/pantau`, { skema: PantauSchema });
    tPotret.value = performance.now();
  } catch (e) {
    if (e instanceof GalatApi && e.status === 401) {
      await router.replace({ path: '/guru/masuk', query: { lanjut: route.fullPath } });
      return;
    }
    if (e instanceof GalatApi && e.status === 404) {
      await router.replace('/guru');
      return;
    }
  }
  pewaktuSambung = setTimeout(bukaAliran, 5000);
}

watch(
  id,
  () => {
    data.value = null;
    bukaAliran();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  clearInterval(detik);
  clearTimeout(pewaktuSambung);
  aliran?.close();
});

// ---- Aksi ----
async function jalankan(kerja: () => Promise<unknown>, pesanBerhasil = ''): Promise<void> {
  galat.value = '';
  info.value = '';
  sibuk.value = true;
  try {
    await kerja();
    info.value = pesanBerhasil;
  } catch (e) {
    galat.value = pesanGalat(e);
  } finally {
    sibuk.value = false;
  }
}

function transisi(aksi: 'mulai' | 'jeda' | 'lanjutkan' | 'akhiri'): Promise<void> {
  konfirmasiAkhiri.value = false;
  return jalankan(() => api('POST', `/api/ujian/${id.value}/${aksi}`));
}

// ---- Dialog (pengganti prompt/confirm bawaan browser; tanpa animasi) ----
const dialog = ref<{ permintaan: PermintaanDialog; selesai: (nilai: string | null) => void } | null>(null);
function tanya(permintaan: PermintaanDialog): Promise<string | null> {
  return new Promise((selesai) => {
    dialog.value = { permintaan, selesai };
  });
}
function tutupDialog(nilai: string | null): void {
  const d = dialog.value;
  dialog.value = null;
  d?.selesai(nilai);
}

// Koreksi negatif bisa membuat sisa waktu ≤ 0, sehingga siswa langsung dikumpulkan otomatis 10 dtk kemudian.
async function setujuiKoreksi(menit: number, siapa: string): Promise<boolean> {
  if (menit >= 0) return true;
  const ok = await tanya({
    jenis: 'konfirmasi',
    judul: `Kurangi waktu ${siapa} ${-menit} menit?`,
    pesan: 'Ini hanya mengurangi perpanjangan yang sudah diberikan. Bila sisa waktu menjadi 0 atau kurang, jawaban langsung dikumpulkan otomatis.',
    labelOk: 'Ya, kurangi',
    bahaya: true,
  });
  return ok !== null;
}

async function perpanjangSemua(): Promise<void> {
  const menit = menitSemua.value;
  if (!(await setujuiKoreksi(menit, 'semua siswa'))) return;
  await jalankan(
    () => api('POST', `/api/ujian/${id.value}/perpanjang`, { body: { menit } }),
    menit > 0 ? `Semua siswa mendapat tambahan ${menit} menit.` : `Waktu semua siswa dikurangi ${-menit} menit.`,
  );
}

async function perpanjangSatu(p: PesertaPantau): Promise<void> {
  const isi = await tanya({
    jenis: 'angka',
    judul: `Perpanjangan waktu untuk ${p.nama}`,
    pesan: 'Menit tambahan (−120…120). Angka negatif untuk koreksi salah ketik.',
    nilai: '5',
    min: -120,
    max: 120,
    labelOk: 'Simpan',
  });
  if (isi === null) return;
  const menit = Number(isi);
  if (!(await setujuiKoreksi(menit, p.nama))) return;
  await jalankan(
    () => api('POST', `/api/ujian/${id.value}/perpanjang`, { body: { menit, peserta_id: p.id } }),
    `${p.nama}: perpanjangan ${menit} menit.`,
  );
}

async function bukaKembali(p: PesertaPantau): Promise<void> {
  const isi = await tanya({
    jenis: 'angka',
    judul: `Buka kembali ${p.nama}`,
    pesan: 'Sisa waktunya menjadi minimal berapa menit? (1…120)',
    nilai: '5',
    min: 1,
    max: 120,
    labelOk: 'Buka kembali',
  });
  if (isi === null) return;
  await jalankan(
    () => api('POST', `/api/ujian/${id.value}/peserta/${p.id}/buka-kembali`, { body: { menit: Number(isi) } }),
    `${p.nama} bisa mengerjakan lagi.`,
  );
}

async function resetPin(p: PesertaPantau): Promise<void> {
  const ok = await tanya({
    jenis: 'konfirmasi',
    judul: `Reset PIN ${p.nama}?`,
    pesan:
      `Sesi ${p.nama} di laptopnya ditutup, lalu ia masuk lagi dan membuat PIN baru. Jawabannya tetap aman.` +
      (data.value?.ujian.status === 'penilaian' || data.value?.ujian.status === 'dirilis'
        ? `\n\nPerhatian: siapa pun yang pertama masuk dengan nama ini akan membuat PIN baru dan bisa melihat jawaban & nilai ${p.nama}. Pastikan ${p.nama} sendiri yang masuk.`
        : ''),
    labelOk: 'Reset PIN',
    bahaya: true,
  });
  if (ok === null) return;
  await jalankan(() => api('POST', `/api/ujian/${id.value}/peserta/${p.id}/reset-pin`), `PIN ${p.nama} direset.`);
}

function bukaKunci(p: PesertaPantau): Promise<void> {
  return jalankan(() => api('POST', `/api/ujian/${id.value}/peserta/${p.id}/buka-kunci`), `Kunci ${p.nama} dibuka.`);
}

function bukaKunciSemua(): Promise<void> {
  konfirmasiBukaKunci.value = false;
  return jalankan(async () => {
    const r = await api('POST', `/api/ujian/${id.value}/peserta/buka-kunci-semua`, { skema: BukaKunciSemuaHasilSchema });
    info.value = `${r.jumlah} nama dibuka kuncinya.`;
  });
}

// Tandai/batalkan "wajar" langsung satu klik; catatan ditambahkan terpisah lewat tombol "Catatan".
async function tandaiWajar(e: EventGuru): Promise<void> {
  await jalankan(() =>
    api('PATCH', `/api/ujian/${id.value}/event/${e.id}`, {
      body: { ditandai_wajar: !e.ditandai_wajar, catatan_penguji: e.catatan_penguji },
    }),
  );
}

async function ubahCatatan(e: EventGuru): Promise<void> {
  const isi = await tanya({
    jenis: 'teks',
    judul: `Catatan untuk aktivitas ${namaPeserta.value.get(e.peserta_id) ?? ''}`,
    pesan: 'Mis. "notifikasi antivirus, sudah dicek". Kosongkan untuk menghapus catatan.',
    nilai: e.catatan_penguji,
    maksPanjang: 500,
    labelOk: 'Simpan catatan',
  });
  if (isi === null) return;
  await jalankan(() =>
    api('PATCH', `/api/ujian/${id.value}/event/${e.id}`, {
      body: { ditandai_wajar: e.ditandai_wajar, catatan_penguji: isi.slice(0, 500) },
    }),
  );
}

// Kode sekali pakai → jendela baru /p?kode=… (kode langsung dihapus dari alamat oleh halaman proyektor).
// Jendela dibuka lebih dulu (masih dalam klik guru) supaya tidak diblokir pemblokir pop-up.
async function bukaProyektor(): Promise<void> {
  const jendela = window.open('about:blank', '_blank');
  await jalankan(async () => {
    const t = await api('POST', `/api/ujian/${id.value}/tautan-proyektor`, { skema: TautanProyektorSchema });
    const alamat = `/p?kode=${encodeURIComponent(t.kode)}`;
    if (jendela) {
      jendela.opener = null;
      jendela.location.href = alamat;
    } else {
      info.value = `Pop-up diblokir. Buka ${window.location.origin}/p di jendela/PC lain dan ketik kode ${t.kode} (berlaku 10 menit).`;
    }
  });
  if (galat.value && jendela) jendela.close();
}

async function cabutProyektor(): Promise<void> {
  const ok = await tanya({
    jenis: 'konfirmasi',
    judul: 'Tutup semua layar proyektor ujian ini?',
    pesan: 'Untuk membukanya lagi, buat kode baru dengan tombol "Buka layar proyektor".',
    labelOk: 'Tutup proyektor',
  });
  if (ok === null) return;
  await jalankan(() => api('POST', `/api/ujian/${id.value}/proyektor/cabut`), 'Layar proyektor ditutup.');
}
</script>

<template>
  <div class="min-h-screen bg-base-200">
    <KepalaGuru />
    <main class="max-w-7xl mx-auto p-4 flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <RouterLink :to="`/guru/ujian/${id}`" class="btn btn-sm btn-ghost">
          <i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Penyusunan ujian
        </RouterLink>
        <RouterLink
          v-if="data && (data.ujian.status === 'selesai' || data.ujian.status === 'penilaian' || data.ujian.status === 'dirilis')"
          :to="`/guru/ujian/${id}/nilai`"
          class="btn btn-sm btn-primary"
        >
          <i class="fa-solid fa-pen-ruler" aria-hidden="true"></i> Penilaian
        </RouterLink>
        <span v-if="terputus" class="badge badge-warning gap-1">
          <i class="fa-solid fa-wifi" aria-hidden="true"></i> Menyambung ulang ke server…
        </span>
      </div>

      <div v-if="galat" role="alert" class="alert alert-error">
        <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i><span>{{ galat }}</span>
      </div>
      <div v-if="info" role="status" class="alert alert-success">
        <i class="fa-solid fa-circle-check" aria-hidden="true"></i><span>{{ info }}</span>
      </div>

      <div v-if="!data" class="flex items-center gap-2"><span class="loading loading-spinner"></span> Memuat pemantauan…</div>

      <template v-else>
        <!-- Kepala: status, waktu, aksi -->
        <section class="card bg-base-100 shadow">
          <div class="card-body gap-3">
            <div class="flex flex-wrap items-center gap-3">
              <h1 class="text-2xl font-bold flex-1 min-w-0 break-words">{{ data.ujian.judul }}</h1>
              <span class="badge badge-lg" :class="WARNA_STATUS_UJIAN[data.ujian.status]">{{ LABEL_STATUS_UJIAN[data.ujian.status] }}</span>
            </div>

            <div class="flex flex-wrap items-center gap-6">
              <div
                v-if="sisaGlobal !== null"
                class="font-mono text-4xl font-bold tabular-nums"
                :class="{ 'text-warning': data.ujian.status === 'dijeda', 'text-error': sisaGlobal <= 0 }"
                role="timer"
              >
                <i class="fa-solid" :class="data.ujian.status === 'dijeda' ? 'fa-pause' : 'fa-clock'" aria-hidden="true"></i>
                {{ formatSisa(sisaGlobal) }}
              </div>
              <div v-if="['menunggu', 'berlangsung', 'dijeda'].includes(data.ujian.status)" class="text-lg">
                Kode ujian: <span class="font-mono text-3xl font-bold tracking-widest">{{ data.ujian.kode }}</span>
              </div>
              <div class="stats stats-horizontal shadow-sm bg-base-200">
                <div class="stat py-2 px-4">
                  <div class="stat-title">Hadir</div>
                  <div class="stat-value text-2xl">{{ ringkas.hadir }}/{{ ringkas.total }}</div>
                </div>
                <div class="stat py-2 px-4">
                  <div class="stat-title">Mengerjakan</div>
                  <div class="stat-value text-2xl">{{ ringkas.mengerjakan }}</div>
                </div>
                <div class="stat py-2 px-4">
                  <div class="stat-title">Terkumpul</div>
                  <div class="stat-value text-2xl">{{ ringkas.terkumpul }}</div>
                </div>
                <div class="stat py-2 px-4">
                  <div class="stat-title">Tersambung</div>
                  <div class="stat-value text-2xl">{{ ringkas.tersambung }}</div>
                </div>
              </div>
            </div>

            <div v-if="jedaOtomatis" role="alert" class="alert alert-warning">
              <i class="fa-solid fa-server" aria-hidden="true"></i>
              <span>
                Server sempat mati {{ durasiSingkat(jedaOtomatis.mati) }} (terdeteksi {{ jamWib(jedaOtomatis.pada) }} WIB),
                jadi ujian dijeda otomatis. Waktu siswa tidak berkurang selama server mati. Tekan <strong>Lanjutkan</strong>
                bila siswa sudah siap.
              </span>
            </div>
            <div v-else-if="data.ujian.status === 'berlangsung' && sisaGlobal !== null && sisaGlobal <= 0" role="status" class="alert alert-info">
              <i class="fa-solid fa-hourglass-end" aria-hidden="true"></i>
              <span>Waktu habis: jawaban siswa dikumpulkan otomatis. Tekan <strong>Akhiri</strong> bila sudah selesai, atau
                beri perpanjangan bila perlu.</span>
            </div>

            <div v-if="konfirmasiAkhiri" role="alert" class="alert alert-warning">
              <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
              <span>Akhiri ujian sekarang? Semua siswa yang masih mengerjakan langsung dikumpulkan dan tidak bisa mengetik lagi.</span>
              <div class="flex gap-2">
                <button class="btn btn-sm" type="button" @click="konfirmasiAkhiri = false">Batal</button>
                <button class="btn btn-sm btn-error" type="button" :disabled="sibuk" @click="transisi('akhiri')">Ya, akhiri</button>
              </div>
            </div>
            <div v-if="konfirmasiBukaKunci" role="alert" class="alert alert-warning">
              <i class="fa-solid fa-unlock" aria-hidden="true"></i>
              <span>Buka kunci {{ ringkas.terkunci }} nama yang terkunci karena 5× PIN salah? PIN mereka tetap sama.</span>
              <div class="flex gap-2">
                <button class="btn btn-sm" type="button" @click="konfirmasiBukaKunci = false">Batal</button>
                <button class="btn btn-sm btn-warning" type="button" :disabled="sibuk" @click="bukaKunciSemua">Ya, buka semua</button>
              </div>
            </div>

            <div class="flex flex-wrap gap-2 items-center">
              <button v-if="data.ujian.status === 'menunggu'" class="btn btn-success" type="button" :disabled="sibuk" @click="transisi('mulai')">
                <i class="fa-solid fa-play" aria-hidden="true"></i> Mulai ujian
              </button>
              <button v-if="data.ujian.status === 'berlangsung'" class="btn btn-warning" type="button" :disabled="sibuk" @click="transisi('jeda')">
                <i class="fa-solid fa-pause" aria-hidden="true"></i> Jeda
              </button>
              <button v-if="data.ujian.status === 'dijeda'" class="btn btn-success" type="button" :disabled="sibuk" @click="transisi('lanjutkan')">
                <i class="fa-solid fa-play" aria-hidden="true"></i> Lanjutkan
              </button>
              <div v-if="data.ujian.status === 'berlangsung' || data.ujian.status === 'dijeda'" class="join">
                <input v-model.number="menitSemua" type="number" min="-120" max="120" class="input input-sm join-item w-20" aria-label="Menit perpanjangan semua siswa" />
                <button class="btn btn-sm join-item" type="button" :disabled="sibuk || !menitSemua" @click="perpanjangSemua">
                  <i class="fa-solid fa-plus" aria-hidden="true"></i> menit untuk semua
                </button>
              </div>
              <button
                v-if="(data.ujian.status === 'berlangsung' || data.ujian.status === 'dijeda') && !konfirmasiAkhiri"
                class="btn btn-error btn-outline"
                type="button"
                :disabled="sibuk"
                @click="konfirmasiAkhiri = true"
              >
                <i class="fa-solid fa-flag-checkered" aria-hidden="true"></i> Akhiri ujian
              </button>
              <span class="flex-1"></span>
              <button v-if="ringkas.terkunci > 0" class="btn btn-sm" type="button" @click="konfirmasiBukaKunci = true">
                <i class="fa-solid fa-unlock" aria-hidden="true"></i> Buka kunci semua ({{ ringkas.terkunci }})
              </button>
              <button class="btn btn-sm" type="button" :disabled="sibuk" @click="bukaProyektor">
                <i class="fa-solid fa-display" aria-hidden="true"></i> Buka layar proyektor
              </button>
              <button class="btn btn-sm btn-ghost" type="button" :disabled="sibuk" @click="cabutProyektor">
                <i class="fa-solid fa-display" aria-hidden="true"></i> Tutup proyektor
              </button>
            </div>
          </div>
        </section>

        <!-- Tabel siswa -->
        <section class="card bg-base-100 shadow">
          <div class="card-body gap-2">
            <h2 class="card-title"><i class="fa-solid fa-users" aria-hidden="true"></i> Siswa</h2>
            <div class="overflow-x-auto">
              <table class="table table-sm">
                <thead>
                  <tr>
                    <th>Nama</th><th>Status</th><th>Koneksi</th><th>Terjawab</th><th>Sisa</th><th>Aktivitas di luar halaman</th><th><span class="sr-only">Aksi</span></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in data.peserta" :key="p.id">
                    <td>
                      <p class="font-medium">{{ p.nama }} <span v-if="p.nomor" class="text-base-content/50">({{ p.nomor }})</span></p>
                      <p v-if="p.terkunci" class="text-xs text-error"><i class="fa-solid fa-lock" aria-hidden="true"></i> Terkunci (5× PIN salah)</p>
                      <p v-else-if="!p.punya_pin && p.status === 'belum_masuk'" class="text-xs text-base-content/50">Belum membuat PIN</p>
                    </td>
                    <td>
                      <span class="badge badge-sm" :class="{ 'badge-success': p.status === 'mengerjakan', 'badge-neutral': p.status === 'dikumpulkan', 'badge-info': p.status === 'menunggu', 'badge-ghost': p.status === 'belum_masuk' }">
                        {{ LABEL_STATUS_PESERTA[p.status] }}
                      </span>
                      <p v-if="p.cara_kumpul" class="text-xs text-base-content/60">{{ LABEL_CARA[p.cara_kumpul] }}</p>
                      <p v-if="p.terlambat_menunggu" class="text-xs text-warning">{{ p.terlambat_menunggu }} kiriman terlambat</p>
                    </td>
                    <td>
                      <span v-if="p.tersambung" class="text-success text-sm"><i class="fa-solid fa-circle text-[0.5rem]" aria-hidden="true"></i> tersambung</span>
                      <span v-else-if="p.status !== 'belum_masuk'" class="text-base-content/50 text-sm"><i class="fa-regular fa-circle text-[0.5rem]" aria-hidden="true"></i> tidak tersambung</span>
                      <p v-if="p.info_perangkat" class="text-xs text-base-content/50">{{ p.info_perangkat }}</p>
                    </td>
                    <td>
                      {{ p.terjawab }}/{{ data.ujian.jumlah_soal }}
                      <p v-if="p.simpan_terakhir_at" class="text-xs text-base-content/50">simpan {{ jamWib(p.simpan_terakhir_at) }}</p>
                    </td>
                    <td class="font-mono tabular-nums">
                      <template v-if="p.sisa_ms !== null && p.status === 'mengerjakan'">{{ formatSisa(sisaKini(p.sisa_ms) ?? 0) }}</template>
                      <span v-if="p.perpanjangan_ms > 0" class="block text-xs text-base-content/60">+{{ durasiSingkat(p.perpanjangan_ms) }}</span>
                    </td>
                    <td>
                      <div class="flex flex-wrap gap-1">
                        <span
                          v-for="a in ringkasAktivitas(p)"
                          :key="a.jenis"
                          class="badge badge-sm badge-outline"
                          :class="{ 'badge-warning': a.jenis === 'tab_tersembunyi' || a.jenis === 'fokus_hilang' || a.jenis === 'keluar_layar_penuh' || a.jenis === 'tempel_dari_luar' }"
                        >{{ a.teks }}</span>
                      </div>
                    </td>
                    <td>
                      <div class="flex flex-wrap gap-1 justify-end">
                        <button
                          v-if="data.ujian.status !== 'draf' && data.ujian.status !== 'menunggu'"
                          type="button"
                          class="btn btn-xs"
                          @click="dilihat = p"
                        >
                          <i class="fa-solid fa-file-lines" aria-hidden="true"></i> Jawaban
                        </button>
                        <template v-if="data.ujian.status === 'berlangsung' || data.ujian.status === 'dijeda'">
                          <button v-if="p.status === 'mengerjakan'" type="button" class="btn btn-xs" :disabled="sibuk" @click="perpanjangSatu(p)">
                            <i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> Waktu
                          </button>
                          <button v-if="p.status === 'dikumpulkan'" type="button" class="btn btn-xs" :disabled="sibuk" @click="bukaKembali(p)">
                            <i class="fa-solid fa-lock-open" aria-hidden="true"></i> Buka kembali
                          </button>
                        </template>
                        <button v-if="p.terkunci" type="button" class="btn btn-xs btn-warning" :disabled="sibuk" @click="bukaKunci(p)">
                          <i class="fa-solid fa-unlock" aria-hidden="true"></i> Buka kunci
                        </button>
                        <button type="button" class="btn btn-xs btn-ghost" :disabled="sibuk" @click="resetPin(p)">
                          <i class="fa-solid fa-key" aria-hidden="true"></i> Reset PIN
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- Aktivitas terbaru -->
        <section class="card bg-base-100 shadow">
          <div class="card-body gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="card-title flex-1"><i class="fa-solid fa-list-ul" aria-hidden="true"></i> Aktivitas terbaru</h2>
              <select v-model="saringJenis" class="select select-sm w-auto" aria-label="Saring jenis aktivitas">
                <option value="">Semua jenis</option>
                <option v-for="j in JENIS_EVENT" :key="j" :value="j">{{ LABEL_EVENT[j] }}</option>
              </select>
            </div>
            <p class="text-xs text-base-content/60">
              Ini catatan, bukan vonis. Browser hanya tahu halaman ujian tidak terlihat atau tidak aktif, bukan apa yang
              dibuka siswa, dan tidak bisa mendeteksi aplikasi lain, ponsel, atau tangkapan layar. Tandai "wajar" untuk
              menyembunyikannya dari proyektor.
            </p>
            <p v-if="eventTampil.length === 0" class="text-base-content/60">Belum ada aktivitas.</p>
            <ul v-else class="flex flex-col divide-y divide-base-200 max-h-96 overflow-auto">
              <li v-for="e in eventTampil" :key="e.id" class="py-2 flex flex-wrap items-center gap-x-3 gap-y-1" :class="{ 'opacity-50': e.ditandai_wajar }">
                <span class="font-mono text-sm">{{ jamWib(e.mulai_at) }}</span>
                <span class="font-medium">{{ namaPeserta.get(e.peserta_id) ?? '(tidak dikenal)' }}</span>
                <span>{{ LABEL_EVENT[e.jenis] }}</span>
                <span v-if="lamaEvent(e)" class="text-sm text-base-content/70">· {{ lamaEvent(e) }}</span>
                <span v-if="teksDetail(e)" class="text-xs text-base-content/60">{{ teksDetail(e) }}</span>
                <span v-if="e.catatan_penguji" class="text-xs italic">"{{ e.catatan_penguji }}"</span>
                <span class="flex-1"></span>
                <button type="button" class="btn btn-xs" :class="e.ditandai_wajar ? 'btn-ghost' : 'btn-outline'" :disabled="sibuk" @click="tandaiWajar(e)">
                  {{ e.ditandai_wajar ? 'Batalkan "wajar"' : 'Tandai wajar' }}
                </button>
                <button v-if="e.ditandai_wajar || e.catatan_penguji" type="button" class="btn btn-xs btn-ghost" :disabled="sibuk" @click="ubahCatatan(e)">
                  <i class="fa-solid fa-pen" aria-hidden="true"></i> {{ e.catatan_penguji ? 'Ubah catatan' : 'Catatan' }}
                </button>
              </li>
            </ul>
          </div>
        </section>

        <!-- Log aksi -->
        <section class="card bg-base-100 shadow">
          <div class="card-body gap-2">
            <button type="button" class="flex items-center gap-2 text-left" :aria-expanded="tampilLog" @click="tampilLog = !tampilLog">
              <i class="fa-solid" :class="tampilLog ? 'fa-chevron-down' : 'fa-chevron-right'" aria-hidden="true"></i>
              <h2 class="card-title">Log aksi guru & server</h2>
            </button>
            <ul v-if="tampilLog" class="flex flex-col divide-y divide-base-200 max-h-80 overflow-auto text-sm">
              <li v-for="l in data.log" :key="l.id" class="py-1 flex gap-3">
                <span class="font-mono">{{ jamWib(l.dibuat_at) }}</span>
                <span class="badge badge-sm" :class="l.aktor === 'server' ? 'badge-warning' : 'badge-ghost'">{{ l.aktor === 'server' ? 'server' : 'guru' }}</span>
                <span>{{ LABEL_AKSI[l.aksi] ?? l.aksi }}</span>
                <span v-if="typeof l.detail.peserta_id === 'number'" class="text-base-content/60">{{ namaPeserta.get(l.detail.peserta_id) ?? '' }}</span>
                <span v-if="typeof l.detail.menit === 'number'" class="text-base-content/60">{{ l.detail.menit }} menit</span>
              </li>
            </ul>
          </div>
        </section>
      </template>
    </main>

    <DialogIsian v-if="dialog" :permintaan="dialog.permintaan" @ok="tutupDialog" @batal="tutupDialog(null)" />
    <DialogJawaban v-if="dilihat" :ujian-id="id" :peserta-id="dilihat.id" @tutup="dilihat = null" />
  </div>
</template>
