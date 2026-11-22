<!--
  client/src/halaman/UjianPeserta.vue — halaman siswa setelah masuk (alamat "/ujian"). Satu halaman yang isinya
  mengikuti status: ditutup kembali (draf) → ruang tunggu → mengerjakan → ringkasan → nilai (docs/DESAIN.md §10).
  Dipanggil oleh: client/src/router.ts.
  Memanggil: GET /api/peserta/ujian, POST /api/peserta/tab, SSE /api/peserta/stream, PUT /api/peserta/jawaban/:id
             (lewat client/src/autosave.ts), POST /api/peserta/kumpulkan, GET /api/peserta/saya, POST /api/peserta/keluar;
             komponen di client/src/komponen/peserta/.
  Urutan saat dimuat (docs/DESAIN.md §5): ambil data ujian → klaim tab aktif → BARU buka aliran SSE.
  Waktu: sisa_ms dari server, lalu dihitung mundur dengan jam monoton browser (performance.now), sehingga jam
  laptop yang salah atau diubah tidak berpengaruh. Diselaraskan ulang setiap event `waktu` (tiap 30 dtk & saat
  jeda/lanjut/sambung ulang).
  Integritas (Fase 5, docs/DESAIN.md §6): sinyal halaman (tab tersembunyi, jendela tidak aktif, keluar layar penuh)
  diteruskan ke client/src/integritas.ts yang melapor ke POST /api/peserta/event. Teks yang keluar dari halaman
  (copy/cut/seret) dicatat sidiknya (client/src/tempel.ts); menempel ke kotak jawaban teks dari luar halaman
  diblokir dan upayanya dicatat (panjangnya saja). Selama mengerjakan: layar penuh wajib (penutup editor) dan
  layar dijaga tetap menyala (Screen Wake Lock).
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import { GalatSchema, PesertaSayaSchema } from '../../../shared/auth.ts';
import type { PesertaSaya } from '../../../shared/auth.ts';
import { SimpanHasilSchema, SseSesiDicabutSchema, UjianPesertaSchema, WaktuSchema } from '../../../shared/peserta.ts';
import type { AlasanSesiDicabut, UjianPeserta, Waktu } from '../../../shared/peserta.ts';
import type { JenisKepergian, LaporanEvent } from '../../../shared/pantau.ts';
import { api, GalatApi, pesanGalat } from '../api.ts';
import { buatAutosave } from '../autosave.ts';
import { buatPencatat } from '../integritas.ts';
import type { HasilLapor, Pencatat, Sinyal } from '../integritas.ts';
import { layarPenuh, layarPenuhDidukung, masukLayarPenuh } from '../layar-penuh.ts';
import { buatHimpunanSalin } from '../tempel.ts';
import type { HimpunanSalin } from '../tempel.ts';
import type { Autosave, Bentrok, HasilKirim, Kiriman, Penyimpanan } from '../autosave.ts';
import DialogBentrok from '../komponen/peserta/DialogBentrok.vue';
import Pengerjaan from '../komponen/peserta/Pengerjaan.vue';
import RuangTunggu from '../komponen/peserta/RuangTunggu.vue';
import { uuid } from '../uuid.ts';

type Tahap = 'memuat' | 'draf' | 'siap' | 'galat';

const router = useRouter();
// Setiap tab/jendela punya ID sendiri; hanya tab aktif yang boleh menyimpan (docs/DESAIN.md §5).
const tabId = uuid();
const tahap = ref<Tahap>('memuat');
const ujian = ref<UjianPeserta | null>(null);
const saya = ref<PesertaSaya | null>(null);
const galat = ref('');
const tabLain = ref(false);
const sesiDicabut = ref<AlasanSesiDicabut | 'berakhir' | null>(null);
const koneksiPutus = ref(false);
const autosave = shallowRef<Autosave | null>(null);
const versiAutosave = ref(0);
const antreanBentrok = ref<Bentrok[]>([]);
const mengumpulkan = ref(false);
const galatKumpul = ref('');
const tertahanDiLaptop = ref(0);
const penyimpananGagal = ref(false);
// Autosave baru boleh mengirim setelah tab ini diklaim (docs/DESAIN.md §5): kiriman yang tiba di server
// sebelum klaim akan ditolak "tab_tidak_aktif" dan memunculkan layar "tab lain" palsu.
let tabDiklaim = false;

// ---- Waktu ----
const acuanWaktu = ref({ sisaMs: 0, dijeda: false, jamServer: 0, t: performance.now() });
const kini = ref(performance.now());
const sisaMs = computed(() =>
  acuanWaktu.value.dijeda ? acuanWaktu.value.sisaMs : acuanWaktu.value.sisaMs - (kini.value - acuanWaktu.value.t),
);
function setelWaktu(w: Waktu): void {
  acuanWaktu.value = { sisaMs: w.sisa_ms, dijeda: w.dijeda, jamServer: w.jam_server, t: performance.now() };
}
// Perkiraan jam SERVER sekarang (untuk waktu kejadian laporan aktivitas), tanpa memakai jam laptop.
function jamServerKini(): number {
  return acuanWaktu.value.jamServer + (performance.now() - acuanWaktu.value.t);
}

const mengerjakan = computed(
  () =>
    !!ujian.value &&
    (ujian.value.status === 'berlangsung' || ujian.value.status === 'dijeda') &&
    ujian.value.saya.status === 'mengerjakan',
);
const waktuHabis = computed(() => mengerjakan.value && ujian.value?.status === 'berlangsung' && sisaMs.value <= 0);
const kunci = computed<string | null>(() => {
  if (tabLain.value) return 'Ujian sedang dibuka di tab lain.';
  if (ujian.value?.status === 'dijeda') {
    return 'Ujian dijeda pengawas. Soal tetap bisa dibaca; jawabanmu aman dan bisa diketik lagi saat ujian dilanjutkan.';
  }
  if (waktuHabis.value) return 'Waktu habis. Jawaban yang sudah tersimpan sedang dikumpulkan otomatis.';
  return null;
});
const bentrokAktif = computed(() => antreanBentrok.value[0] ?? null);
const judulBentrok = computed(() => {
  const id = bentrokAktif.value?.soalId;
  return ujian.value?.soal?.find((s) => s.id === id)?.judul ?? 'soal ini';
});
const terjawab = computed(() => ujian.value?.jawaban?.filter((j) => j.isi.trim() !== '').length ?? 0);
const terlambatDiLaptop = computed(() => {
  void versiAutosave.value;
  return autosave.value?.jumlahTerlambat() ?? 0;
});
// Teks yang belum sampai ke server (mis. Wi-Fi putus di menit terakhir). Tetap dikirim otomatis; siswa diminta
// tidak menutup laptop sebelum angkanya 0.
const tertundaDiLaptop = computed(() => {
  void versiAutosave.value;
  return autosave.value?.jumlahTertunda() ?? 0;
});

// ---- Penyimpanan lokal (localStorage) ----
const penyimpananLokal: Penyimpanan = {
  ambil: (k) => localStorage.getItem(k),
  tulis: (k, v) => localStorage.setItem(k, v),
  hapus: (k) => localStorage.removeItem(k),
  semuaKunci: () => {
    const hasil: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k !== null) hasil.push(k);
    }
    return hasil;
  },
};

const awalanLokal = (u: UjianPeserta): string => `ujian:${u.id}:peserta:${u.saya.id}:`;

// ---- Kirim jawaban (dipakai autosave) ----
async function kirimJawaban(soalId: number, kiriman: Kiriman): Promise<HasilKirim> {
  const batas = new AbortController();
  // Permintaan yang menggantung (Wi-Fi lemah) dianggap gagal setelah 15 dtk, lalu dikirim ulang sama persis.
  const pewaktu = setTimeout(() => batas.abort(), 15_000);
  try {
    const r = await fetch(`/api/peserta/jawaban/${soalId}`, {
      method: 'PUT',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Tab-Id': tabId },
      body: JSON.stringify(kiriman),
      signal: batas.signal,
    });
    if (r.status === 200) return { jenis: 'ok', versi: SimpanHasilSchema.parse(await r.json()).versi };
    if (r.status === 202) return { jenis: 'terlambat' };
    // 5xx (termasuk 502 dari nginx saat server dimulai ulang) = sementara; kirim ulang.
    if (r.status >= 500) return { jenis: 'jaringan' };
    const isi = GalatSchema.safeParse(await r.json().catch(() => ({})));
    const kode = isi.success ? isi.data.error : 'kesalahan_server';
    if (kode === 'versi_bentrok' && isi.success) {
      return { jenis: 'bentrok', versi: isi.data.versi ?? 0, isi: isi.data.isi ?? '', ditandai: isi.data.ditandai ?? false };
    }
    if (kode === 'dijeda') return { jenis: 'dijeda' };
    if (kode === 'tab_tidak_aktif') return { jenis: 'tab_tidak_aktif' };
    if (kode === 'permintaan_terputus') return { jenis: 'jaringan' };
    return { jenis: 'ditolak', kode };
  } catch {
    return { jenis: 'jaringan' };
  } finally {
    clearTimeout(pewaktu);
  }
}

function siapkanAutosave(u: UjianPeserta): void {
  const as = buatAutosave({
    awalan: awalanLokal(u),
    kirim: kirimJawaban,
    penyimpanan: penyimpananLokal,
    uuid,
    jam: Date.now,
    saatBerubah: () => {
      versiAutosave.value += 1;
    },
    saatBentrok: (b) => {
      antreanBentrok.value = [...antreanBentrok.value.filter((x) => x.soalId !== b.soalId), b];
    },
    saatTabTidakAktif: () => {
      tabLain.value = true;
      tutupAliran();
    },
    saatDitolak: (kode) => {
      if (kode === 'belum_masuk') sesiBerakhir('berakhir');
    },
    saatPenyimpananGagal: () => {
      penyimpananGagal.value = true;
    },
    aktif: tabDiklaim,
  });
  autosave.value = as;
  as.muat(u.jawaban ?? [], u.saya.status === 'mengerjakan');
  versiAutosave.value += 1;
}

// Laptop sekolah dipakai bergantian: setelah ujian dinilai, penyangga ujian ini dihapus — kecuali teks yang
// belum pernah sampai ke server (dibiarkan & diberitahukan, supaya bisa ditunjukkan ke guru).
function bersihkanLaptop(u: UjianPeserta): void {
  const awalan = awalanLokal(u);
  try {
    const semua = penyimpananLokal.semuaKunci().filter((k) => k.startsWith(awalan));
    const tertunda = semua.filter((k) => {
      if (!k.startsWith(`${awalan}soal:`)) return false;
      try {
        return !(JSON.parse(penyimpananLokal.ambil(k) ?? '{}') as { terkirim_terlambat?: boolean }).terkirim_terlambat;
      } catch {
        return false;
      }
    });
    if (tertunda.length === 0) for (const k of semua) penyimpananLokal.hapus(k);
    tertahanDiLaptop.value = tertunda.length;
  } catch {
    tertahanDiLaptop.value = 0;
  }
}

function terapkan(data: UjianPeserta): void {
  const lama = ujian.value;
  ujian.value = data;
  setelWaktu(data.waktu);
  if (data.jawaban && !autosave.value) siapkanAutosave(data);
  const as = autosave.value;
  if (as && lama && lama.saya.status === 'dikumpulkan' && data.saya.status === 'mengerjakan') as.bukaKembali();
  // Setiap kali ujian terlihat berlangsung, teks yang tertahan (dijeda/ditolak) dikirim lagi. Tidak bergantung
  // pada "melihat" peralihan dijeda → berlangsung, yang bisa terlewat bila SSE baru tersambung setelah
  // Lanjutkan. Aman dipanggil berulang.
  if (as && data.status === 'berlangsung' && data.saya.status === 'mengerjakan' && !tabLain.value) as.lanjutkan();
  if (data.status === 'penilaian' || data.status === 'dirilis') bersihkanLaptop(data);
  // Himpunan salin murni lokal: disiapkan tanpa menunggu klaim tab, supaya blokir tempel selalu berlaku.
  if (!himpunan) himpunan = buatHimpunanSalin(`${awalanLokal(data)}salin`, penyimpananLokal);
  // Halaman yang tadinya di layar "ditutup kembali" (tanpa data ujian) baru bisa menyiapkan pencatat sekarang.
  if (tabDiklaim && !pencatat) siapkanIntegritas();
}

async function muat(): Promise<void> {
  try {
    terapkan(await api('GET', '/api/peserta/ujian', { skema: UjianPesertaSchema }));
    tahap.value = 'siap';
  } catch (e) {
    if (e instanceof GalatApi && e.status === 401) {
      sesiBerakhir('berakhir');
      return;
    }
    if (e instanceof GalatApi && e.kode === 'status_tidak_sesuai') {
      // Ujian ditutup kembali oleh guru (draf): tidak ada isi ujian; hanya nama & judul.
      try {
        saya.value = await api('GET', '/api/peserta/saya', { skema: PesertaSayaSchema });
        ujian.value = null;
        tahap.value = 'draf';
      } catch (e2) {
        if (e2 instanceof GalatApi && e2.status === 401) sesiBerakhir('berakhir');
      }
      return;
    }
    // Gagal memuat ulang di tengah ujian: tampilan lama dipertahankan; event berikutnya mencoba lagi.
    if (tahap.value === 'memuat') {
      galat.value = pesanGalat(e);
      tahap.value = 'galat';
    }
  }
}

let pewaktuMuat: ReturnType<typeof setTimeout> | undefined;
// Beberapa event `status` berdekatan (mis. tersambung + Mulai) cukup memicu satu kali muat ulang.
function jadwalkanMuat(): void {
  clearTimeout(pewaktuMuat);
  pewaktuMuat = setTimeout(() => void muat(), 300);
}

// ---- Tab aktif & aliran SSE ----
async function klaimTab(): Promise<boolean> {
  try {
    await api('POST', '/api/peserta/tab', { body: { tab_id: tabId } });
    tabDiklaim = true;
    autosave.value?.aktifkan();
    siapkanIntegritas();
    return true;
  } catch (e) {
    if (e instanceof GalatApi && e.status === 401) sesiBerakhir('berakhir');
    return false;
  }
}

// Klaim tab bisa gagal (mis. Wi-Fi putus sesaat setelah halaman dimuat). Tanpa klaim, jawaban tidak terkirim dan
// aliran SSE tidak dibuka, jadi dicoba ulang (2 → 30 dtk) sambil menampilkan pesan koneksi terputus.
let jedaKlaim = 2000;
let pewaktuKlaim: ReturnType<typeof setTimeout> | undefined;
async function klaimLaluSambung(): Promise<void> {
  clearTimeout(pewaktuKlaim);
  if (await klaimTab()) {
    jedaKlaim = 2000;
    bukaAliran();
    return;
  }
  if (sesiDicabut.value || tabLain.value) return;
  koneksiPutus.value = true;
  pewaktuKlaim = setTimeout(() => void klaimLaluSambung(), jedaKlaim);
  jedaKlaim = Math.min(jedaKlaim * 2, 30_000);
}

let aliran: EventSource | null = null;
let pewaktuSambung: ReturnType<typeof setTimeout> | undefined;

function tutupAliran(): void {
  clearTimeout(pewaktuSambung);
  aliran?.close();
  aliran = null;
}

function dataEvent(ev: Event): unknown {
  try {
    return JSON.parse((ev as MessageEvent<string>).data);
  } catch {
    return null;
  }
}

function bukaAliran(): void {
  tutupAliran();
  const es = new EventSource(`/api/peserta/stream?tab=${encodeURIComponent(tabId)}`);
  aliran = es;
  es.addEventListener('status', () => jadwalkanMuat());
  es.addEventListener('waktu', (ev) => {
    const w = WaktuSchema.safeParse(dataEvent(ev));
    if (w.success) setelWaktu(w.data);
  });
  // Event penutup: aliran ditutup dan TIDAK disambung ulang otomatis.
  es.addEventListener('tab_lain_aktif', () => {
    tutupAliran();
    autosave.value?.nonaktifkan();
    tabLain.value = true;
  });
  es.addEventListener('sesi_dicabut', (ev) => {
    const d = SseSesiDicabutSchema.safeParse(dataEvent(ev));
    sesiBerakhir(d.success ? d.data.alasan : 'berakhir');
  });
  es.onopen = () => {
    koneksiPutus.value = false;
    // Koneksi pulih: kiriman yang menunggu jeda kirim ulang langsung dicoba.
    autosave.value?.kirimSemuaSekarang();
    pencatat?.kirimSekarang();
  };
  es.onerror = () => {
    koneksiPutus.value = true;
    // CONNECTING = browser menyambung ulang sendiri. CLOSED = ditolak permanen (mis. 401 atau 502 saat server
    // dimulai ulang): sesi dicek, lalu dicoba lagi 5 dtk kemudian.
    if (es.readyState !== EventSource.CLOSED) return;
    tutupAliran();
    void cekSesiLaluSambung();
  };
}

async function cekSesiLaluSambung(): Promise<void> {
  try {
    await api('GET', '/api/peserta/saya');
  } catch (e) {
    if (e instanceof GalatApi && e.status === 401) {
      sesiBerakhir('berakhir');
      return;
    }
  }
  pewaktuSambung = setTimeout(() => {
    if (!tabLain.value && !sesiDicabut.value) {
      bukaAliran();
      jadwalkanMuat();
    }
  }, 5000);
}

// Memuat ulang halaman: tab ini mengklaim ulang dengan ID baru dan membaca penyangga terbaru dari localStorage
// (mungkin sudah diubah tab lain), bukan memakai salinan lama di memori tab ini.
function lanjutkanDiTabIni(): void {
  window.location.reload();
}

function sesiBerakhir(alasan: AlasanSesiDicabut | 'berakhir'): void {
  tutupAliran();
  autosave.value?.hentikan();
  pencatat?.hentikan();
  sesiDicabut.value = alasan;
}

const PESAN_SESI: Record<AlasanSesiDicabut | 'berakhir', string> = {
  diambil_alih: 'Namamu baru saja dipakai masuk dari laptop atau browser lain. Bila itu bukan kamu, beri tahu guru.',
  direset_penguji: 'Guru mereset PIN-mu. Masuk lagi dan buat PIN baru.',
  keluar: 'Kamu sudah keluar dari ujian.',
  dihapus_penguji: 'Namamu atau ujian ini dihapus dari daftar oleh guru. Tanyakan ke guru.',
  berakhir: 'Sesi sudah berakhir. Silakan masuk lagi dengan nama & PIN yang sama.',
};

// ---- Integritas (docs/DESAIN.md §6) ----
let pencatat: Pencatat | null = null;
let himpunan: HimpunanSalin | null = null;
// Peringatan netral saat siswa kembali (aturan keras #3: tanpa kata "curang").
const peringatan = ref<{ durasiMs: number; jenis: JenisKepergian } | null>(null);
const tempelDiblokir = ref(false);
let pewaktuTempel: ReturnType<typeof setTimeout> | undefined;
const layarPenuhDitolak = ref(false);

// `tabDiklaim` (let biasa) dipakai autosave; versi ref ini agar computed di bawah ikut berubah.
const tabDiklaimRef = ref(false);
// Kepergian hanya dicatat saat ujian berlangsung, siswa mengerjakan, dan tab ini tab aktif.
const integritasAktif = computed(
  () =>
    tabDiklaimRef.value &&
    !tabLain.value &&
    !sesiDicabut.value &&
    ujian.value?.status === 'berlangsung' &&
    ujian.value.saya.status === 'mengerjakan',
);
// Penutup editor: layar penuh wajib selama mengerjakan (bukan saat dijeda/ruang tunggu).
const perluLayarPenuh = computed(
  () =>
    layarPenuhDidukung &&
    !layarPenuhDitolak.value &&
    !layarPenuh.value &&
    mengerjakan.value &&
    ujian.value?.status === 'berlangsung' &&
    !tabLain.value &&
    !sesiDicabut.value,
);

async function kirimLaporan(laporan: LaporanEvent): Promise<HasilLapor> {
  const batas = new AbortController();
  const pewaktu = setTimeout(() => batas.abort(), 15_000);
  try {
    const r = await fetch('/api/peserta/event', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Tab-Id': tabId },
      body: JSON.stringify(laporan),
      signal: batas.signal,
    });
    // 5xx (mis. server dimulai ulang) = sementara, dicoba lagi. 4xx = tidak akan pernah diterima; dibuang.
    return r.status >= 500 ? 'gagal' : 'ok';
  } catch {
    return 'gagal';
  } finally {
    clearTimeout(pewaktu);
  }
}

function siapkanIntegritas(): void {
  tabDiklaimRef.value = true;
  const u = ujian.value;
  if (!u || pencatat) return;
  const awalan = awalanLokal(u);
  pencatat = buatPencatat({
    awalan,
    penyimpanan: penyimpananLokal,
    kirim: kirimLaporan,
    uuid,
    jamServer: jamServerKini,
    monoton: () => performance.now(),
    aktif: () => integritasAktif.value,
    saatKembali: (durasiMs, jenis) => {
      peringatan.value = { durasiMs, jenis };
    },
  });
  himpunan ??= buatHimpunanSalin(`${awalan}salin`, penyimpananLokal);
  // Keadaan awal halaman (mis. dimuat ulang saat tab tidak aktif atau jendela lain sedang aktif).
  segarkanPencatat();
}

function segarkanPencatat(): void {
  pencatat?.segarkan({ tersembunyi: document.visibilityState === 'hidden', fokus: document.hasFocus() });
}
// Pencatatan baru aktif (Mulai, Lanjutkan, dibuka kembali): keadaan halaman dibaca ulang, supaya siswa yang sudah
// berada di luar halaman saat itu tetap tercatat (sejak saat aktif).
watch(integritasAktif, (aktif) => {
  if (aktif) segarkanPencatat();
});
// Tab lain mengambil alih: tab ini berhenti mencatat & tidak lagi menulis antrean/kepergian di localStorage
// (kuncinya dipakai bersama oleh semua tab ujian ini).
watch(tabLain, (lain) => {
  if (lain) pencatat?.hentikan();
});
// Layar penuh berhasil lagi: penutup kembali berlaku normal.
watch(layarPenuh, (penuh) => {
  if (penuh) layarPenuhDitolak.value = false;
});

function kirimSinyal(s: Sinyal): void {
  pencatat?.sinyal(s);
}
function saatVisibilitas(): void {
  kirimSinyal(document.visibilityState === 'hidden' ? 'tersembunyi' : 'terlihat');
  void aturWakeLock(mengerjakan.value);
}
function saatBlur(): void {
  kirimSinyal('blur');
}
function saatFokus(): void {
  kirimSinyal('fokus');
}
function saatLayarPenuh(): void {
  kirimSinyal(document.fullscreenElement ? 'masuk_layar_penuh' : 'keluar_layar_penuh');
}

function teksTerpilih(target: EventTarget | null): { teks: string; dariEditor: boolean } {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    return { teks: target.value.substring(target.selectionStart ?? 0, target.selectionEnd ?? 0), dariEditor: true };
  }
  return { teks: document.getSelection()?.toString() ?? '', dariEditor: false };
}

// copy/cut: teks yang keluar dari halaman dicatat sidiknya. Di luar kotak jawaban (soal, buku PDF), halaman
// sendiri yang menulis clipboard, supaya isinya persis sama dengan yang di-hash (docs/DESAIN.md §6).
function saatSalin(e: ClipboardEvent): void {
  const { teks, dariEditor } = teksTerpilih(e.target);
  if (!teks) return;
  himpunan?.catat(teks);
  if (!dariEditor && e.clipboardData) {
    e.clipboardData.setData('text/plain', teks);
    e.preventDefault();
  }
}
function saatSeret(e: DragEvent): void {
  const { teks, dariEditor } = teksTerpilih(e.target);
  if (!teks) return;
  himpunan?.catat(teks);
  if (!dariEditor) e.dataTransfer?.setData('text/plain', teks);
}

function kotakJawaban(target: EventTarget | null): boolean {
  return target instanceof HTMLTextAreaElement && target.dataset.jawaban === '1';
}
function tolakTempel(e: Event, teks: string): void {
  if (!himpunan || himpunan.boleh(teks)) return;
  e.preventDefault();
  pencatat?.tempel(teks.length);
  tempelDiblokir.value = true;
  clearTimeout(pewaktuTempel);
  pewaktuTempel = setTimeout(() => {
    tempelDiblokir.value = false;
  }, 6000);
}
function saatTempel(e: ClipboardEvent): void {
  if (kotakJawaban(e.target)) tolakTempel(e, e.clipboardData?.getData('text/plain') ?? '');
}
function saatJatuh(e: DragEvent): void {
  if (kotakJawaban(e.target)) tolakTempel(e, e.dataTransfer?.getData('text/plain') ?? '');
}

function pasangPendengarIntegritas(): void {
  document.addEventListener('visibilitychange', saatVisibilitas);
  window.addEventListener('blur', saatBlur);
  window.addEventListener('focus', saatFokus);
  document.addEventListener('fullscreenchange', saatLayarPenuh);
  // Fase tangkap (capture): diproses sebelum elemen lain sempat menghentikannya.
  document.addEventListener('copy', saatSalin, true);
  document.addEventListener('cut', saatSalin, true);
  document.addEventListener('dragstart', saatSeret, true);
  document.addEventListener('paste', saatTempel, true);
  document.addEventListener('drop', saatJatuh, true);
}
function lepasPendengarIntegritas(): void {
  document.removeEventListener('visibilitychange', saatVisibilitas);
  window.removeEventListener('blur', saatBlur);
  window.removeEventListener('focus', saatFokus);
  document.removeEventListener('fullscreenchange', saatLayarPenuh);
  document.removeEventListener('copy', saatSalin, true);
  document.removeEventListener('cut', saatSalin, true);
  document.removeEventListener('dragstart', saatSeret, true);
  document.removeEventListener('paste', saatTempel, true);
  document.removeEventListener('drop', saatJatuh, true);
  clearTimeout(pewaktuTempel);
}

async function kembaliLayarPenuh(): Promise<void> {
  if (await masukLayarPenuh()) return;
  // Browser menolak (kebijakan perangkat): siswa tetap bisa mengerjakan, tombol "Layar penuh" di atas tetap ada
  // untuk mencoba lagi, dan kepergian "keluar layar penuh" yang sedang berjalan bisa berakhir.
  layarPenuhDitolak.value = true;
  pencatat?.abaikanLayarPenuh();
}

// Screen Wake Lock: layar tidak mati selama siswa lama membaca soal/buku. Dilepas browser saat tab tersembunyi,
// jadi diminta lagi setiap halaman terlihat.
let kunciLayar: WakeLockSentinel | null = null;
async function aturWakeLock(perlu: boolean): Promise<void> {
  try {
    if (perlu && document.visibilityState === 'visible' && !kunciLayar && 'wakeLock' in navigator) {
      const kunciBaru = await navigator.wakeLock.request('screen');
      kunciBaru.addEventListener('release', () => {
        if (kunciLayar === kunciBaru) kunciLayar = null;
      });
      kunciLayar = kunciBaru;
    } else if (!perlu && kunciLayar) {
      const lama = kunciLayar;
      kunciLayar = null;
      await lama.release();
    }
  } catch {
    // Tidak didukung / ditolak (mis. mode hemat daya): tidak mengganggu ujian.
  }
}
watch(mengerjakan, (m) => void aturWakeLock(m));

function formatLama(ms: number): string {
  const detik = Math.max(1, Math.round(ms / 1000));
  if (detik < 60) return `${detik} detik`;
  const menit = Math.floor(detik / 60);
  const sisa = detik % 60;
  return sisa === 0 ? `${menit} menit` : `${menit} menit ${sisa} detik`;
}

// ---- Aksi ----
async function kumpulkan(): Promise<void> {
  const as = autosave.value;
  if (!as) return;
  galatKumpul.value = '';
  mengumpulkan.value = true;
  try {
    await api('POST', '/api/peserta/kumpulkan', { body: { versi: as.versiServer() }, header: { 'X-Tab-Id': tabId } });
    await muat();
  } catch (e) {
    if (e instanceof GalatApi && e.kode === 'tab_tidak_aktif') tabLain.value = true;
    galatKumpul.value = pesanGalat(e);
  } finally {
    mengumpulkan.value = false;
  }
}

function pilihBentrok(pilihan: 'server' | 'laptop'): void {
  const b = bentrokAktif.value;
  if (!b) return;
  autosave.value?.pilihBentrok(b.soalId, pilihan);
  antreanBentrok.value = antreanBentrok.value.slice(1);
}

async function keluar(): Promise<void> {
  tutupAliran();
  try {
    await api('POST', '/api/peserta/keluar');
  } finally {
    await router.replace('/');
  }
}

// Waktu habis: semua ketikan yang masih menunggu langsung dikirim (masih diterima sampai 10 dtk).
watch(waktuHabis, (habis) => {
  if (habis) autosave.value?.kirimSemuaSekarang();
});

// ---- Siklus halaman ----
let detik: ReturnType<typeof setInterval> | undefined;
function saatOnline(): void {
  autosave.value?.kirimSemuaSekarang();
  pencatat?.kirimSekarang();
}
// Peringatan browser bila halaman ditutup saat masih ada jawaban yang belum sampai ke server.
// (Teksnya tetap aman di laptop ini; peringatan hanya mencegah siswa pindah laptop tanpa sadar.)
function saatTutup(e: BeforeUnloadEvent): void {
  if ((autosave.value?.jumlahTertunda() ?? 0) > 0) e.preventDefault();
}

onMounted(async () => {
  detik = setInterval(() => {
    kini.value = performance.now();
  }, 250);
  window.addEventListener('online', saatOnline);
  window.addEventListener('beforeunload', saatTutup);
  pasangPendengarIntegritas();
  await muat();
  if (sesiDicabut.value || tahap.value === 'galat') return;
  await klaimLaluSambung();
});

onBeforeUnmount(() => {
  clearInterval(detik);
  clearTimeout(pewaktuMuat);
  clearTimeout(pewaktuKlaim);
  window.removeEventListener('online', saatOnline);
  window.removeEventListener('beforeunload', saatTutup);
  lepasPendengarIntegritas();
  pencatat?.hentikan();
  void aturWakeLock(false);
  tutupAliran();
  autosave.value?.hentikan();
});

async function ulangiMuat(): Promise<void> {
  tahap.value = 'memuat';
  galat.value = '';
  await muat();
  // `muat()` bisa mengubah tahap; TypeScript tidak tahu, jadi dibaca ulang sebagai Tahap.
  const hasil: Tahap = tahap.value as Tahap;
  if (hasil !== 'galat' && !sesiDicabut.value) await klaimLaluSambung();
}
</script>

<template>
  <div>
    <main v-if="tahap === 'memuat'" class="min-h-screen bg-base-200 flex items-center justify-center gap-2">
      <span class="loading loading-spinner"></span> Memuat ujian…
    </main>

    <main v-else-if="tahap === 'galat'" class="min-h-screen bg-base-200 flex items-center justify-center p-4">
      <div role="alert" class="alert alert-error max-w-lg">
        <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
        <span>{{ galat }}</span>
        <button class="btn btn-sm" type="button" @click="ulangiMuat">Coba lagi</button>
      </div>
    </main>

    <main v-else-if="tahap === 'draf'" class="min-h-screen bg-base-200 flex items-center justify-center p-4">
      <div class="card bg-base-100 shadow-xl w-full max-w-lg">
        <div class="card-body gap-3">
          <p class="text-sm text-base-content/60">{{ saya?.ujian.judul }}</p>
          <h1 class="card-title">{{ saya?.nama }}</h1>
          <div role="status" class="alert">
            <i class="fa-solid fa-door-closed" aria-hidden="true"></i>
            <span>Ujian ditutup kembali oleh guru. Tunggu di sini — halaman ini lanjut sendiri saat ujian dibuka lagi.</span>
          </div>
          <button class="btn btn-ghost btn-sm self-start" type="button" @click="keluar">
            <i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i> Keluar
          </button>
        </div>
      </div>
    </main>

    <template v-else-if="ujian">
      <RuangTunggu v-if="ujian.status === 'menunggu'" :ujian="ujian" @keluar="keluar" />

      <Pengerjaan
        v-else-if="mengerjakan && autosave"
        :ujian="ujian"
        :autosave="autosave"
        :versi="versiAutosave"
        :sisa-ms="sisaMs"
        :kunci="kunci"
        :mengumpulkan="mengumpulkan"
        :galat-kumpul="galatKumpul"
        @kumpulkan="kumpulkan"
      />

      <main v-else class="min-h-screen bg-base-200 flex items-center justify-center p-4">
        <div class="card bg-base-100 shadow-xl w-full max-w-lg">
          <div class="card-body gap-3">
            <p class="text-sm text-base-content/60">{{ ujian.judul }}</p>
            <h1 class="card-title">{{ ujian.saya.nama }}</h1>
            <template v-if="ujian.status === 'penilaian'">
              <div role="status" class="alert alert-info">
                <i class="fa-solid fa-hourglass-half" aria-hidden="true"></i>
                <span>Jawaban sedang dinilai. Nilai belum dirilis.</span>
              </div>
            </template>
            <template v-else-if="ujian.status === 'dirilis'">
              <div role="status" class="alert alert-success">
                <i class="fa-solid fa-award" aria-hidden="true"></i>
                <span>Nilai sudah dirilis. Guru akan membahas hasilnya bersama kelas.</span>
              </div>
            </template>
            <template v-else-if="ujian.saya.status === 'dikumpulkan'">
              <div role="status" class="alert alert-success">
                <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
                <span>Jawabanmu sudah terkumpul. Terima kasih!</span>
              </div>
              <p v-if="ujian.jawaban">{{ terjawab }} dari {{ ujian.jumlah_soal }} soal terjawab.</p>
            </template>
            <template v-else>
              <div role="status" class="alert">
                <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
                <span>Ujian ini sudah berakhir sebelum kamu masuk. Tanyakan ke guru.</span>
              </div>
            </template>
            <div v-if="tertundaDiLaptop" role="alert" class="alert alert-warning">
              <span class="loading loading-spinner loading-sm"></span>
              <span>
                {{ tertundaDiLaptop }} teks jawaban belum sampai ke server dan sedang dikirim. Jangan tutup laptop
                sebelum pesan ini hilang; bila tidak hilang juga, beri tahu guru.
              </span>
            </div>
            <p v-if="terlambatDiLaptop" class="text-sm text-warning">
              <i class="fa-solid fa-clock" aria-hidden="true"></i>
              {{ terlambatDiLaptop }} jawaban terkirim setelah waktu habis. Guru yang memutuskan apakah dipakai.
            </p>
            <p v-if="tertahanDiLaptop" class="text-sm text-warning">
              <i class="fa-solid fa-laptop" aria-hidden="true"></i>
              Ada {{ tertahanDiLaptop }} teks jawaban yang belum sampai ke server dan masih tersimpan di laptop ini.
              Beri tahu guru sebelum menutup laptop.
            </p>
            <button class="btn btn-ghost btn-sm self-start" type="button" @click="keluar">
              <i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i> Keluar
            </button>
          </div>
        </div>
      </main>
    </template>

    <DialogBentrok v-if="bentrokAktif && !sesiDicabut" :bentrok="bentrokAktif" :judul-soal="judulBentrok" @pilih="pilihBentrok" />

    <!-- Penutup editor: layar penuh wajib selama mengerjakan (docs/DESAIN.md §6). -->
    <div
      v-if="perluLayarPenuh && !bentrokAktif"
      class="fixed inset-0 z-40 bg-base-300/95 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="judul-layar-penuh"
    >
      <div class="card bg-base-100 shadow-xl max-w-md">
        <div class="card-body gap-3 items-center text-center">
          <i class="fa-solid fa-expand text-4xl text-primary" aria-hidden="true"></i>
          <h2 id="judul-layar-penuh" class="card-title">Layar penuh wajib selama ujian</h2>
          <p>Tekan tombol di bawah untuk kembali ke layar penuh dan melanjutkan mengerjakan.</p>
          <button class="btn btn-primary btn-lg" type="button" @click="kembaliLayarPenuh">
            <i class="fa-solid fa-expand" aria-hidden="true"></i> Masuk layar penuh
          </button>
        </div>
      </div>
    </div>

    <dialog v-if="peringatan && !sesiDicabut && !perluLayarPenuh" class="modal modal-open" open aria-labelledby="judul-peringatan">
      <div class="modal-box">
        <h3 id="judul-peringatan" class="font-bold text-lg">
          <i class="fa-solid fa-circle-info text-warning" aria-hidden="true"></i> Kamu meninggalkan halaman ujian
        </h3>
        <p class="py-3">
          Kamu meninggalkan halaman ujian selama {{ formatLama(peringatan.durasiMs) }}. Aktivitas ini tercatat dan
          terlihat oleh pengawas.
        </p>
        <div class="modal-action">
          <button class="btn btn-primary" type="button" @click="peringatan = null">Lanjut mengerjakan</button>
        </div>
      </div>
    </dialog>

    <dialog v-if="tabLain && !sesiDicabut" class="modal modal-open" open aria-labelledby="judul-tab-lain">
      <div class="modal-box">
        <h3 id="judul-tab-lain" class="font-bold text-lg">
          <i class="fa-solid fa-window-restore" aria-hidden="true"></i> Ujian dilanjutkan di tab lain
        </h3>
        <p class="py-3">
          Ujianmu sedang dibuka di tab atau jendela lain. Hanya satu tab yang bisa menyimpan jawaban. Jawaban yang
          belum terkirim dari tab ini tetap aman.
        </p>
        <div class="modal-action">
          <button class="btn btn-primary" type="button" @click="lanjutkanDiTabIni">Lanjutkan di tab ini</button>
        </div>
      </div>
    </dialog>

    <dialog v-if="sesiDicabut" class="modal modal-open" open aria-labelledby="judul-sesi">
      <div class="modal-box">
        <h3 id="judul-sesi" class="font-bold text-lg"><i class="fa-solid fa-user-lock" aria-hidden="true"></i> Sesi berakhir</h3>
        <p class="py-3">{{ PESAN_SESI[sesiDicabut] }}</p>
        <p class="text-sm text-base-content/70">Jawaban yang belum terkirim tetap tersimpan di laptop ini dan dikirim setelah kamu masuk lagi di laptop ini.</p>
        <div class="modal-action">
          <button class="btn btn-primary" type="button" @click="router.replace('/')">Masuk lagi</button>
        </div>
      </div>
    </dialog>

    <div class="toast toast-bottom toast-start z-50">
      <div v-if="tempelDiblokir" role="alert" class="alert alert-warning">
        <i class="fa-solid fa-paste" aria-hidden="true"></i>
        <span>Menempel teks dari luar halaman ujian tidak diizinkan. Upaya ini tercatat. Teks yang disalin dari
          halaman ujian ini (soal, buku, jawabanmu sendiri) tetap boleh ditempel.</span>
      </div>
      <div v-if="koneksiPutus && !sesiDicabut && !tabLain && tahap === 'siap'" role="status" class="alert alert-warning">
        <i class="fa-solid fa-wifi" aria-hidden="true"></i>
        <span>Koneksi ke server terputus. Tetap mengetik saja — jawaban disimpan di laptop & dikirim otomatis.</span>
      </div>
      <div v-if="penyimpananGagal" role="alert" class="alert alert-error">
        <i class="fa-solid fa-hard-drive" aria-hidden="true"></i>
        <span>Penyimpanan cadangan di laptop ini gagal (penuh atau diblokir browser). Jawaban tetap dikirim ke
          server, tetapi jangan muat ulang halaman saat Wi-Fi putus. Beri tahu guru.</span>
      </div>
    </div>
  </div>
</template>
