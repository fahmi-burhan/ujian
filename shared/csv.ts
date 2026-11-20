// shared/csv.ts — membaca daftar peserta dari teks CSV (impor peserta, docs/DESAIN.md §8).
// Dipanggil oleh: server/routes/peserta-guru.ts (yang menentukan), dan klien untuk pratinjau sebelum kirim.
// Memanggil: tidak ada (tanpa pustaka CSV tambahan).
// Yang didukung, karena sumbernya biasanya Excel/Google Sheets berbahasa Indonesia:
// - UTF-8 dengan/tanpa BOM; baris CRLF atau LF.
// - Pemisah dideteksi dari baris pertama: ";" (Excel locale Indonesia), "," , atau Tab (hasil salin-tempel
//   langsung dari Excel/Sheets).
// - Sel berkutip "..." termasuk "" di dalamnya dan baris baru di dalam kutip.
// - Kolom: nama[, nomor]. Baris judul ("nama", "nama siswa", ...) di baris pertama dilewati.

export type BarisCsv = { baris: number; sel: string[] };

function deteksiPemisah(teks: string): string {
  const barisPertama = teks.split('\n', 1)[0] ?? '';
  const hitung = (c: string): number => barisPertama.split(c).length - 1;
  const kandidat = ['\t', ';', ','].map((c) => ({ c, n: hitung(c) }));
  kandidat.sort((a, b) => b.n - a.n);
  return kandidat[0] && kandidat[0].n > 0 ? kandidat[0].c : ',';
}

// Mengurai teks CSV menjadi baris-baris sel. Nomor baris mengikuti baris di berkas (mulai 1),
// supaya pesan "baris 7 dilewati" cocok dengan yang dilihat guru di Excel.
export function uraiCsv(masukan: string): BarisCsv[] {
  const teks = masukan.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const pemisah = deteksiPemisah(teks);
  const hasil: BarisCsv[] = [];
  let sel = '';
  let baris: string[] = [];
  let nomorBaris = 1;
  let awalBaris = 1;
  let dalamKutip = false;

  const tutupBaris = (): void => {
    baris.push(sel);
    if (baris.some((s) => s.trim() !== '')) hasil.push({ baris: awalBaris, sel: baris.map((s) => s.trim()) });
    baris = [];
    sel = '';
  };

  for (let i = 0; i < teks.length; i++) {
    const c = teks[i];
    if (dalamKutip) {
      if (c === '"') {
        if (teks[i + 1] === '"') {
          sel += '"';
          i++;
        } else {
          dalamKutip = false;
        }
      } else {
        if (c === '\n') nomorBaris++;
        sel += c;
      }
    } else if (c === '"' && sel.trim() === '') {
      sel = '';
      dalamKutip = true;
    } else if (c === pemisah) {
      baris.push(sel);
      sel = '';
    } else if (c === '\n') {
      tutupBaris();
      nomorBaris++;
      awalBaris = nomorBaris;
    } else {
      sel += c;
    }
  }
  if (sel !== '' || baris.length > 0) tutupBaris();
  return hasil;
}

const JUDUL_KOLOM_NAMA = /^(nama|nama siswa|nama peserta|nama lengkap|name)$/i;

export type CalonPeserta = { baris: number; nama: string; nomor: string };

// Mengambil kolom nama & nomor. Baris judul dilewati. Validasi panjang dilakukan pemanggil (Zod).
export function pesertaDariCsv(masukan: string): CalonPeserta[] {
  const semua = uraiCsv(masukan);
  const awal = semua[0] && JUDUL_KOLOM_NAMA.test(semua[0].sel[0] ?? '') ? 1 : 0;
  return semua.slice(awal).map((b) => ({ baris: b.baris, nama: b.sel[0] ?? '', nomor: b.sel[1] ?? '' }));
}
