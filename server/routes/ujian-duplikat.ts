// server/routes/ujian-duplikat.ts — "Duplikasi ujian": membuat salinan berstatus draf dari ujian milik guru,
// supaya soal dari ujian yang sudah dipakai bisa dipakai lagi (permintaan pemilik 22 Nov).
// Dipanggil oleh: server/app.ts (dipasang di bawah /api; sesi guru dicek di app.ts untuk /api/ujian).
// Memanggil: shared/ujian.ts (skema & judul salinan), server/routes/ujian.ts (sisipUjian, muatUjianDetail),
//            server/berkas-pdf.ts, server/acak.ts, database.
// Aturan:
// - Boleh dari status apa pun (ujian asal tidak diubah sama sekali). Salinan selalu draf, kode baru.
// - Yang disalin: judul + " (salinan)", petunjuk, durasi, mode tampil, soal (urutan, teks, bobot, rubrik,
//   jawaban acuan, rujukan halaman PDF), dan PDF. Berkas PDF disalin ke nama acak baru, karena menghapus
//   salah satu ujian menghapus berkasnya sendiri.
// - Peserta hanya bila diminta, dan hanya nama + nomor (id anonim baru, tanpa PIN, status, atau jawaban).
// - Jawaban, event, log, dan waktu ujian asal tidak pernah ikut.
import { constants } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { Router } from 'express';
import { DuplikasiSchema, judulSalinan } from '../../shared/ujian.ts';
import { idAnonim } from '../acak.ts';
import { sesiDari } from '../auth/penjaga.ts';
import { hapusBerkas, namaBerkasBaru, pathBerkas } from '../berkas-pdf.ts';
import { validasi } from '../http.ts';
import type { Konteks } from '../konteks.ts';
import { catatAksiGuru, ParamUjian, ujianMilik } from './milik.ts';
import { muatUjianDetail, sisipUjian } from './ujian.ts';

type BarisUjianAsal = { judul: string; petunjuk: string; durasi_menit: number; mode_tampil: string };
type BarisPdfAsal = { id: number; nama_tampil: string; nama_berkas: string; ukuran_byte: number; sha256: string };
type BarisSoalAsal = {
  id: number;
  urutan: number;
  judul: string;
  teks: string;
  bobot: number;
  rubrik_json: string;
  jawaban_acuan: string;
  pdf_id: number | null;
  pdf_halaman: number | null;
};

export function ujianDuplikatRouter(k: Konteks): Router {
  const router = Router();

  router.post('/ujian/:id/duplikat', async (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilik(k, res, id);
    const { salin_peserta } = validasi(DuplikasiSchema, req.body);

    // 1. Salin berkas PDF lebih dulu, di luar transaksi: penyalinan berkas besar bersifat async dan tidak
    //    boleh menahan event loop (pengecek waktu ujian lain tetap harus berjalan tiap detik).
    const pdfAsal = k.db
      .prepare('SELECT id, nama_tampil, nama_berkas, ukuran_byte, sha256 FROM pdf WHERE ujian_id = ? ORDER BY id')
      .all(id) as BarisPdfAsal[];
    const salinan = new Map<number, { baris: BarisPdfAsal; namaBaru: string }>();
    try {
      if (pdfAsal.length > 0) await mkdir(k.uploadDir, { recursive: true });
      for (const p of pdfAsal) {
        const namaBaru = namaBerkasBaru();
        // COPYFILE_EXCL: tidak pernah menimpa berkas yang sudah ada.
        await copyFile(pathBerkas(k.uploadDir, p.nama_berkas), pathBerkas(k.uploadDir, namaBaru), constants.COPYFILE_EXCL);
        salinan.set(p.id, { baris: p, namaBaru });
      }
    } catch (galat) {
      for (const s of salinan.values()) await hapusBerkas(k.uploadDir, s.namaBaru);
      throw galat;
    }

    // 2. Semua baris DB dalam satu transaksi: salinan muncul utuh atau tidak sama sekali.
    let idBaru: number;
    try {
      idBaru = k.db.transaction(() => {
        // Dibaca ulang di dalam transaksi (ujian asal bisa saja dihapus selama berkas disalin → 404).
        ujianMilik(k, res, id);
        const asal = k.db
          .prepare('SELECT judul, petunjuk, durasi_menit, mode_tampil FROM ujian WHERE id = ?')
          .get(id) as BarisUjianAsal;
        const baru = sisipUjian(k, {
          pengujiId: sesiDari(res).pengujiId,
          judul: judulSalinan(asal.judul),
          petunjuk: asal.petunjuk,
          durasiMenit: asal.durasi_menit,
          modeTampil: asal.mode_tampil,
        });
        const sekarang = k.jam();

        const idPdfBaru = new Map<number, number>();
        const sisipPdf = k.db.prepare(
          `INSERT INTO pdf (ujian_id, nama_tampil, nama_berkas, ukuran_byte, sha256, diunggah_at)
           VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        );
        for (const [idLama, s] of salinan) {
          const idPdf = sisipPdf
            .pluck()
            .get(baru, s.baris.nama_tampil, s.namaBaru, s.baris.ukuran_byte, s.baris.sha256, sekarang) as number;
          idPdfBaru.set(idLama, idPdf);
        }

        const soal = k.db
          .prepare(
            `SELECT id, urutan, judul, teks, bobot, rubrik_json, jawaban_acuan, pdf_id, pdf_halaman
             FROM soal WHERE ujian_id = ? ORDER BY urutan, id`,
          )
          .all(id) as BarisSoalAsal[];
        const sisipSoal = k.db.prepare(
          `INSERT INTO soal (ujian_id, urutan, judul, teks, bobot, rubrik_json, jawaban_acuan, pdf_id, pdf_halaman,
             dibuat_at, diubah_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        soal.forEach((s, i) => {
          let pdfId: number | null = null;
          if (s.pdf_id !== null) {
            const dipetakan = idPdfBaru.get(s.pdf_id);
            // Hanya terjadi bila PDF diunggah ke ujian asal tepat selama penyalinan berkas berlangsung.
            if (dipetakan === undefined) throw new Error('PDF ujian asal berubah selama duplikasi; coba lagi');
            pdfId = dipetakan;
          }
          // Urutan dinomori ulang 1..n agar rapi walau ujian asal punya celah urutan.
          sisipSoal.run(baru, i + 1, s.judul, s.teks, s.bobot, s.rubrik_json, s.jawaban_acuan, pdfId,
            pdfId === null ? null : s.pdf_halaman, sekarang, sekarang);
        });

        let jumlahPeserta = 0;
        if (salin_peserta) {
          const peserta = k.db
            .prepare('SELECT nama, nomor FROM peserta WHERE ujian_id = ? ORDER BY id')
            .all(id) as { nama: string; nomor: string }[];
          const sisipPeserta = k.db.prepare(
            `INSERT INTO peserta (ujian_id, nama, nomor, id_anonim, dibuat_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (ujian_id, nama, nomor) DO NOTHING`,
          );
          for (const p of peserta) jumlahPeserta += sisipPeserta.run(baru, p.nama, p.nomor, idAnonim(), sekarang).changes;
        }

        catatAksiGuru(k, res, baru, 'duplikat_dari', {
          ujian_id: id,
          jumlah_soal: soal.length,
          jumlah_pdf: salinan.size,
          jumlah_peserta: jumlahPeserta,
        });
        return baru;
      })();
    } catch (galat) {
      for (const s of salinan.values()) await hapusBerkas(k.uploadDir, s.namaBaru);
      throw galat;
    }

    res.status(201).json(muatUjianDetail(k, idBaru));
  });

  return router;
}
