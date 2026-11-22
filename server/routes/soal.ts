// server/routes/soal.ts — soal esai beserta rubrik & jawaban acuan: tambah, ubah, hapus, atur urutan.
// Dipanggil oleh: server/app.ts (dipasang di bawah /api; sesi guru dicek di app.ts untuk /api/ujian).
// Memanggil: shared/ujian.ts, server/routes/milik.ts, server/routes/ujian.ts (muatSoalGuru), database.
// Semua aksi hanya saat ujian DRAF: setelah dibuka, soal & rubrik terkunci (docs/DESAIN.md §2–3).
// Rubrik boleh disimpan setengah jadi; kelengkapannya baru dituntut saat "Buka ujian".
import { Router } from 'express';
import type { Response } from 'express';
import { BATAS, SoalInputSchema, UrutanSoalSchema } from '../../shared/ujian.ts';
import type { Rujukan, SoalGuru } from '../../shared/ujian.ts';
import { GalatHttp, validasi } from '../http.ts';
import type { Konteks } from '../konteks.ts';
import { ParamSoal, ParamUjian, sentuhUjian, ujianMilikDiStatus } from './milik.ts';
import { muatSoalGuru } from './ujian.ts';

export function soalRouter(k: Konteks): Router {
  const router = Router();

  // Setiap PDF rujukan wajib milik ujian yang sama (FK komposit di skema juga menjaganya).
  function cekPdf(ujianId: number, rujukan: Rujukan[]): void {
    const ada = k.db.prepare('SELECT 1 FROM pdf WHERE id = ? AND ujian_id = ?');
    for (const r of rujukan) {
      if (!ada.get(r.pdf_id, ujianId)) throw new GalatHttp(404, 'tidak_ditemukan');
    }
  }

  // Editor selalu mengirim daftar rujukan utuh: yang lama diganti seluruhnya, urutan mengikuti kiriman.
  function simpanRujukan(ujianId: number, soalId: number, rujukan: Rujukan[]): void {
    k.db.prepare('DELETE FROM soal_rujukan WHERE soal_id = ? AND ujian_id = ?').run(soalId, ujianId);
    const sisip = k.db.prepare('INSERT INTO soal_rujukan (soal_id, ujian_id, urutan, pdf_id, halaman) VALUES (?, ?, ?, ?, ?)');
    rujukan.forEach((r, i) => sisip.run(soalId, ujianId, i + 1, r.pdf_id, r.halaman));
  }

  function soalSatu(ujianId: number, soalId: number): SoalGuru {
    const soal = muatSoalGuru(k, ujianId).find((s) => s.id === soalId);
    if (!soal) throw new GalatHttp(404, 'tidak_ditemukan');
    return soal;
  }

  // Urutan dirapikan menjadi 1, 2, 3, … (dipanggil setelah menghapus soal).
  function rapikanUrutan(ujianId: number): void {
    k.db
      .prepare(
        `UPDATE soal SET urutan = r.n FROM (
           SELECT id, ROW_NUMBER() OVER (ORDER BY urutan, id) AS n FROM soal WHERE ujian_id = ?
         ) AS r WHERE soal.id = r.id`,
      )
      .run(ujianId);
  }

  function draf(res: Response, id: number): void {
    ujianMilikDiStatus(k, res, id, ['draf']);
  }

  router.post('/ujian/:id/soal', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    draf(res, id);
    const soal = validasi(SoalInputSchema, req.body);
    cekPdf(id, soal.rujukan);
    const sekarang = k.jam();
    const soalId = k.db.transaction(() => {
      const jumlah = k.db.prepare('SELECT COUNT(*) FROM soal WHERE ujian_id = ?').pluck().get(id) as number;
      if (jumlah >= BATAS.jumlahSoal) throw new GalatHttp(409, 'batas_tercapai');
      const baru = k.db
        .prepare(
          `INSERT INTO soal (ujian_id, urutan, judul, teks, bobot, rubrik_json, jawaban_acuan, dibuat_at, diubah_at)
           VALUES (?, (SELECT COALESCE(MAX(urutan), 0) + 1 FROM soal WHERE ujian_id = ?), ?, ?, ?, ?, ?, ?, ?)
           RETURNING id`,
        )
        .pluck()
        .get(
          id,
          id,
          soal.judul,
          soal.teks,
          soal.bobot,
          JSON.stringify(soal.rubrik),
          soal.jawaban_acuan,
          sekarang,
          sekarang,
        ) as number;
      simpanRujukan(id, baru, soal.rujukan);
      sentuhUjian(k, id);
      return baru;
    })();
    res.status(201).json(soalSatu(id, soalId));
  });

  // Satu bentuk body untuk tambah & ubah: editor guru selalu mengirim soal utuh.
  router.patch('/ujian/:id/soal/:soalId', (req, res) => {
    const { id, soalId } = validasi(ParamSoal, req.params);
    draf(res, id);
    soalSatu(id, soalId);
    const soal = validasi(SoalInputSchema, req.body);
    cekPdf(id, soal.rujukan);
    k.db.transaction(() => {
      k.db
        .prepare(
          `UPDATE soal SET judul = ?, teks = ?, bobot = ?, rubrik_json = ?, jawaban_acuan = ?, diubah_at = ?
           WHERE id = ? AND ujian_id = ?`,
        )
        .run(
          soal.judul,
          soal.teks,
          soal.bobot,
          JSON.stringify(soal.rubrik),
          soal.jawaban_acuan,
          k.jam(),
          soalId,
          id,
        );
      simpanRujukan(id, soalId, soal.rujukan);
      sentuhUjian(k, id);
    })();
    res.json(soalSatu(id, soalId));
  });

  router.delete('/ujian/:id/soal/:soalId', (req, res) => {
    const { id, soalId } = validasi(ParamSoal, req.params);
    draf(res, id);
    soalSatu(id, soalId);
    k.db.transaction(() => {
      k.db.prepare('DELETE FROM soal WHERE id = ? AND ujian_id = ?').run(soalId, id);
      rapikanUrutan(id);
      sentuhUjian(k, id);
    })();
    res.status(204).end();
  });

  // `ids` harus berisi PERSIS semua soal ujian ini (tanpa kurang, lebih, atau dobel).
  router.put('/ujian/:id/soal/urutan', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    draf(res, id);
    const { ids } = validasi(UrutanSoalSchema, req.body);
    k.db.transaction(() => {
      const ada = (k.db.prepare('SELECT id FROM soal WHERE ujian_id = ?').pluck().all(id) as number[]).sort((a, b) => a - b);
      const diminta = [...ids].sort((a, b) => a - b);
      if (ada.length !== diminta.length || ada.some((v, i) => v !== diminta[i])) {
        throw new GalatHttp(400, 'input_tidak_valid');
      }
      const ubah = k.db.prepare('UPDATE soal SET urutan = ? WHERE id = ? AND ujian_id = ?');
      ids.forEach((soalId, i) => ubah.run(i + 1, soalId, id));
      sentuhUjian(k, id);
    })();
    res.status(204).end();
  });

  return router;
}
