// server/auth/antrean.ts — pembatas "berapa yang boleh jalan bersamaan" (semafor) dan antrean per kunci.
// Dipanggil oleh: server/auth/kata-sandi.ts (semua scrypt), server/routes/penguji-auth.ts (login guru
// diproses satu per satu per username).
// Memanggil: server/http.ts (GalatHttp 503 bila antrean penuh).
// Alasan:
// - scrypt berjalan di threadpool libuv (bawaan 4 thread) yang juga dipakai membaca berkas (aset, PDF).
//   Tanpa batas, banjir login membuat semua permintaan lain ikut lambat.
// - Jeda 1 dtk pada login guru yang gagal baru efektif bila percobaan untuk username yang sama
//   diproses berurutan; kalau paralel, 100 tebakan bisa selesai dalam 1 dtk.
// - Antrean dibatasi panjangnya: lebih baik menjawab "server sibuk" daripada menumpuk tanpa batas.
import { GalatHttp } from '../http.ts';

export type Semafor = {
  jalankan: <T>(kerja: () => Promise<T>) => Promise<T>;
  // true bila permintaan baru akan ditolak (semua slot terpakai dan antrean penuh).
  penuh: () => boolean;
  // true bila tidak ada yang berjalan maupun menunggu.
  diam: () => boolean;
};

export function buatSemafor(maksJalan: number, maksAntre: number): Semafor {
  let jalan = 0;
  const antre: (() => void)[] = [];

  const penuh = (): boolean => jalan >= maksJalan && antre.length >= maksAntre;

  async function jalankan<T>(kerja: () => Promise<T>): Promise<T> {
    if (jalan < maksJalan) {
      jalan += 1;
    } else {
      if (antre.length >= maksAntre) throw new GalatHttp(503, 'server_sibuk');
      // Slot diserahkan langsung oleh yang selesai (lihat finally), jadi `jalan` tidak berubah di sini.
      await new Promise<void>((resolve) => antre.push(resolve));
    }
    try {
      return await kerja();
    } finally {
      const berikut = antre.shift();
      if (berikut) berikut();
      else jalan -= 1;
    }
  }

  return { jalankan, penuh, diam: () => jalan === 0 && antre.length === 0 };
}

export type AntreanPerKunci = {
  jalankan: <T>(kunci: string, kerja: () => Promise<T>) => Promise<T>;
};

// Kerja dengan kunci yang sama diproses satu per satu; kunci berbeda tetap paralel.
// Entri dihapus begitu kosong, jadi ukuran peta hanya sebanyak kunci yang sedang diproses.
export function buatAntreanPerKunci(maksAntrePerKunci: number): AntreanPerKunci {
  const peta = new Map<string, Semafor>();
  return {
    jalankan: async (kunci, kerja) => {
      let semafor = peta.get(kunci);
      if (!semafor) {
        semafor = buatSemafor(1, maksAntrePerKunci);
        peta.set(kunci, semafor);
      }
      try {
        return await semafor.jalankan(kerja);
      } finally {
        if (semafor.diam() && peta.get(kunci) === semafor) peta.delete(kunci);
      }
    },
  };
}
