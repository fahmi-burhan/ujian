// client/src/pdf.ts — memuat dokumen PDF buku dengan PDF.js, sekali per PDF selama halaman terbuka.
// Dipanggil oleh: client/src/komponen/peserta/PembacaPdf.vue (dimuat terpisah/lazy, jadi PDF.js tidak ikut
//                 terunduh di halaman masuk).
// Memanggil: pdfjs-dist (build "legacy"), berkas pendukung di /pdfjs/* (disajikan server dari node_modules).
// Alasan memakai build legacy: build modern PDF.js 6 memakai fitur JavaScript yang sangat baru
// (mis. Map.prototype.getOrInsertComputed) sehingga gagal di Chrome/Edge yang belum diperbarui. Build legacy
// berisi polyfill-nya. Laptop sekolah sering tertinggal versi.
// PDF dirender ke <canvas> di dokumen yang sama (bukan <iframe>/<embed> bawaan browser): viewer bawaan
// memicu `blur` (tercatat sebagai keluar halaman) dan menampilkan tombol unduh (CLAUDE.md).
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import urlWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = urlWorker;

const cache = new Map<number, Promise<PDFDocumentProxy>>();

// PDF dimuat bertahap lewat HTTP Range, lalu sisanya diunduh di latar belakang (disableAutoFetch: false),
// sehingga buku sudah utuh di memori sejak ruang tunggu dan tidak ada lonjakan unduhan saat Mulai.
// Hasilnya disimpan di memori halaman (server mengirim no-store, jadi tidak tertinggal di laptop bersama).
export function muatPdf(pdfId: number): Promise<PDFDocumentProxy> {
  let janji = cache.get(pdfId);
  if (!janji) {
    janji = getDocument({
      url: `/api/peserta/pdf/${pdfId}`,
      cMapUrl: '/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/standard_fonts/',
      wasmUrl: '/pdfjs/wasm/',
      iccUrl: '/pdfjs/iccs/',
      rangeChunkSize: 256 * 1024,
      // Tautan/skrip/form di dalam PDF tidak dibutuhkan untuk membaca buku.
      enableXfa: false,
    }).promise;
    // Gagal (mis. jaringan putus) → dihapus dari cache supaya bisa dicoba lagi.
    janji.catch(() => cache.delete(pdfId));
    cache.set(pdfId, janji);
  }
  return janji;
}
