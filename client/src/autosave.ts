// client/src/autosave.ts — mesin autosave jawaban di browser siswa: penyangga lokal (localStorage), satu
// kiriman per soal, kirim ulang saat jaringan gagal, penanganan bentrok/jeda/terlambat (docs/DESAIN.md §5).
// Dipanggil oleh: client/src/halaman/UjianPeserta.vue (membuat & memakai), tests/autosave.test.ts.
// Memanggil: fungsi yang disuntikkan (kirim ke server, penyimpanan, jam, uuid) — sengaja tanpa Vue/DOM,
//            supaya logikanya bisa dites di Node dengan jam palsu.
// Prinsip utama: teks siswa TIDAK PERNAH dibuang diam-diam.
// - Penyangga ditulis SEBELUM dikirim, dan baru dihapus setelah server menyimpan isi yang sama.
// - Gagal jaringan → kiriman yang SAMA PERSIS (id_simpan sama) dikirim ulang dengan jeda 2, 4, 8 … 30 dtk;
//   server mengenali id_simpan, jadi tidak tersimpan dua kali walau balasan pertama hilang.
// - Bentrok versi atau perbedaan saat halaman dimuat → kedua teks ditunjukkan ke siswa; siswa yang memilih.
// - Maksimal satu kiriman di jalan per soal; ketikan baru selama itu hanya memperbarui penyangga.

export type Kiriman = { isi: string; ditandai: boolean; versi_dasar: number; id_simpan: string; konflik?: boolean };

export type HasilKirim =
  | { jenis: 'ok'; versi: number }
  | { jenis: 'terlambat' }
  | { jenis: 'bentrok'; versi: number; isi: string; ditandai: boolean }
  | { jenis: 'dijeda' }
  | { jenis: 'tab_tidak_aktif' }
  // Timeout, jaringan putus, server 5xx/502 saat restart: kirim ulang kiriman yang sama.
  | { jenis: 'jaringan' }
  // Ditolak karena alasan lain (mis. sesi berakhir): penyangga disimpan, tidak dikirim ulang otomatis.
  | { jenis: 'ditolak'; kode: string };

export type Penyangga = {
  isi: string;
  ditandai: boolean;
  versi_dasar: number;
  id_simpan: string;
  terkirim_terlambat: boolean;
  diubah_at: number;
  // true = isi ini pilihan siswa saat bentrok (riwayat server diberi alasan "konflik").
  konflik?: boolean;
  // Isi kiriman yang sedang di jalan dan belum terbalas. Bila halaman dimuat ulang dan server ternyata
  // sudah menyimpan isi ini, itu simpanan sendiri — bukan bentrok.
  terbang?: { isi: string; ditandai: boolean } | null;
};

export type KeadaanSoal =
  | 'tersimpan'
  | 'menunggu'
  | 'mengirim'
  | 'gagal'
  | 'dijeda'
  | 'terlambat'
  | 'bentrok'
  | 'ditolak';

export type JawabanServer = { isi: string; ditandai: boolean; versi: number };

export type Bentrok = { soalId: number; server: JawabanServer; laptop: { isi: string; ditandai: boolean } };

export type Penyimpanan = {
  ambil: (kunci: string) => string | null;
  tulis: (kunci: string, nilai: string) => void;
  hapus: (kunci: string) => void;
  semuaKunci: () => string[];
};

export type OpsiAutosave = {
  // Awalan kunci localStorage: `ujian:{ujian_id}:peserta:{peserta_id}:` (docs/DESAIN.md §5).
  awalan: string;
  kirim: (soalId: number, kiriman: Kiriman) => Promise<HasilKirim>;
  penyimpanan: Penyimpanan;
  uuid: () => string;
  jam: () => number;
  saatBerubah: (soalId: number) => void;
  saatBentrok: (bentrok: Bentrok) => void;
  saatTabTidakAktif: () => void;
  saatDitolak: (kode: string) => void;
  // localStorage penuh/diblokir: teks hanya ada di memori halaman (siswa perlu diberi tahu).
  saatPenyimpananGagal?: () => void;
  // false = belum boleh mengirim sampai aktifkan() dipanggil (tab belum diklaim, docs/DESAIN.md §5).
  aktif?: boolean;
  jedaKetikMs?: number;
  berkalaMs?: number;
};

export type Autosave = {
  muat: (jawaban: { soal_id: number; isi: string; ditandai: boolean; versi: number }[], mengerjakan: boolean) => void;
  ubah: (soalId: number, isi: string, ditandai: boolean) => void;
  pilihBentrok: (soalId: number, pilihan: 'server' | 'laptop') => void;
  // Ujian (kembali) berlangsung: kirim semua yang tertunda/ditahan sekarang. Aman dipanggil berulang.
  lanjutkan: () => void;
  // Tab ini sudah diklaim sebagai tab aktif: pengiriman boleh dimulai.
  aktifkan: () => void;
  // Tab lain mengambil alih: berhenti mengirim & berhenti menulis localStorage (supaya tidak menimpa
  // penyangga milik tab baru di laptop yang sama).
  nonaktifkan: () => void;
  // Peserta kembali "mengerjakan" (perpanjangan / dibuka kembali guru): teks yang tadinya terkirim terlambat
  // dikirim lagi sebagai kiriman baru.
  bukaKembali: () => void;
  kirimSemuaSekarang: () => void;
  isi: (soalId: number) => string;
  ditandai: (soalId: number) => boolean;
  keadaan: (soalId: number) => KeadaanSoal;
  // Jumlah soal yang teksnya belum tersimpan di server (tombol Kumpulkan nonaktif selama > 0).
  jumlahTertunda: () => number;
  // Jumlah soal dengan teks yang terkirim setelah waktu habis (menunggu keputusan guru).
  jumlahTerlambat: () => number;
  versiServer: () => Record<string, number>;
  // Menghapus semua penyangga ujian ini (laptop sekolah dipakai bergantian). Hanya bila tidak ada yang tertunda.
  bersihkan: () => boolean;
  hentikan: () => void;
};

const JEDA_ULANG_MIN_MS = 2000;
const JEDA_ULANG_MAKS_MS = 30_000;

export function buatAutosave(o: OpsiAutosave): Autosave {
  const jedaKetik = o.jedaKetikMs ?? 1500;
  const berkala = o.berkalaMs ?? 15_000;
  const server = new Map<number, JawabanServer>();
  const penyangga = new Map<number, Penyangga>();
  const keadaan = new Map<number, KeadaanSoal>();
  // Kiriman yang sedang di jalan (atau menunggu dikirim ulang setelah gagal jaringan).
  const terbang = new Map<number, Kiriman>();
  const pewaktu = new Map<number, ReturnType<typeof setTimeout>>();
  const percobaan = new Map<number, number>();
  // Waktu perubahan pertama yang belum masuk kiriman mana pun (untuk batas "paling lambat 15 dtk").
  const kotorSejak = new Map<number, number>();
  let tabAktif = o.aktif ?? true;
  // true setelah tab lain mengambil alih: ketikan diabaikan & localStorage tidak ditulis lagi, karena isinya
  // kini milik tab baru di laptop yang sama. (Berbeda dengan "belum diklaim" saat halaman baru dimuat:
  // ketikan di sela itu tetap disimpan, hanya pengirimannya yang menunggu.)
  let diambilAlih = false;
  let berhenti = false;

  const kunci = (soalId: number): string => `${o.awalan}soal:${soalId}`;

  function tulis(soalId: number, p: Penyangga): void {
    penyangga.set(soalId, p);
    if (diambilAlih) return;
    try {
      o.penyimpanan.tulis(kunci(soalId), JSON.stringify(p));
    } catch {
      // localStorage penuh/diblokir: penyangga tetap ada di memori selama halaman terbuka.
      o.saatPenyimpananGagal?.();
    }
  }

  // Jeda kirim untuk ketikan baru: 1,5 dtk setelah berhenti mengetik, tetapi paling lambat 15 dtk sejak
  // perubahan pertama yang belum terkirim, walau siswa terus mengetik tanpa berhenti.
  function jadwalkanKetik(soalId: number): void {
    const sekarang = o.jam();
    const sejak = sekarang - (kotorSejak.get(soalId) ?? sekarang);
    jadwalkan(soalId, Math.max(0, Math.min(jedaKetik, berkala - sejak)));
  }

  function hapus(soalId: number): void {
    penyangga.delete(soalId);
    try {
      o.penyimpanan.hapus(kunci(soalId));
    } catch {
      // Diabaikan: paling buruk penyangga lama dicocokkan lagi saat dimuat (isi sama → dibuang).
    }
  }

  function baca(soalId: number): Penyangga | null {
    try {
      const teks = o.penyimpanan.ambil(kunci(soalId));
      if (!teks) return null;
      const p = JSON.parse(teks) as Penyangga;
      return typeof p.isi === 'string' && typeof p.versi_dasar === 'number' ? p : null;
    } catch {
      return null;
    }
  }

  function setKeadaan(soalId: number, k: KeadaanSoal): void {
    keadaan.set(soalId, k);
    o.saatBerubah(soalId);
  }

  function batalPewaktu(soalId: number): void {
    const p = pewaktu.get(soalId);
    if (p !== undefined) clearTimeout(p);
    pewaktu.delete(soalId);
  }

  function jadwalkan(soalId: number, ms: number): void {
    batalPewaktu(soalId);
    pewaktu.set(
      soalId,
      setTimeout(() => {
        pewaktu.delete(soalId);
        void jalankan(soalId);
      }, ms),
    );
  }

  function samaDenganServer(soalId: number, isi: string, ditandai: boolean): boolean {
    const s = server.get(soalId) ?? { isi: '', ditandai: false, versi: 0 };
    return s.isi === isi && s.ditandai === ditandai;
  }

  async function jalankan(soalId: number): Promise<void> {
    if (berhenti || !tabAktif) return;
    // Kiriman lain untuk soal ini masih di jalan: isi terbaru dikirim setelah balasannya tiba.
    if (terbang.has(soalId) && keadaan.get(soalId) === 'mengirim') return;
    let kiriman = terbang.get(soalId);
    if (!kiriman) {
      const p = penyangga.get(soalId);
      if (!p || p.terkirim_terlambat) return;
      kiriman = { isi: p.isi, ditandai: p.ditandai, versi_dasar: p.versi_dasar, id_simpan: p.id_simpan };
      if (p.konflik) kiriman.konflik = true;
      tulis(soalId, { ...p, terbang: { isi: p.isi, ditandai: p.ditandai } });
      terbang.set(soalId, kiriman);
      kotorSejak.delete(soalId);
    }
    batalPewaktu(soalId);
    setKeadaan(soalId, 'mengirim');
    let hasil: HasilKirim;
    try {
      hasil = await o.kirim(soalId, kiriman);
    } catch {
      hasil = { jenis: 'jaringan' };
    }
    if (berhenti) return;
    tangani(soalId, kiriman, hasil);
  }

  function tangani(soalId: number, kiriman: Kiriman, hasil: HasilKirim): void {
    const p = penyangga.get(soalId);
    if (hasil.jenis === 'jaringan') {
      // Kiriman yang sama persis dikirim ulang nanti (id_simpan sama → server tidak menyimpan dua kali).
      const n = (percobaan.get(soalId) ?? 0) + 1;
      percobaan.set(soalId, n);
      setKeadaan(soalId, 'gagal');
      jadwalkan(soalId, Math.min(JEDA_ULANG_MAKS_MS, JEDA_ULANG_MIN_MS * 2 ** (n - 1)));
      return;
    }
    terbang.delete(soalId);
    percobaan.delete(soalId);
    const tanpaTerbang = p ? { ...p, terbang: null } : null;

    switch (hasil.jenis) {
      case 'ok': {
        server.set(soalId, { isi: kiriman.isi, ditandai: kiriman.ditandai, versi: hasil.versi });
        if (!tanpaTerbang || (tanpaTerbang.isi === kiriman.isi && tanpaTerbang.ditandai === kiriman.ditandai)) {
          hapus(soalId);
          setKeadaan(soalId, 'tersimpan');
          return;
        }
        // Siswa mengetik lagi selama kiriman di jalan: isi baru dikirim dengan versi_dasar terbaru (jadi tidak
        // ada bentrok palsu), mengikuti jeda mengetik biasa supaya Wi-Fi kelas tidak dibanjiri kiriman.
        const { konflik: _konflik, ...lanjut } = tanpaTerbang;
        tulis(soalId, { ...lanjut, versi_dasar: hasil.versi });
        setKeadaan(soalId, 'menunggu');
        jadwalkanKetik(soalId);
        return;
      }
      case 'bentrok': {
        const s = { isi: hasil.isi, ditandai: hasil.ditandai, versi: hasil.versi };
        server.set(soalId, s);
        if (!tanpaTerbang || (tanpaTerbang.isi === s.isi && tanpaTerbang.ditandai === s.ditandai)) {
          hapus(soalId);
          setKeadaan(soalId, 'tersimpan');
          return;
        }
        tulis(soalId, tanpaTerbang);
        setKeadaan(soalId, 'bentrok');
        o.saatBentrok({ soalId, server: s, laptop: { isi: tanpaTerbang.isi, ditandai: tanpaTerbang.ditandai } });
        return;
      }
      case 'terlambat':
        if (tanpaTerbang) tulis(soalId, { ...tanpaTerbang, terkirim_terlambat: true });
        setKeadaan(soalId, 'terlambat');
        return;
      case 'dijeda':
        // Disimpan, lalu dikirim setelah ujian dilanjutkan (lanjutkan()).
        if (tanpaTerbang) tulis(soalId, tanpaTerbang);
        setKeadaan(soalId, 'dijeda');
        return;
      case 'tab_tidak_aktif':
        // Hanya di memori: localStorage kini milik tab baru (laptop yang sama), jangan ditimpa.
        diambilAlih = true;
        if (tanpaTerbang) penyangga.set(soalId, tanpaTerbang);
        tabAktif = false;
        setKeadaan(soalId, 'ditolak');
        o.saatTabTidakAktif();
        return;
      case 'ditolak':
        if (tanpaTerbang) tulis(soalId, tanpaTerbang);
        setKeadaan(soalId, 'ditolak');
        o.saatDitolak(hasil.kode);
        return;
    }
  }

  function lanjutkanSemua(): void {
    for (const [soalId, k] of keadaan) {
      if (k === 'dijeda' || k === 'ditolak' || k === 'gagal' || k === 'menunggu') jadwalkan(soalId, 0);
    }
  }

  return {
    // Mencocokkan penyangga di laptop dengan jawaban di server saat halaman dimuat (docs/DESAIN.md §5).
    // Penyangga yang tertunda selalu dikirim (juga di fase "selesai": server yang memutuskan diterima
    // atau disimpan sebagai jawaban terlambat). Penyangga yang SUDAH terkirim terlambat hanya dikirim ulang
    // bila peserta kembali mengerjakan (mengerjakan = true, mis. setelah perpanjangan waktu).
    muat(jawaban, mengerjakan) {
      for (const j of jawaban) server.set(j.soal_id, { isi: j.isi, ditandai: j.ditandai, versi: j.versi });
      const awalanSoal = `${o.awalan}soal:`;
      let semua: string[] = [];
      try {
        semua = o.penyimpanan.semuaKunci().filter((k) => k.startsWith(awalanSoal));
      } catch {
        semua = [];
      }
      for (const k of semua) {
        const soalId = Number(k.slice(awalanSoal.length));
        if (!Number.isInteger(soalId)) continue;
        let p = baca(soalId);
        if (!p) continue;
        const s = server.get(soalId) ?? { isi: '', ditandai: false, versi: 0 };
        // Simpanan sendiri yang balasannya tidak sempat diterima sebelum halaman ditutup.
        if (p.terbang && p.terbang.isi === s.isi && p.terbang.ditandai === s.ditandai && s.versi === p.versi_dasar + 1) {
          p = { ...p, versi_dasar: s.versi, terbang: null };
        }
        if (p.isi === s.isi && p.ditandai === s.ditandai) {
          hapus(soalId);
          keadaan.set(soalId, 'tersimpan');
          continue;
        }
        if (p.terkirim_terlambat) {
          if (!mengerjakan) {
            penyangga.set(soalId, p);
            keadaan.set(soalId, 'terlambat');
            continue;
          }
          // Peserta mengerjakan lagi: dikirim sebagai kiriman BARU (id lama sudah tercatat sebagai terlambat).
          p = { ...p, terkirim_terlambat: false, id_simpan: o.uuid() };
        }
        if (p.versi_dasar === s.versi) {
          tulis(soalId, { ...p, terbang: null });
          keadaan.set(soalId, 'menunggu');
          jadwalkan(soalId, 0);
          continue;
        }
        // Teks di laptop berbeda dengan server dan bukan kelanjutannya: siswa yang memilih.
        tulis(soalId, { ...p, terbang: null });
        keadaan.set(soalId, 'bentrok');
        o.saatBentrok({ soalId, server: s, laptop: { isi: p.isi, ditandai: p.ditandai } });
      }
    },

    ubah(soalId, isi, ditandai) {
      const k = keadaan.get(soalId);
      if (diambilAlih || k === 'bentrok' || k === 'terlambat') return;
      const lama = penyangga.get(soalId);
      if (!lama && samaDenganServer(soalId, isi, ditandai)) return;
      const versiDasar = lama?.versi_dasar ?? server.get(soalId)?.versi ?? 0;
      // id_simpan baru untuk setiap perubahan: kiriman berikutnya berbeda dengan yang sedang di jalan.
      tulis(soalId, {
        isi,
        ditandai,
        versi_dasar: versiDasar,
        id_simpan: o.uuid(),
        terkirim_terlambat: false,
        diubah_at: o.jam(),
        terbang: lama?.terbang ?? null,
        ...(lama?.konflik ? { konflik: true } : {}),
      });
      if (k !== 'mengirim' && k !== 'gagal') setKeadaan(soalId, k === 'dijeda' || k === 'ditolak' ? k : 'menunggu');
      const sekarang = o.jam();
      if (!kotorSejak.has(soalId)) kotorSejak.set(soalId, sekarang);
      if (terbang.has(soalId)) return;
      jadwalkanKetik(soalId);
    },

    pilihBentrok(soalId, pilihan) {
      const s = server.get(soalId) ?? { isi: '', ditandai: false, versi: 0 };
      const p = penyangga.get(soalId);
      if (pilihan === 'server' || !p) {
        hapus(soalId);
        setKeadaan(soalId, 'tersimpan');
        return;
      }
      tulis(soalId, { ...p, versi_dasar: s.versi, id_simpan: o.uuid(), konflik: true, terbang: null });
      setKeadaan(soalId, 'menunggu');
      jadwalkan(soalId, 0);
    },

    lanjutkan: lanjutkanSemua,

    aktifkan() {
      tabAktif = true;
      diambilAlih = false;
      lanjutkanSemua();
    },

    nonaktifkan() {
      tabAktif = false;
      diambilAlih = true;
    },

    bukaKembali() {
      for (const [soalId, p] of penyangga) {
        if (!p.terkirim_terlambat) continue;
        tulis(soalId, { ...p, terkirim_terlambat: false, id_simpan: o.uuid(), terbang: null });
        setKeadaan(soalId, 'menunggu');
        jadwalkan(soalId, 0);
      }
    },

    kirimSemuaSekarang() {
      for (const soalId of penyangga.keys()) {
        const k = keadaan.get(soalId);
        // 'dijeda' ikut dicoba: bila ujian ternyata sudah dilanjutkan, teksnya langsung terkirim; bila masih
        // dijeda, server cukup menjawab 409 dijeda lagi.
        if (k === 'menunggu' || k === 'gagal' || k === 'dijeda') jadwalkan(soalId, 0);
      }
    },

    isi(soalId) {
      return penyangga.get(soalId)?.isi ?? server.get(soalId)?.isi ?? '';
    },
    ditandai(soalId) {
      return penyangga.get(soalId)?.ditandai ?? server.get(soalId)?.ditandai ?? false;
    },
    keadaan(soalId) {
      return keadaan.get(soalId) ?? 'tersimpan';
    },
    jumlahTertunda() {
      let n = 0;
      for (const p of penyangga.values()) if (!p.terkirim_terlambat) n += 1;
      return n;
    },
    jumlahTerlambat() {
      let n = 0;
      for (const p of penyangga.values()) if (p.terkirim_terlambat) n += 1;
      return n;
    },
    versiServer() {
      const hasil: Record<string, number> = {};
      for (const [soalId, s] of server) hasil[String(soalId)] = s.versi;
      return hasil;
    },
    bersihkan() {
      if (penyangga.size > 0) return false;
      try {
        for (const k of o.penyimpanan.semuaKunci()) if (k.startsWith(o.awalan)) o.penyimpanan.hapus(k);
      } catch {
        return false;
      }
      return true;
    },
    hentikan() {
      berhenti = true;
      for (const p of pewaktu.values()) clearTimeout(p);
      pewaktu.clear();
    },
  };
}
