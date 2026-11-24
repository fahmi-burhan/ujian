// client/src/catatan.ts — memecah catatan guru untuk siswa menjadi bagian-bagian berjudul untuk ditampilkan.
// Dipanggil oleh: client/src/komponen/peserta/NilaiSiswa.vue, tests/catatan.test.ts. Memanggil: tidak ada.
// Draf AI menulis catatan dalam satu teks: "Umum:\n…\n\nNama kriteria:\n…" (server/ai/prompt.ts susunCatatan), dan
// guru menyuntingnya di satu kotak teks. Di sini teks itu dipecah per paragraf; paragraf yang baris pertamanya pendek
// dan berakhiran titik dua dianggap berjudul, supaya judulnya bisa ditebalkan. Catatan biasa tanpa judul tetap
// tampil apa adanya (judul null). Tidak ada HTML: hasilnya dirender dengan {{ }}.

export type BagianCatatan = { judul: string | null; isi: string };

const PANJANG_MAKS_JUDUL = 120;

export function pecahCatatan(teks: string): BagianCatatan[] {
  return teks
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .map((p) => {
      const baris = p.indexOf('\n');
      const pertama = baris === -1 ? p : p.slice(0, baris);
      if (baris !== -1 && pertama.endsWith(':') && pertama.length <= PANJANG_MAKS_JUDUL) {
        return { judul: pertama.slice(0, -1).trim(), isi: p.slice(baris + 1).trim() };
      }
      return { judul: null, isi: p };
    });
}
