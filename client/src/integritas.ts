// client/src/integritas.ts — pencatat "kepergian" siswa dari halaman ujian (pindah tab, jendela tidak aktif,
// keluar layar penuh) dan upaya menempel dari luar, beserta antrean laporan ke server yang tahan putus Wi-Fi.
// Dipanggil oleh: client/src/halaman/UjianPeserta.vue (meneruskan sinyal DOM), tests/integritas.test.ts.
// Memanggil: tidak ada (tanpa Vue/DOM; jam, pengirim, dan penyimpanan diberikan pemanggil, supaya bisa dites).
// Aturan (docs/DESAIN.md §6, P9 "satu kepergian = satu event"):
// - Kepergian dimulai pada sinyal pertama: tab tersembunyi (langsung), keluar layar penuh (langsung), atau jendela
//   tidak aktif ≥ 1 dtk. Kepergian berakhir saat halaman kembali terlihat, terfokus, DAN layar penuh.
// - jenis = sinyal terkuat (tab_tersembunyi > fokus_hilang > keluar_layar_penuh); semua sinyal di detail.sinyal.
// - Laporan "mulai" dikirim segera (guru melihatnya ≤ 3 dtk), laporan "selesai" membawa durasi.
// - Kepergian hanya DIMULAI saat `aktif()` (ujian berlangsung, siswa mengerjakan, tab ini tab aktif). Kepergian
//   yang sudah berjalan tetap diselesaikan walau status berubah; server memotong durasinya.
// - Jam kejadian dikirim dalam perkiraan jam SERVER (jam_server + jam monoton), bukan jam laptop.
// - Antrean laporan disimpan di localStorage dan dikirim ulang (2 → 30 dtk) sampai server menjawab, jadi
//   laporan saat Wi-Fi putus tidak hilang. Kepergian yang terputus karena halaman ditutup diselesaikan saat
//   halaman dimuat lagi.
// Batas jujur (aturan keras #4): ini hanya tahu halaman ujian tidak terlihat/aktif, bukan apa yang dibuka siswa.
import type { DetailEvent, JenisKepergian, LaporanEvent } from '../../shared/pantau.ts';
import { JENIS_KEPERGIAN, peringkatKepergian } from '../../shared/pantau.ts';

export const BATAS_BLUR_MS = 1000;
const JEDA_ULANG_AWAL_MS = 2000;
const JEDA_ULANG_MAKS_MS = 30_000;
const MAKS_ANTREAN = 200;

export type HasilLapor = 'ok' | 'gagal';

export type PenyimpananLaporan = {
  ambil: (kunci: string) => string | null;
  tulis: (kunci: string, nilai: string) => void;
  hapus: (kunci: string) => void;
};

export type OpsiPencatat = {
  // Awalan kunci localStorage, mis. "ujian:1:peserta:5:".
  awalan: string;
  penyimpanan: PenyimpananLaporan;
  kirim: (laporan: LaporanEvent) => Promise<HasilLapor>;
  uuid: () => string;
  // Perkiraan jam server sekarang (ms), dari jam_server terakhir + jam monoton.
  jamServer: () => number;
  // Jam monoton (performance.now) untuk durasi.
  monoton: () => number;
  aktif: () => boolean;
  // Dipanggil saat siswa kembali dari kepergian yang tercatat (untuk peringatan di layar).
  saatKembali?: (durasiMs: number, jenis: JenisKepergian) => void;
};

export type Sinyal = 'tersembunyi' | 'terlihat' | 'blur' | 'fokus' | 'keluar_layar_penuh' | 'masuk_layar_penuh';

export type Pencatat = {
  sinyal: (s: Sinyal) => void;
  tempel: (panjang: number) => void;
  segarkan: (keadaan: { tersembunyi: boolean; fokus: boolean }) => void;
  abaikanLayarPenuh: () => void;
  // Dipanggil saat koneksi pulih (online / SSE tersambung): antrean langsung dicoba.
  kirimSekarang: () => void;
  sedangPergi: () => boolean;
  jumlahAntrean: () => number;
  hentikan: () => void;
};

type Kepergian = {
  id: string;
  mulaiServer: number;
  mulaiMonoton: number;
  sinyal: JenisKepergian[];
  jenis: JenisKepergian;
};

function terkuat(daftar: JenisKepergian[]): JenisKepergian {
  return [...daftar].sort((a, b) => peringkatKepergian(b) - peringkatKepergian(a))[0] ?? 'keluar_layar_penuh';
}

export function buatPencatat(o: OpsiPencatat): Pencatat {
  const kunciAntrean = `${o.awalan}laporan`;
  const kunciPergi = `${o.awalan}kepergian`;

  const kondisi = { tersembunyi: false, blur: false, keluarLayarPenuh: false };
  let blurSejak: { server: number; monoton: number } | null = null;
  let pewaktuBlur: ReturnType<typeof setTimeout> | undefined;
  let pergi: Kepergian | null = null;
  let antrean: LaporanEvent[] = [];
  let mengirim = false;
  let jedaUlang = JEDA_ULANG_AWAL_MS;
  let pewaktuUlang: ReturnType<typeof setTimeout> | undefined;
  let berhenti = false;

  function simpanAntrean(): void {
    try {
      if (antrean.length === 0) o.penyimpanan.hapus(kunciAntrean);
      else o.penyimpanan.tulis(kunciAntrean, JSON.stringify(antrean));
    } catch {
      // Penyimpanan penuh/diblokir: antrean tetap di memori selama halaman terbuka.
    }
  }

  function simpanPergi(): void {
    try {
      if (pergi) {
        o.penyimpanan.tulis(
          kunciPergi,
          JSON.stringify({ id: pergi.id, mulaiServer: pergi.mulaiServer, sinyal: pergi.sinyal, jenis: pergi.jenis }),
        );
      } else o.penyimpanan.hapus(kunciPergi);
    } catch {
      // Sama seperti di atas.
    }
  }

  function antrekan(laporan: LaporanEvent): void {
    antrean.push(laporan);
    if (antrean.length > MAKS_ANTREAN) antrean = antrean.slice(-MAKS_ANTREAN);
    simpanAntrean();
    void kirimAntrean();
  }

  async function kirimAntrean(): Promise<void> {
    if (mengirim || berhenti) return;
    mengirim = true;
    try {
      while (antrean.length > 0 && !berhenti) {
        const laporan = antrean[0] as LaporanEvent;
        const hasil = await o.kirim(laporan);
        if (hasil === 'gagal') {
          clearTimeout(pewaktuUlang);
          pewaktuUlang = setTimeout(() => void kirimAntrean(), jedaUlang);
          jedaUlang = Math.min(jedaUlang * 2, JEDA_ULANG_MAKS_MS);
          return;
        }
        jedaUlang = JEDA_ULANG_AWAL_MS;
        // Dibandingkan dengan objeknya: antrean bisa saja dipotong selama menunggu balasan.
        if (antrean[0] === laporan) antrean.shift();
        simpanAntrean();
      }
    } finally {
      mengirim = false;
    }
  }

  function laporanPergi(p: Kepergian, tahap: 'mulai' | 'selesai', durasi?: number): LaporanEvent {
    const detail: DetailEvent = { sinyal: [...p.sinyal] };
    return {
      id_klien: p.id,
      jenis: p.jenis,
      tahap,
      mulai_klien_at: Math.round(p.mulaiServer),
      ...(durasi === undefined ? {} : { durasi_ms: Math.max(0, Math.round(durasi)) }),
      detail,
    };
  }

  function mulaiPergi(jenis: JenisKepergian, server: number, monoton: number): void {
    pergi = { id: o.uuid(), mulaiServer: server, mulaiMonoton: monoton, sinyal: [jenis], jenis };
    simpanPergi();
    antrekan(laporanPergi(pergi, 'mulai'));
  }

  function tambahSinyal(jenis: JenisKepergian): void {
    if (!pergi || pergi.sinyal.includes(jenis)) return;
    pergi.sinyal.push(jenis);
    const baru = terkuat(pergi.sinyal);
    simpanPergi();
    if (baru !== pergi.jenis) {
      pergi.jenis = baru;
      // Laporan "mulai" ulang dengan id yang sama: server menaikkan jenisnya (tidak membuat event baru).
      antrekan(laporanPergi(pergi, 'mulai'));
    }
  }

  function selesaiPergi(): void {
    if (!pergi) return;
    const p = pergi;
    const durasi = o.monoton() - p.mulaiMonoton;
    pergi = null;
    simpanPergi();
    antrekan(laporanPergi(p, 'selesai', durasi));
    o.saatKembali?.(durasi, p.jenis);
  }

  function evaluasi(): void {
    const sudahKembali = !kondisi.tersembunyi && !kondisi.blur && !kondisi.keluarLayarPenuh;
    if (sudahKembali) {
      clearTimeout(pewaktuBlur);
      blurSejak = null;
      selesaiPergi();
      return;
    }
    const sekarangServer = o.jamServer();
    const sekarangMonoton = o.monoton();
    if (pergi) {
      if (kondisi.tersembunyi) tambahSinyal('tab_tersembunyi');
      if (kondisi.keluarLayarPenuh) tambahSinyal('keluar_layar_penuh');
      if (kondisi.blur && blurSejak && sekarangMonoton - blurSejak.monoton >= BATAS_BLUR_MS) tambahSinyal('fokus_hilang');
      return;
    }
    if (!o.aktif()) return;
    if (kondisi.tersembunyi || kondisi.keluarLayarPenuh) {
      clearTimeout(pewaktuBlur);
      const jenis: JenisKepergian = kondisi.tersembunyi ? 'tab_tersembunyi' : 'keluar_layar_penuh';
      // Bila jendela sudah tidak aktif lebih dulu, kepergian dihitung sejak saat itu.
      mulaiPergi(jenis, blurSejak?.server ?? sekarangServer, blurSejak?.monoton ?? sekarangMonoton);
      if (kondisi.tersembunyi && kondisi.keluarLayarPenuh) tambahSinyal('keluar_layar_penuh');
      return;
    }
    // Hanya jendela tidak aktif: baru dianggap pergi setelah 1 dtk (klik notifikasi sekilas tidak dihitung).
    if (kondisi.blur && blurSejak) {
      const sisa = BATAS_BLUR_MS - (sekarangMonoton - blurSejak.monoton);
      if (sisa <= 0) {
        mulaiPergi('fokus_hilang', blurSejak.server, blurSejak.monoton);
        return;
      }
      clearTimeout(pewaktuBlur);
      pewaktuBlur = setTimeout(evaluasi, sisa);
    }
  }

  // ---- Saat dimuat: lanjutkan antrean lama & selesaikan kepergian yang terputus karena halaman ditutup ----
  try {
    const mentah: unknown = JSON.parse(o.penyimpanan.ambil(kunciAntrean) ?? '[]');
    if (Array.isArray(mentah)) antrean = mentah as LaporanEvent[];
  } catch {
    antrean = [];
  }
  try {
    const lama = JSON.parse(o.penyimpanan.ambil(kunciPergi) ?? 'null') as
      | { id: string; mulaiServer: number; sinyal: JenisKepergian[]; jenis: JenisKepergian }
      | null;
    if (lama && typeof lama.id === 'string' && JENIS_KEPERGIAN.includes(lama.jenis)) {
      const p: Kepergian = { ...lama, mulaiMonoton: 0 };
      antrean.push(laporanPergi(p, 'selesai', Math.max(0, o.jamServer() - lama.mulaiServer)));
    }
    o.penyimpanan.hapus(kunciPergi);
  } catch {
    // Data rusak: diabaikan.
  }
  simpanAntrean();
  void kirimAntrean();

  return {
    sinyal(s) {
      if (berhenti) return;
      if (s === 'tersembunyi') kondisi.tersembunyi = true;
      if (s === 'terlihat') kondisi.tersembunyi = false;
      // Keluar layar penuh hanya bermakna bila terjadi saat mengerjakan (mis. Esc di ruang tunggu tidak dihitung,
      // dan tidak boleh "tertinggal" lalu dianggap kepergian saat ujian dimulai).
      if (s === 'keluar_layar_penuh' && (o.aktif() || pergi)) kondisi.keluarLayarPenuh = true;
      if (s === 'masuk_layar_penuh') kondisi.keluarLayarPenuh = false;
      if (s === 'blur' && !kondisi.blur) {
        kondisi.blur = true;
        blurSejak = { server: o.jamServer(), monoton: o.monoton() };
      }
      if (s === 'fokus') {
        kondisi.blur = false;
        blurSejak = null;
      }
      evaluasi();
    },
    tempel(panjang) {
      if (berhenti || !o.aktif()) return;
      antrekan({
        id_klien: o.uuid(),
        jenis: 'tempel_dari_luar',
        tahap: 'selesai',
        mulai_klien_at: Math.round(o.jamServer()),
        durasi_ms: 0,
        detail: { panjang },
      });
    },
    segarkan(k) {
      if (berhenti) return;
      // Dipanggil saat pencatatan MENJADI aktif (Mulai, Lanjutkan, dibuka kembali): keadaan halaman dibaca ulang,
      // dan kepergian yang sudah berlangsung dihitung sejak SAAT INI (bukan sejak sebelum aktif, yang akan ditolak
      // server dan membuat seluruh kepergian hilang). Tidak sedang layar penuh saat itu bukan kepergian.
      kondisi.tersembunyi = k.tersembunyi;
      if (k.fokus) {
        kondisi.blur = false;
        blurSejak = null;
      } else if (!pergi) {
        kondisi.blur = true;
        blurSejak = { server: o.jamServer(), monoton: o.monoton() };
      }
      if (!pergi) kondisi.keluarLayarPenuh = false;
      evaluasi();
    },
    abaikanLayarPenuh() {
      // Browser menolak layar penuh: syarat "kembali" tidak lagi menunggu layar penuh, supaya kepergian tidak
      // terbuka selamanya.
      kondisi.keluarLayarPenuh = false;
      evaluasi();
    },
    kirimSekarang() {
      clearTimeout(pewaktuUlang);
      jedaUlang = JEDA_ULANG_AWAL_MS;
      void kirimAntrean();
    },
    sedangPergi: () => pergi !== null,
    jumlahAntrean: () => antrean.length,
    hentikan() {
      berhenti = true;
      clearTimeout(pewaktuBlur);
      clearTimeout(pewaktuUlang);
    },
  };
}
