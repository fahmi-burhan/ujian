// client/src/tempel.ts — "himpunan salin": sidik (hash) semua teks yang keluar dari halaman ujian lewat copy, cut,
// atau seret (soal, buku PDF, jawaban sendiri), supaya menempel teks dari LUAR halaman bisa diblokir sementara
// teks dari halaman sendiri tetap boleh (keputusan pemilik 20 Nov, docs/DESAIN.md §6 & §12 no. 3).
// Dipanggil oleh: client/src/halaman/UjianPeserta.vue, tests/tempel.test.ts.
// Memanggil: tidak ada (tanpa Vue/DOM; penyimpanan diberikan pemanggil).
// Catatan:
// - Hash dihitung SINKRON (cyrb53, 53 bit), karena keputusan blokir harus diambil di dalam event `paste`
//   (preventDefault tidak bisa menunggu crypto.subtle yang async). Ini bukan pengaman kriptografis; tujuannya
//   hanya agar teks lengkapnya tidak perlu disimpan di laptop. Peluang dua teks berbeda bersidik sama sangat kecil.
// - Teks dinormalisasi sebelum di-hash (akhir baris \r\n → \n, spasi berlebih dirapikan) agar teks yang sama
//   dari sumber berbeda (Windows/clipboard) tetap cocok.
// - Himpunan disimpan di localStorage per ujian + peserta: tetap ada setelah muat ulang atau tab baru di laptop
//   yang sama. Siswa yang pindah laptop kehilangan himpunannya (sisa risiko yang sudah dicatat di DESAIN §6).

export const MAKS_SIDIK = 2000;

export function normalisasi(teks: string): string {
  return teks
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t  -​ 　]+/g, ' ')
    .split('\n')
    .map((baris) => baris.trim())
    .join('\n')
    .trim();
}

// cyrb53 (domain publik, oleh bryc): hash 53 bit yang cepat dan tersebar baik.
export function cyrb53(teks: string, benih = 0): number {
  let h1 = 0xdeadbeef ^ benih;
  let h2 = 0x41c6ce57 ^ benih;
  for (let i = 0; i < teks.length; i++) {
    const c = teks.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function sidikTeks(teks: string): string {
  return cyrb53(normalisasi(teks)).toString(36);
}

export type PenyimpananSidik = {
  ambil: (kunci: string) => string | null;
  tulis: (kunci: string, nilai: string) => void;
};

export type HimpunanSalin = {
  // Dicatat saat copy/cut/seret dari halaman ujian.
  catat: (teks: string) => void;
  // true = teks boleh ditempel (berasal dari halaman ini, atau kosong setelah dinormalisasi).
  boleh: (teks: string) => boolean;
};

export function buatHimpunanSalin(kunci: string, penyimpanan: PenyimpananSidik, maks = MAKS_SIDIK): HimpunanSalin {
  let daftar: string[] = [];
  try {
    const mentah: unknown = JSON.parse(penyimpanan.ambil(kunci) ?? '[]');
    if (Array.isArray(mentah)) daftar = mentah.filter((x): x is string => typeof x === 'string');
  } catch {
    daftar = [];
  }
  const himpunan = new Set(daftar);

  return {
    catat(teks) {
      if (normalisasi(teks) === '') return;
      const s = sidikTeks(teks);
      if (himpunan.has(s)) return;
      himpunan.add(s);
      daftar.push(s);
      // Yang tertua dibuang bila terlalu banyak (localStorage terbatas ±5 MB per situs).
      while (daftar.length > maks) {
        const tua = daftar.shift();
        if (tua !== undefined) himpunan.delete(tua);
      }
      try {
        penyimpanan.tulis(kunci, JSON.stringify(daftar));
      } catch {
        // Penyimpanan penuh/diblokir: himpunan tetap berlaku selama halaman terbuka.
      }
    },
    boleh(teks) {
      return normalisasi(teks) === '' || himpunan.has(sidikTeks(teks));
    },
  };
}
