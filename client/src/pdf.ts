// client/src/pdf.ts — memuat dokumen PDF.js dari data buku yang sudah diunduh utuh (client/src/buku.ts), sekali per
// buku selama halaman terbuka.
// Dipanggil oleh: client/src/komponen/peserta/PembacaPdf.vue (dimuat terpisah/lazy, jadi PDF.js tidak ikut terunduh
//                 di halaman masuk). Memanggil: client/src/buku.ts, pdfjs-dist (build "legacy"), berkas pendukung di
//                 /pdfjs/* (disajikan server dari node_modules).
// Alasan build legacy: build modern PDF.js 6 memakai fitur JavaScript yang sangat baru
// (mis. Map.prototype.getOrInsertComputed) sehingga gagal di Chrome/Edge yang belum diperbarui. Build legacy
// berisi polyfill-nya. Laptop sekolah sering tertinggal versi.
// PDF dirender ke <canvas> di dokumen yang sama (bukan <iframe>/<embed> bawaan browser): viewer bawaan
// memicu `blur` (tercatat sebagai keluar halaman) dan menampilkan tombol unduh (CLAUDE.md).
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import urlWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { ambilDataBuku, lepasDataBuku, saatLupakanBuku } from './buku.ts';

GlobalWorkerOptions.workerSrc = urlWorker;

// ---- Dokumen PDF.js ----
const cache = new Map<number, Promise<PDFDocumentProxy>>();

export function muatPdf(pdfId: number): Promise<PDFDocumentProxy> {
  let janji = cache.get(pdfId);
  if (!janji) {
    const data = ambilDataBuku(pdfId);
    janji = data.then(
      (data) =>
        getDocument({
          // Data diserahkan ke worker PDF.js (bisa dipindahkan, bukan disalin) supaya buku tidak memakan memori dua
          // kali; dokumennya sendiri disimpan di `cache` selama halaman terbuka.
          data,
          cMapUrl: '/pdfjs/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdfjs/standard_fonts/',
          wasmUrl: '/pdfjs/wasm/',
          iccUrl: '/pdfjs/iccs/',
          // Tautan/skrip/form di dalam PDF tidak dibutuhkan untuk membaca buku.
          enableXfa: false,
        }).promise,
    );
    // Gagal (unduhan putus permanen atau berkas rusak) → dihapus dari cache & antrean supaya "Coba lagi" mengunduh ulang.
    const ini = janji;
    janji.catch(() => {
      if (cache.get(pdfId) === ini) cache.delete(pdfId);
      lepasDataBuku(pdfId, data);
    });
    cache.set(pdfId, janji);
  }
  return janji;
}

// Ujian selesai / siswa keluar: dokumen ditutup supaya memori worker PDF.js dilepas.
saatLupakanBuku(() => {
  for (const [id, janji] of cache) {
    cache.delete(id);
    janji.then((d) => d.loadingTask.destroy()).catch(() => {});
  }
});
