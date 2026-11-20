// server/routes/pdf.ts — berkas PDF buku milik ujian: unggah, sajikan (untuk pratinjau guru), hapus.
// Dipanggil oleh: server/app.ts (dipasang di bawah /api; sesi guru dicek di app.ts untuk /api/ujian).
// Memanggil: express.raw (tanpa pustaka unggah), server/berkas-pdf.ts, server/routes/milik.ts, database.
// Kontrak (docs/DESAIN.md §8):
// - Unggah: body mentah `application/pdf` maks 30 MB, nama asli di header X-Nama-Berkas (URL-encoded).
//   Isi wajib diawali "%PDF-". Di disk disimpan dengan nama acak buatan server.
// - Sajikan: mendukung HTTP Range (PDF.js memuat bertahap). Endpoint PDF untuk siswa ada di peserta-ujian.ts.
// - Hapus: rujukan soal ke PDF itu dikosongkan dulu.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import express, { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { BATAS } from '../../shared/ujian.ts';
import type { PdfInfo } from '../../shared/ujian.ts';
import { hapusBerkas, kirimPdf, namaBerkasBaru, pathBerkas } from '../berkas-pdf.ts';
import { GalatHttp, validasi } from '../http.ts';
import type { Konteks } from '../konteks.ts';
import { catatAksiGuru, ParamPdf, ParamUjian, sentuhUjian, ujianMilik, ujianMilikDiStatus } from './milik.ts';

const AWALAN_PDF = Buffer.from('%PDF-');

// Nama tampil dari header: didekode, karakter kendali & pembalik arah teks (bidi, bisa dipakai menyamarkan
// nama berkas) dibuang, dipotong 200 karakter.
// Nama ini TERLIHAT peserta di ruang tunggu, jadi guru diingatkan di UI agar tidak berisi petunjuk soal.
function namaTampil(header: string | undefined): string {
  let nama = '';
  try {
    nama = decodeURIComponent(header ?? '');
  } catch {
    nama = '';
  }
  nama = nama
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim()
    .slice(0, BATAS.namaPdf);
  return nama.length > 0 ? nama : 'Buku.pdf';
}

export function pdfRouter(k: Konteks): Router {
  const router = Router();

  function jumlahPdf(ujianId: number): number {
    return k.db.prepare('SELECT COUNT(*) FROM pdf WHERE ujian_id = ?').pluck().get(ujianId) as number;
  }

  // Kepemilikan & fase dicek SEBELUM body 30 MB dibaca, supaya unggahan yang pasti ditolak tidak
  // sempat membebani server.
  function cekSebelumUnggah(req: Request, res: Response, next: NextFunction): void {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilikDiStatus(k, res, id, ['draf']);
    if (jumlahPdf(id) >= BATAS.jumlahPdf) throw new GalatHttp(409, 'batas_tercapai');
    next();
  }

  router.post(
    '/ujian/:id/pdf',
    cekSebelumUnggah,
    express.raw({ type: 'application/pdf', limit: BATAS.pdfByte }),
    async (req, res) => {
      const { id } = validasi(ParamUjian, req.params);
      const isi: unknown = req.body;
      if (!Buffer.isBuffer(isi) || isi.length < AWALAN_PDF.length || !isi.subarray(0, AWALAN_PDF.length).equals(AWALAN_PDF)) {
        throw new GalatHttp(400, 'bukan_pdf');
      }
      const nama = namaTampil(req.get('x-nama-berkas'));
      const namaBerkas = namaBerkasBaru();
      await mkdir(k.uploadDir, { recursive: true });
      // flag 'wx': gagal bila berkas sudah ada (tidak pernah menimpa berkas lain).
      await writeFile(pathBerkas(k.uploadDir, namaBerkas), isi, { flag: 'wx' });
      let pdf: PdfInfo;
      try {
        pdf = k.db.transaction(() => {
          // Dicek ulang di dalam transaksi: ujian bisa saja sudah dibuka selama berkas diunggah, dan
          // beberapa unggahan paralel bisa sama-sama lolos cek jumlah di awal.
          ujianMilikDiStatus(k, res, id, ['draf']);
          if (jumlahPdf(id) >= BATAS.jumlahPdf) throw new GalatHttp(409, 'batas_tercapai');
          const baris = k.db
            .prepare(
              `INSERT INTO pdf (ujian_id, nama_tampil, nama_berkas, ukuran_byte, sha256, diunggah_at)
               VALUES (?, ?, ?, ?, ?, ?) RETURNING id, nama_tampil, ukuran_byte, diunggah_at`,
            )
            .get(id, nama, namaBerkas, isi.length, createHash('sha256').update(isi).digest('hex'), k.jam()) as PdfInfo;
          catatAksiGuru(k, res, id, 'unggah_pdf', { pdf_id: baris.id, ukuran_byte: baris.ukuran_byte });
          sentuhUjian(k, id);
          return baris;
        })();
      } catch (galat) {
        await hapusBerkas(k.uploadDir, namaBerkas);
        throw galat;
      }
      res.status(201).json(pdf);
    },
  );

  router.get('/ujian/:id/pdf/:pdfId', (req, res, next) => {
    const { id, pdfId } = validasi(ParamPdf, req.params);
    ujianMilik(k, res, id);
    const namaBerkas = k.db
      .prepare('SELECT nama_berkas FROM pdf WHERE id = ? AND ujian_id = ?')
      .pluck()
      .get(pdfId, id) as string | undefined;
    if (!namaBerkas) throw new GalatHttp(404, 'tidak_ditemukan');
    kirimPdf(k.uploadDir, namaBerkas, res, next);
  });

  router.delete('/ujian/:id/pdf/:pdfId', async (req, res) => {
    const { id, pdfId } = validasi(ParamPdf, req.params);
    ujianMilikDiStatus(k, res, id, ['draf']);
    const namaBerkas = k.db.transaction(() => {
      const nama = k.db
        .prepare('SELECT nama_berkas FROM pdf WHERE id = ? AND ujian_id = ?')
        .pluck()
        .get(pdfId, id) as string | undefined;
      if (!nama) throw new GalatHttp(404, 'tidak_ditemukan');
      k.db.prepare('UPDATE soal SET pdf_id = NULL, pdf_halaman = NULL WHERE pdf_id = ? AND ujian_id = ?').run(pdfId, id);
      k.db.prepare('DELETE FROM pdf WHERE id = ? AND ujian_id = ?').run(pdfId, id);
      catatAksiGuru(k, res, id, 'hapus_pdf', { pdf_id: pdfId });
      sentuhUjian(k, id);
      return nama;
    })();
    await hapusBerkas(k.uploadDir, namaBerkas);
    res.status(204).end();
  });

  return router;
}
