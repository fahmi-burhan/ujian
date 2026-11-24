// client/src/unduh-buku.ts — mengunduh SATU berkas buku PDF secara utuh dengan laporan progres, dan melanjutkan dari
// byte terakhir (HTTP Range) bila koneksi putus atau macet di tengah jalan. Tanpa Vue/DOM supaya bisa dites.
// Dipanggil oleh: client/src/buku.ts (antrean buku), tests/unduh-buku.test.ts. Memanggil: fetch.
// Alasan (gladi 24 Nov): PDF.js memuat buku bagian demi bagian saat halaman digulir, jadi di Wi-Fi kelas yang padat
// (24 siswa × 47 MB) halaman tampil putih lama sekali. Sekarang buku diunduh utuh sejak ruang tunggu dengan progres
// yang terlihat, lalu dibaca dari memori tanpa jaringan.

export type Progres = { diterima: number; total: number | null };

// Galat yang tidak ada gunanya dicoba lagi (mis. 401/403/404/409: sesi habis, ujian tidak lagi membuka buku).
export class GalatUnduhTetap extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`unduhan ditolak server (${status})`);
    this.name = 'GalatUnduhTetap';
    this.status = status;
  }
}

export type OpsiUnduh = {
  ambil?: typeof fetch;
  saatProgres?: (p: Progres) => void;
  // Pembatalan dari pemanggil (siswa keluar, ujian selesai): berhenti tanpa mencoba lagi.
  batal?: AbortSignal;
  // Ukuran dari daftar buku (DB). Diutamakan daripada Content-Length, yang bisa berupa panjang terkompresi bila
  // proxy mengompres; bila ada, memori untuk isi buku juga langsung dipesan sekali (tanpa salinan kedua).
  ukuran?: number | null;
  // Berapa kali boleh gagal berturut-turut TANPA kemajuan sebelum menyerah.
  maksGagal?: number;
  jeda?: (keGagal: number) => number;
  // Koneksi yang macet tanpa diputus (Wi-Fi padat, pindah access point) diputus sendiri setelah sekian lama tanpa
  // satu byte pun, lalu dilanjutkan lewat Range.
  batasDiamMs?: number;
};

const JEDA_BAWAAN = [2000, 4000, 8000, 15_000, 30_000];

// Tidur yang langsung berakhir bila dibatalkan (tugas yang dibatalkan tidak "hidup" sampai 30 dtk kemudian).
function tidur(ms: number, batal?: AbortSignal): Promise<void> {
  return new Promise((selesai) => {
    if (batal?.aborted || ms <= 0) return selesai();
    const t = setTimeout(selesai, ms);
    batal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        selesai();
      },
      { once: true },
    );
  });
}

// Penampung isi berkas: satu Uint8Array seukuran berkas bila ukurannya diketahui; bila tidak, potongan digabung di akhir.
class Penampung {
  private wadah: Uint8Array | null;
  private potongan: Uint8Array[] = [];
  panjang = 0;
  constructor(ukuran: number | null) {
    this.wadah = ukuran !== null && ukuran > 0 ? new Uint8Array(ukuran) : null;
  }
  kosongkan(): void {
    this.panjang = 0;
    this.potongan = [];
  }
  tambah(p: Uint8Array): void {
    if (this.wadah && this.panjang + p.length <= this.wadah.length) this.wadah.set(p, this.panjang);
    else {
      // Lebih besar dari perkiraan: pindah ke mode potongan.
      if (this.wadah) this.potongan = [this.wadah.slice(0, this.panjang)];
      this.wadah = null;
      this.potongan.push(p);
    }
    this.panjang += p.length;
  }
  hasil(): Uint8Array {
    if (this.wadah) return this.panjang === this.wadah.length ? this.wadah : this.wadah.slice(0, this.panjang);
    const h = new Uint8Array(this.panjang);
    let pos = 0;
    for (const p of this.potongan) {
      h.set(p, pos);
      pos += p.length;
    }
    return h;
  }
}

export async function unduhPenuh(url: string, opsi: OpsiUnduh = {}): Promise<Uint8Array> {
  const ambil = opsi.ambil ?? fetch;
  const maksGagal = opsi.maksGagal ?? 6;
  const jeda = opsi.jeda ?? ((ke: number) => JEDA_BAWAAN[Math.min(ke - 1, JEDA_BAWAAN.length - 1)] ?? 30_000);
  const batasDiam = opsi.batasDiamMs ?? 30_000;
  let total: number | null = opsi.ukuran ?? null;
  const isi = new Penampung(total);
  let gagal = 0;

  for (;;) {
    const sebelum = isi.panjang;
    // Pembatal per percobaan: tersambung ke pembatalan pemanggil, dan dipakai penjaga koneksi macet.
    const percobaan = new AbortController();
    const teruskan = (): void => percobaan.abort();
    opsi.batal?.addEventListener('abort', teruskan, { once: true });
    let macet = false;
    let penjaga: ReturnType<typeof setTimeout> | undefined;
    let pembaca: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const setelPenjaga = (): void => {
      clearTimeout(penjaga);
      penjaga = setTimeout(() => {
        macet = true;
        percobaan.abort();
        pembaca?.cancel().catch(() => {});
      }, batasDiam);
    };
    try {
      if (opsi.batal?.aborted) throw opsi.batal.reason ?? new Error('dibatalkan');
      setelPenjaga();
      const res = await ambil(url, {
        headers: isi.panjang > 0 ? { Range: `bytes=${isi.panjang}-` } : {},
        credentials: 'same-origin',
        cache: 'no-store',
        signal: percobaan.signal,
      });
      if (isi.panjang > 0 && res.status === 206) {
        // Lanjutan harus mulai tepat di byte yang diminta; bila tidak, ulang dari awal.
        const rentang = /^bytes (\d+)-\d+\/(\d+)$/.exec(res.headers.get('Content-Range') ?? '');
        if (!rentang || Number(rentang[1]) !== isi.panjang) {
          isi.kosongkan();
          await res.body?.cancel();
          throw new Error('rentang lanjutan tidak cocok');
        }
        total = Number(rentang[2]);
      } else if (res.status === 200) {
        // Server mengirim berkas utuh (unduhan pertama, atau server mengabaikan Range): mulai dari nol.
        isi.kosongkan();
        const panjang = Number(res.headers.get('Content-Length'));
        if (total === null && !res.headers.get('Content-Encoding') && Number.isFinite(panjang) && panjang > 0) total = panjang;
      } else if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        throw new GalatUnduhTetap(res.status);
      } else {
        throw new Error(`status ${res.status}`);
      }
      if (!res.body) throw new Error('respons tanpa isi');
      pembaca = res.body.getReader();
      for (;;) {
        const { done, value } = await pembaca.read();
        if (done) break;
        setelPenjaga();
        isi.tambah(value);
        opsi.saatProgres?.({ diterima: isi.panjang, total });
      }
      if (macet) throw new Error('koneksi macet');
      if (total !== null && isi.panjang !== total) throw new Error('unduhan belum lengkap');
      return isi.hasil();
    } catch (e) {
      if (e instanceof GalatUnduhTetap || opsi.batal?.aborted) throw e;
      // Ada kemajuan → hitungan gagal diulang dari satu (Wi-Fi yang sering putus sebentar tetap sampai selesai).
      gagal = isi.panjang > sebelum ? 1 : gagal + 1;
      if (gagal > maksGagal) throw e;
      await tidur(jeda(gagal), opsi.batal);
      if (opsi.batal?.aborted) throw opsi.batal.reason ?? new Error('dibatalkan');
    } finally {
      clearTimeout(penjaga);
      opsi.batal?.removeEventListener('abort', teruskan);
    }
  }
}
