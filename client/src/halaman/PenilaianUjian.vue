<!--
  client/src/halaman/PenilaianUjian.vue — penilaian manual oleh guru (alamat "/guru/ujian/:id/nilai"): putuskan jawaban
  terlambat, mulai penilaian, nilai per soal (pilih level tiap kriteria + catatan untuk siswa), setujui, rekap nilai,
  rilis/tarik rilis, unduh nilai (Excel/CSV), serta draf nilai AI (pilih model, perkiraan biaya, kemajuan antrean, dan
  saran AI per jawaban: skor, alasan & kutipan per kriteria; hanya untuk guru).
  Dipanggil oleh: client/src/router.ts (hanya setelah lolos penjaga sesi guru).
  Memanggil: GET /api/ujian/:id/penilaian, PATCH .../terlambat/:tid, POST .../{mulai-penilaian,rilis,tarik-rilis},
             PUT .../penilaian/:pid/:soalId, POST .../penilaian/setujui/:soalId, GET .../nilai.xlsx & nilai.csv,
             GET .../ai, POST .../ai/mulai & .../ai/hentikan; shared/nilai.ts
             (rumus yang sama dengan server, untuk pratinjau angka).
  Penilaian per soal (bukan per siswa) agar guru menilai satu soal untuk semua siswa sekaligus: lebih cepat dan
  lebih konsisten. Teks jawaban dirender sebagai teks ({{ }}), tidak pernah sebagai HTML.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { StatusAiSchema } from '../../../shared/ai.ts';
import type { ModelAi, SaranAi, StatusAi } from '../../../shared/ai.ts';
import { onBeforeRouteLeave, RouterLink, useRoute } from 'vue-router';
import { angka, masalahSkor, NilaiJawabanSchema, SetujuiSemuaSchema, nilaiSoal, nilaiUjian, PenilaianGuruSchema, persenSoal, skorMaks } from '../../../shared/nilai.ts';
import type { PenilaianGuru, Skor } from '../../../shared/nilai.ts';
import type { SoalGuru } from '../../../shared/ujian.ts';
import { api, GalatApi, pesanGalat } from '../api.ts';
import KepalaGuru from '../komponen/guru/KepalaGuru.vue';
import { LABEL_STATUS_UJIAN, waktuWib, WARNA_STATUS_UJIAN } from '../label.ts';

const route = useRoute();
const id = computed(() => Number(route.params.id));
const data = ref<PenilaianGuru | null>(null);
const galat = ref('');
const masalah = ref<string[]>([]);
const info = ref('');
const sibuk = ref(false);
const tampilan = ref<'soal' | 'rekap'>('soal');
const soalAktifId = ref<number | null>(null);
const tampilAcuan = ref(false);

// `kotor` = diubah di layar tetapi belum disimpan ke server. Isian kotor tidak pernah ditimpa saat halaman memuat
// ulang, dan ditandai jelas, supaya pilihan guru tidak hilang diam-diam dan angka di kartu tidak menipu.
type Isian = { skor: Skor; catatan: string; kotor: boolean };
const isian = reactive(new Map<string, Isian>());
const kunci = (pid: number, sid: number): string => `${pid}:${sid}`;

const bolehNilai = computed(() => data.value?.ujian.status === 'penilaian');
const soalAktif = computed(() => data.value?.soal.find((s) => s.id === soalAktifId.value) ?? null);
const nilaiMap = computed(() => new Map((data.value?.nilai ?? []).map((n) => [kunci(n.peserta_id, n.soal_id), n])));
const jawabanMap = computed(() => new Map((data.value?.jawaban ?? []).map((j) => [kunci(j.peserta_id, j.soal_id), j.isi])));
const namaPeserta = computed(
  () => new Map([...(data.value?.peserta ?? []), ...(data.value?.tidak_hadir ?? [])].map((p) => [p.id, p.nama])),
);
const judulSoal = computed(() => new Map((data.value?.soal ?? []).map((s) => [s.id, `Soal ${s.urutan}`])));

const kemajuan = computed(() => {
  const d = data.value;
  if (!d) return { disetujui: 0, total: 0 };
  return {
    disetujui: d.nilai.filter((n) => n.status === 'disetujui').length,
    total: d.peserta.length * d.soal.length,
  };
});

function kemajuanSoal(s: SoalGuru): string {
  const d = data.value;
  if (!d) return '';
  const ok = d.peserta.filter((p) => nilaiMap.value.get(kunci(p.id, s.id))?.status === 'disetujui').length;
  return `${ok}/${d.peserta.length}`;
}

function siapkanIsian(d: PenilaianGuru): void {
  for (const p of d.peserta) {
    for (const s of d.soal) {
      const lama = isian.get(kunci(p.id, s.id));
      if (lama?.kotor) continue;
      const n = d.nilai.find((x) => x.peserta_id === p.id && x.soal_id === s.id);
      isian.set(kunci(p.id, s.id), { skor: { ...(n?.skor ?? {}) }, catatan: n?.catatan ?? '', kotor: false });
    }
  }
}

const jumlahKotor = computed(() => [...isian.values()].filter((i) => i.kotor).length);
function kotorDiSoal(sid: number): number {
  return (data.value?.peserta ?? []).filter((p) => isian.get(kunci(p.id, sid))?.kotor).length;
}
// Peringatan browser bila halaman ditutup/berpindah saat masih ada nilai yang belum disimpan.
function saatTutup(e: BeforeUnloadEvent): void {
  if (jumlahKotor.value > 0) e.preventDefault();
}
window.addEventListener('beforeunload', saatTutup);
onBeforeUnmount(() => window.removeEventListener('beforeunload', saatTutup));
onBeforeRouteLeave(() =>
  jumlahKotor.value === 0 || window.confirm(`${jumlahKotor.value} nilai belum disimpan dan akan hilang. Tetap tinggalkan halaman?`),
);

// Penanda urutan: respons muat() yang dimulai SEBELUM simpanan terakhir guru (atau disusul muat() yang lebih baru)
// dibuang, supaya potret basi dari polling tidak mengembalikan isian ke nilai lama lalu ikut tersimpan.
let nomorMuat = 0;
let nomorMutasi = 0;
let sedangMuat = false;

async function muat(): Promise<void> {
  const ke = ++nomorMuat;
  const mutasiAwal = nomorMutasi;
  sedangMuat = true;
  try {
    const d = await api('GET', `/api/ujian/${id.value}/penilaian`, { skema: PenilaianGuruSchema });
    if (ke !== nomorMuat || mutasiAwal !== nomorMutasi) return;
    data.value = d;
    siapkanIsian(d);
    if (soalAktifId.value === null || !d.soal.some((s) => s.id === soalAktifId.value)) soalAktifId.value = d.soal[0]?.id ?? null;
  } catch (e) {
    if (ke === nomorMuat) galat.value = pesanGalat(e);
  } finally {
    if (ke === nomorMuat) sedangMuat = false;
  }
}
watch(id, () => void muat(), { immediate: true });

// ---- Draf nilai AI ----
const statusAi = ref<StatusAi | null>(null);
const modelAi = ref<ModelAi>('claude-haiku-5-5');
const modelDipilih = ref(false);
let pemantauAi: ReturnType<typeof setInterval> | null = null;
const aiBerjalan = computed(() => statusAi.value?.run?.status === 'berjalan');
const saranMap = computed(() => new Map((data.value?.saran_ai ?? []).map((s) => [kunci(s.peserta_id, s.soal_id), s])));
const saran = (pid: number, sid: number): SaranAi | undefined => saranMap.value.get(kunci(pid, sid));
const totalTugas = computed(() => Object.values(statusAi.value?.run?.jumlah ?? {}).reduce((n, v) => n + v, 0));
const tugasTuntas = computed(() => {
  const j = statusAi.value?.run?.jumlah;
  return j ? (j.selesai ?? 0) + (j.perlu_manual ?? 0) + (j.dibatalkan ?? 0) : 0;
});
const namaModel = (mid: string): string => statusAi.value?.model.find((m) => m.id === mid)?.nama ?? mid;

async function muatAi(): Promise<void> {
  if (!data.value || !['penilaian', 'dirilis'].includes(data.value.ujian.status)) {
    statusAi.value = null;
    return;
  }
  try {
    statusAi.value = await api('GET', `/api/ujian/${id.value}/ai`, { skema: StatusAiSchema });
    if (!modelDipilih.value) modelAi.value = statusAi.value.model_bawaan;
  } catch {
    // Panel AI sekadar tidak tampil; penilaian manual tidak terganggu.
  }
}
watch(() => data.value?.ujian.status, () => void muatAi());

// Selama antrean AI berjalan, status & draf baru dimuat ulang tiap 3 dtk. Polling dilewati selama guru sedang
// menyimpan, masih punya isian yang belum disimpan, atau muat sebelumnya belum selesai (tidak tumpang tindih).
watch(aiBerjalan, (jalan) => {
  if (pemantauAi) clearInterval(pemantauAi);
  pemantauAi = null;
  if (!jalan) return;
  pemantauAi = setInterval(() => {
    void muatAi();
    if (!sibuk.value && !sedangMuat && jumlahKotor.value === 0) void muat();
  }, 3000);
});
// Saat antrean baru selesai, muat sekali lagi agar draf terakhir tampil.
watch(aiBerjalan, (jalan, sebelum) => {
  if (sebelum && !jalan) void muat();
});
onBeforeUnmount(() => {
  if (pemantauAi) clearInterval(pemantauAi);
});

function usdTeks(n: number): string {
  if (n > 0 && n < 0.01) return '< $0,01';
  return `$${n.toFixed(2).replace('.', ',')}`;
}

const ALASAN_BERHENTI: Record<string, string> = {
  guru: 'dihentikan oleh Anda',
  batas_biaya: 'batas biaya bulanan tercapai',
};

const mulaiAi = () =>
  jalankan(async () => {
    await api('POST', `/api/ujian/${id.value}/ai/mulai`, { body: { model: modelAi.value } });
    await muatAi();
  }, 'AI mulai menilai. Draf muncul bertahap; periksa lalu setujui seperti biasa.');
const hentikanAi = () =>
  jalankan(async () => {
    await api('POST', `/api/ujian/${id.value}/ai/hentikan`);
    await muatAi();
  }, 'Penilaian AI dihentikan. Jawaban yang belum dinilai bisa dinilai manual.');

async function jalankan(kerja: () => Promise<unknown>, pesan = ''): Promise<void> {
  galat.value = '';
  masalah.value = [];
  info.value = '';
  sibuk.value = true;
  try {
    await kerja();
    info.value = pesan;
  } catch (e) {
    galat.value = pesanGalat(e);
    if (e instanceof GalatApi && Array.isArray(e.data.masalah)) masalah.value = e.data.masalah as string[];
  } finally {
    sibuk.value = false;
  }
  await muat();
}

const transisi = (aksi: 'mulai-penilaian' | 'rilis' | 'tarik-rilis', pesan: string) =>
  jalankan(() => api('POST', `/api/ujian/${id.value}/${aksi}`), pesan);

const putuskan = (tid: number, keputusan: 'diterima' | 'ditolak') =>
  jalankan(() => api('PATCH', `/api/ujian/${id.value}/terlambat/${tid}`, { body: { keputusan } }));

function isianDari(pid: number, sid: number): Isian {
  let i = isian.get(kunci(pid, sid));
  if (!i) {
    i = { skor: {}, catatan: '', kotor: false };
    isian.set(kunci(pid, sid), i);
  }
  return i;
}

function pilihLevel(pid: number, s: SoalGuru, kid: string, skor: number): void {
  const i = isianDari(pid, s.id);
  i.skor = { ...i.skor, [kid]: skor };
  i.kotor = true;
}

function ubahCatatan(pid: number, sid: number, teks: string): void {
  const i = isianDari(pid, sid);
  i.catatan = teks;
  i.kotor = true;
}

function pratinjau(pid: number, s: SoalGuru): string {
  const n = nilaiSoal(s.rubrik, isianDari(pid, s.id).skor);
  return n === null ? '–' : `${angka(persenSoal(n))}%`;
}

async function simpan(pid: number, s: SoalGuru, setujui: boolean): Promise<void> {
  const i = isianDari(pid, s.id);
  const m = masalahSkor(s.rubrik, i.skor);
  if (m) {
    galat.value = `${namaPeserta.value.get(pid)}: ${m}.`;
    return;
  }
  galat.value = '';
  sibuk.value = true;
  try {
    nomorMutasi += 1;
    const hasil = await api('PUT', `/api/ujian/${id.value}/penilaian/${pid}/${s.id}`, {
      body: { skor: i.skor, catatan: i.catatan, setujui },
      skema: NilaiJawabanSchema,
    });
    // Perbarui setempat (tanpa memuat ulang semua isian yang mungkin sedang diketik guru di kartu lain).
    if (data.value) data.value.nilai = [...data.value.nilai.filter((n) => !(n.peserta_id === pid && n.soal_id === s.id)), hasil];
    i.kotor = false;
  } catch (e) {
    galat.value = pesanGalat(e);
  } finally {
    sibuk.value = false;
  }
}

// Draf AI yang ditandai berisi instruksi untuk penilai dilewati server; guru menyetujuinya satu per satu.
async function setujuiSemua(s: SoalGuru): Promise<void> {
  let dilewati = 0;
  await jalankan(async () => {
    nomorMutasi += 1;
    const r = await api('POST', `/api/ujian/${id.value}/penilaian/setujui/${s.id}`, { skema: SetujuiSemuaSchema });
    dilewati = r.dilewati;
  }, `Semua draf ${judulSoal.value.get(s.id)} disetujui.`);
  if (dilewati > 0) {
    info.value = `Draf ${judulSoal.value.get(s.id)} disetujui, kecuali ${dilewati} jawaban yang ditandai AI berisi instruksi untuk penilai. Periksa dan setujui satu per satu.`;
  }
}

function statusJawaban(pid: number, sid: number): { teks: string; kelas: string } {
  if (isian.get(kunci(pid, sid))?.kotor) return { teks: 'belum disimpan', kelas: 'badge-error' };
  const n = nilaiMap.value.get(kunci(pid, sid));
  if (!n) return { teks: 'belum dinilai', kelas: 'badge-ghost' };
  if (n.sumber === 'otomatis_kosong') return { teks: 'kosong · otomatis 0', kelas: 'badge-neutral' };
  if (n.status === 'disetujui') return { teks: 'disetujui', kelas: 'badge-success' };
  return n.sumber === 'ai' ? { teks: 'draf AI', kelas: 'badge-info' } : { teks: 'draf', kelas: 'badge-warning' };
}

// ---- Rekap ----
function nilaiTersetujui(pid: number, s: SoalGuru): number | null {
  const n = nilaiMap.value.get(kunci(pid, s.id));
  return n && n.status === 'disetujui' ? nilaiSoal(s.rubrik, n.skor) : null;
}
function nilaiAkhir(pid: number): string {
  const d = data.value;
  if (!d) return '';
  const per = d.soal.map((s) => nilaiTersetujui(pid, s));
  if (per.some((n) => n === null)) return 'belum lengkap';
  return angka(nilaiUjian(d.soal.map((s, i) => ({ nilai: per[i] as number, bobot: s.bobot }))));
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
        <RouterLink :to="`/guru/ujian/${id}/pantau`" class="btn btn-sm btn-ghost">
          <i class="fa-solid fa-chart-column" aria-hidden="true"></i> Dasbor pemantauan
        </RouterLink>
      </div>

      <div v-if="galat" role="alert" class="alert alert-error">
        <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
        <div>
          <p>{{ galat }}</p>
          <ul v-if="masalah.length" class="list-disc ml-5 text-sm">
            <li v-for="m in masalah" :key="m">{{ m }}</li>
          </ul>
        </div>
      </div>
      <div v-if="info" role="status" class="alert alert-success"><span>{{ info }}</span></div>

      <div v-if="!data && !galat" class="flex items-center gap-2"><span class="loading loading-spinner"></span> Memuat…</div>

      <template v-if="data">
        <section class="card bg-base-100 shadow">
          <div class="card-body gap-3">
            <div class="flex flex-wrap items-center gap-3">
              <h1 class="text-2xl font-bold flex-1 min-w-0 break-words">Penilaian: {{ data.ujian.judul }}</h1>
              <span class="badge badge-lg" :class="WARNA_STATUS_UJIAN[data.ujian.status]">{{ LABEL_STATUS_UJIAN[data.ujian.status] }}</span>
            </div>
            <p v-if="data.ujian.status !== 'selesai'" class="text-sm">
              {{ kemajuan.disetujui }} dari {{ kemajuan.total }} jawaban disetujui
              · {{ data.peserta.length }} siswa hadir<template v-if="data.tidak_hadir.length"> · {{ data.tidak_hadir.length }} tidak hadir</template>
            </p>
            <progress v-if="data.ujian.status !== 'selesai'" class="progress progress-success" :value="kemajuan.disetujui" :max="Math.max(1, kemajuan.total)"></progress>
            <div class="flex flex-wrap gap-2 items-center">
              <button v-if="data.ujian.status === 'selesai'" class="btn btn-primary" type="button" :disabled="sibuk" @click="transisi('mulai-penilaian', 'Penilaian dimulai. Jawaban kosong sudah diberi 0.')">
                <i class="fa-solid fa-pen-ruler" aria-hidden="true"></i> Mulai penilaian
              </button>
              <button v-if="data.ujian.status === 'penilaian'" class="btn btn-success" type="button" :disabled="sibuk || kemajuan.disetujui < kemajuan.total || jumlahKotor > 0" @click="transisi('rilis', 'Nilai dirilis. Siswa bisa melihatnya saat masuk dengan nama & PIN.')">
                <i class="fa-solid fa-bullhorn" aria-hidden="true"></i> Rilis nilai ke siswa
              </button>
              <button v-if="data.ujian.status === 'dirilis'" class="btn btn-outline" type="button" :disabled="sibuk" @click="transisi('tarik-rilis', 'Rilis ditarik. Siswa tidak lagi melihat nilai.')">
                <i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Tarik rilis
              </button>
              <span class="flex-1"></span>
              <template v-if="data.ujian.status !== 'selesai'">
                <a class="btn btn-sm" :href="`/api/ujian/${id}/nilai.xlsx`" download>
                  <i class="fa-solid fa-file-excel" aria-hidden="true"></i> Unduh nilai (Excel)
                </a>
                <a class="link text-xs" :href="`/api/ujian/${id}/nilai.csv`" download title="CSV format Indonesia: pemisah ';', desimal koma">CSV</a>
              </template>
            </div>
            <p v-if="data.ujian.status === 'dirilis'" class="text-sm text-base-content/70">
              Siswa sekarang melihat nilai, kriteria yang dicapai, catatan Anda, dan jawaban acuan. Untuk mengubah nilai,
              tarik rilis dulu.
            </p>
          </div>
        </section>

        <!-- Draf nilai AI -->
        <section v-if="statusAi && data.ujian.status === 'penilaian'" class="card bg-base-100 shadow">
          <div class="card-body gap-3">
            <h2 class="card-title"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Draf nilai AI</h2>
            <div v-if="!statusAi.tersedia" role="status" class="alert">
              <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
              <span>
                Penilaian AI belum aktif: kunci API (ANTHROPIC_API_KEY) belum diisi di berkas .env server. Penilaian manual
                tetap bisa dipakai seperti biasa.
              </span>
            </div>
            <template v-else>
              <p class="text-sm text-base-content/70">
                AI hanya mengisi <strong>draf</strong> (skor per kriteria dan catatan untuk siswa). Anda tetap memeriksa, mengubah
                bila perlu, lalu menyetujui. Yang dikirim ke AI hanya soal, rubrik, jawaban acuan, dan teks jawaban, tanpa nama siswa (kecuali bila siswa
                menuliskannya sendiri di jawaban).
              </p>
              <div v-if="aiBerjalan && statusAi.run" class="flex flex-col gap-2">
                <p class="text-sm flex items-center gap-2">
                  <span class="loading loading-spinner loading-xs"></span>
                  Menilai dengan {{ namaModel(statusAi.run.model) }}: {{ tugasTuntas }} dari {{ totalTugas }} jawaban · biaya sejauh ini
                  {{ usdTeks(statusAi.run.biaya_usd) }}
                </p>
                <progress class="progress progress-info" :value="tugasTuntas" :max="Math.max(1, totalTugas)"></progress>
                <button type="button" class="btn btn-sm btn-outline self-start" :disabled="sibuk" @click="hentikanAi">
                  <i class="fa-solid fa-stop" aria-hidden="true"></i> Hentikan
                </button>
              </div>
              <template v-else>
                <p v-if="statusAi.run" class="text-sm">
                  Terakhir ({{ namaModel(statusAi.run.model) }}): {{ statusAi.run.jumlah.selesai ?? 0 }} draf dibuat<template
                    v-if="statusAi.run.jumlah.perlu_manual"
                    >, <strong class="text-warning">{{ statusAi.run.jumlah.perlu_manual }} perlu dinilai manual</strong></template
                  >
                  · biaya {{ usdTeks(statusAi.run.biaya_usd) }}<template v-if="statusAi.run.status === 'dihentikan'">
                    · berhenti: {{ ALASAN_BERHENTI[statusAi.run.alasan_berhenti ?? ''] ?? statusAi.run.alasan_berhenti }}</template
                  >
                </p>
                <div class="flex flex-wrap items-end gap-3">
                  <label class="flex flex-col gap-1">
                    <span class="text-sm">Model</span>
                    <select v-model="modelAi" class="select select-sm" @change="modelDipilih = true">
                      <option v-for="m in statusAi.model" :key="m.id" :value="m.id">{{ m.nama }} | {{ m.keterangan }}</option>
                    </select>
                  </label>
                  <button type="button" class="btn btn-sm btn-primary" :disabled="sibuk || statusAi.belum_dinilai === 0" @click="mulaiAi">
                    <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Nilai {{ statusAi.belum_dinilai }} jawaban dengan AI
                  </button>
                </div>
                <p class="text-sm">
                  Perkiraan biaya (kasar): <strong>{{ usdTeks(statusAi.perkiraan_usd[modelAi] ?? 0) }}</strong> · terpakai bulan ini
                  {{ usdTeks(statusAi.terpakai_usd_bulan_ini) }} dari batas {{ usdTeks(statusAi.batas_usd_bulanan) }}
                </p>
                <p
                  v-if="(statusAi.perkiraan_usd[modelAi] ?? 0) > statusAi.batas_usd_bulanan - statusAi.terpakai_usd_bulan_ini"
                  class="text-sm text-warning"
                >
                  Perkiraan melebihi sisa batas bulan ini. AI berhenti sendiri saat batas tercapai, dan sisanya dinilai manual.
                </p>
                <p v-if="statusAi.belum_dinilai === 0" class="text-sm text-base-content/60">Semua jawaban sudah punya nilai atau draf.</p>
              </template>
            </template>
          </div>
        </section>

        <!-- Jawaban terlambat (harus diputuskan sebelum penilaian) -->
        <section v-if="data.terlambat.length" class="card bg-base-100 shadow">
          <div class="card-body gap-2">
            <h2 class="card-title"><i class="fa-solid fa-clock" aria-hidden="true"></i> Kiriman setelah waktu habis</h2>
            <p class="text-sm text-base-content/70">Putuskan dulu sebelum penilaian dimulai. Diterima = menggantikan jawaban siswa untuk soal itu.</p>
            <ul class="flex flex-col gap-2">
              <li v-for="t in data.terlambat" :key="t.id" class="border border-base-300 rounded-box p-3 flex flex-col gap-2">
                <p class="text-sm">
                  <strong>{{ namaPeserta.get(t.peserta_id) }}</strong> · {{ judulSoal.get(t.soal_id) }} · tiba {{ waktuWib(t.diterima_at) }}
                </p>
                <p class="whitespace-pre-wrap break-words bg-base-200 rounded p-2 text-sm">{{ t.isi }}</p>
                <div class="flex gap-2">
                  <button type="button" class="btn btn-sm btn-success" :disabled="sibuk" @click="putuskan(t.id, 'diterima')">Terima</button>
                  <button type="button" class="btn btn-sm" :disabled="sibuk" @click="putuskan(t.id, 'ditolak')">Tolak</button>
                </div>
              </li>
            </ul>
          </div>
        </section>

        <template v-if="data.ujian.status !== 'selesai'">
          <div role="tablist" class="tabs tabs-box bg-base-100 shadow">
            <button role="tab" type="button" class="tab" :class="{ 'tab-active': tampilan === 'soal' }" @click="tampilan = 'soal'">
              <i class="fa-solid fa-list-check" aria-hidden="true"></i>&nbsp;Nilai per soal
            </button>
            <button role="tab" type="button" class="tab" :class="{ 'tab-active': tampilan === 'rekap' }" @click="tampilan = 'rekap'">
              <i class="fa-solid fa-table" aria-hidden="true"></i>&nbsp;Rekap
            </button>
          </div>

          <!-- Nilai per soal -->
          <template v-if="tampilan === 'soal'">
            <div class="flex flex-wrap gap-2">
              <button
                v-for="s in data.soal"
                :key="s.id"
                type="button"
                class="btn btn-sm"
                :class="s.id === soalAktifId ? 'btn-primary' : ''"
                @click="soalAktifId = s.id"
              >
                Soal {{ s.urutan }} <span class="badge badge-sm">{{ kemajuanSoal(s) }}</span>
              </button>
            </div>

            <section v-if="soalAktif" class="card bg-base-100 shadow">
              <div class="card-body gap-2">
                <h2 class="card-title">Soal {{ soalAktif.urutan }}: {{ soalAktif.judul }} <span class="text-sm font-normal">(bobot {{ soalAktif.bobot }})</span></h2>
                <p class="whitespace-pre-wrap break-words">{{ soalAktif.teks }}</p>
                <button type="button" class="link text-sm self-start" @click="tampilAcuan = !tampilAcuan">
                  {{ tampilAcuan ? 'Sembunyikan' : 'Lihat' }} jawaban acuan
                </button>
                <p v-if="tampilAcuan" class="whitespace-pre-wrap break-words bg-base-200 rounded p-2 text-sm">{{ soalAktif.jawaban_acuan }}</p>
                <div v-if="bolehNilai" class="flex flex-wrap items-center justify-end gap-2">
                  <span v-if="kotorDiSoal(soalAktif.id)" class="text-sm text-error">
                    {{ kotorDiSoal(soalAktif.id) }} nilai di soal ini belum disimpan. Simpan dulu (draf atau setujui).
                  </span>
                  <button type="button" class="btn btn-sm" :disabled="sibuk || kotorDiSoal(soalAktif.id) > 0" @click="setujuiSemua(soalAktif)">
                    <i class="fa-solid fa-check-double" aria-hidden="true"></i> Setujui semua draf soal ini
                  </button>
                </div>
              </div>
            </section>

            <template v-if="soalAktif">
              <article v-for="p in data.peserta" :key="`${p.id}-${soalAktif.id}`" class="card bg-base-100 shadow">
                <div class="card-body gap-3">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3 class="font-semibold flex-1">{{ p.nama }} <span v-if="p.nomor" class="text-base-content/50">({{ p.nomor }})</span></h3>
                    <span class="badge" :class="statusJawaban(p.id, soalAktif.id).kelas">{{ statusJawaban(p.id, soalAktif.id).teks }}</span>
                    <span class="font-mono font-bold">{{ pratinjau(p.id, soalAktif) }}</span>
                  </div>
                  <p v-if="!(jawabanMap.get(`${p.id}:${soalAktif.id}`) ?? '').trim()" class="italic text-base-content/50">(tidak dijawab)</p>
                  <p v-else class="whitespace-pre-wrap break-words bg-base-200 rounded p-2">{{ jawabanMap.get(`${p.id}:${soalAktif.id}`) }}</p>
                  <div v-if="saran(p.id, soalAktif.id)?.status === 'perlu_manual'" role="status" class="alert alert-warning text-sm py-2">
                    <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                    <span>AI tidak bisa menilai jawaban ini ({{ saran(p.id, soalAktif.id)?.galat }}). Silakan nilai secara manual.</span>
                  </div>
                  <div v-if="saran(p.id, soalAktif.id)?.hasil?.indikasi_instruksi.ada" role="alert" class="alert alert-warning text-sm py-2">
                    <i class="fa-solid fa-flag" aria-hidden="true"></i>
                    <span>
                      AI menemukan kalimat yang ditujukan ke penilai di dalam jawaban ini (diabaikan saat menilai):
                      {{ saran(p.id, soalAktif.id)?.hasil?.indikasi_instruksi.keterangan }}
                    </span>
                  </div>

                  <fieldset :disabled="!bolehNilai || sibuk" class="flex flex-col gap-3">
                    <div v-for="kr in soalAktif.rubrik.kriteria" :key="kr.id" class="flex flex-col gap-1">
                      <p class="text-sm font-medium">{{ kr.nama }} <span class="text-base-content/60">(bobot {{ kr.bobot }})</span></p>
                      <div class="flex flex-wrap gap-2">
                        <label
                          v-for="l in [...kr.level].sort((x, y) => x.skor - y.skor)"
                          :key="l.skor"
                          class="flex items-start gap-2 border rounded-box px-2 py-1 cursor-pointer text-sm max-w-md"
                          :class="isianDari(p.id, soalAktif.id).skor[kr.id] === l.skor ? 'border-primary bg-primary/10' : 'border-base-300'"
                        >
                          <input
                            type="radio"
                            class="radio radio-sm mt-0.5"
                            :name="`${p.id}-${soalAktif.id}-${kr.id}`"
                            :checked="isianDari(p.id, soalAktif.id).skor[kr.id] === l.skor"
                            @change="pilihLevel(p.id, soalAktif, kr.id, l.skor)"
                          />
                          <span><strong>{{ l.skor }}/{{ skorMaks(kr) }}</strong> · {{ l.deskriptor }}</span>
                        </label>
                      </div>
                      <div v-if="saran(p.id, soalAktif.id)?.hasil?.kriteria[kr.id]" class="text-xs bg-info/10 rounded p-2 flex flex-col gap-1">
                        <p>
                          <i class="fa-solid fa-wand-magic-sparkles text-info" aria-hidden="true"></i>
                          <strong> Saran AI: {{ saran(p.id, soalAktif.id)?.hasil?.skor[kr.id] }}/{{ skorMaks(kr) }}.</strong>
                          {{ saran(p.id, soalAktif.id)?.hasil?.kriteria[kr.id]?.alasan }}
                        </p>
                        <p v-for="(q, qi) in saran(p.id, soalAktif.id)?.hasil?.kriteria[kr.id]?.kutipan ?? []" :key="qi" class="italic text-base-content/70">
                          Bukti: "{{ q }}"
                        </p>
                      </div>
                    </div>
                    <label class="flex flex-col gap-1">
                      <span class="text-sm">Catatan untuk siswa (opsional, terlihat setelah rilis)</span>
                      <textarea
                        :value="isianDari(p.id, soalAktif.id).catatan"
                        class="textarea w-full h-16"
                        maxlength="2000"
                        @input="ubahCatatan(p.id, soalAktif.id, ($event.target as HTMLTextAreaElement).value)"
                      ></textarea>
                    </label>
                    <div v-if="bolehNilai" class="flex flex-wrap gap-2 justify-end">
                      <button type="button" class="btn btn-sm" @click="simpan(p.id, soalAktif, false)">Simpan draf</button>
                      <button type="button" class="btn btn-sm btn-success" @click="simpan(p.id, soalAktif, true)">
                        <i class="fa-solid fa-check" aria-hidden="true"></i> Simpan & setujui
                      </button>
                    </div>
                  </fieldset>
                </div>
              </article>
              <p v-if="data.peserta.length === 0" class="text-base-content/60">Tidak ada siswa yang mengumpulkan jawaban.</p>
            </template>
          </template>

          <!-- Rekap -->
          <section v-else class="card bg-base-100 shadow">
            <div class="card-body overflow-x-auto">
              <table class="table table-sm">
                <thead>
                  <tr>
                    <th>Nama</th>
                    <th v-for="s in data.soal" :key="s.id" class="text-right">Soal {{ s.urutan }}<br /><span class="font-normal">bobot {{ s.bobot }}</span></th>
                    <th class="text-right">Nilai akhir</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in data.peserta" :key="p.id">
                    <td>{{ p.nama }}</td>
                    <td v-for="s in data.soal" :key="s.id" class="text-right font-mono">
                      {{ nilaiTersetujui(p.id, s) === null ? '–' : angka(persenSoal(nilaiTersetujui(p.id, s) as number)) }}
                    </td>
                    <td class="text-right font-mono font-bold">{{ nilaiAkhir(p.id) }}</td>
                  </tr>
                  <tr v-for="p in data.tidak_hadir" :key="p.id" class="text-base-content/50">
                    <td>{{ p.nama }}</td>
                    <td v-for="s in data.soal" :key="s.id"></td>
                    <td class="text-right italic">tidak hadir</td>
                  </tr>
                </tbody>
              </table>
              <p class="text-xs text-base-content/60">Angka per soal = persen nilai soal (0–100). Nilai akhir memakai bobot soal. "–" = belum disetujui.</p>
            </div>
          </section>
        </template>
      </template>
    </main>
  </div>
</template>
