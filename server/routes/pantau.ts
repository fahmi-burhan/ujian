// server/routes/pantau.ts — dasbor pemantauan guru: potret & aliran SSE, jawaban per siswa, dan tanda "wajar"
// pada aktivitas.
// Dipanggil oleh: server/app.ts (dipasang di bawah /api; sesi guru dicek di app.ts untuk /api/ujian).
// Memanggil: server/pantau.ts, server/sse.ts, server/routes/milik.ts, shared/pantau.ts, database.
// Kontrak: docs/DESAIN.md §8 (GET /pantau, SSE /pantau/stream, GET jawaban, PATCH event, POST event/tandai-wajar-semua)
// dan §8.1 (field guru).
// Semua endpoint hanya untuk guru PEMILIK ujian (lainnya 404).
import { Router } from 'express';
import { z } from 'zod';
import type { StatusPeserta, StatusUjian } from '../../shared/auth.ts';
import { TandaiEventSchema, TandaiWajarSemuaSchema } from '../../shared/pantau.ts';
import type { JawabanGuru } from '../../shared/pantau.ts';
import { sesiDari } from '../auth/penjaga.ts';
import { GalatHttp, validasi } from '../http.ts';
import type { Konteks } from '../konteks.ts';
import { bacaEventPeserta, beritahuPantau, muatPantau } from '../pantau.ts';
import { catatAksiGuru, ParamPeserta, ParamUjian, ujianMilik, ujianMilikDiStatus } from './milik.ts';

const ParamEvent = ParamUjian.extend({ eventId: z.coerce.number().int().positive() });

// Jawaban siswa baru ada setelah ujian dimulai.
const JAWABAN_TERLIHAT: readonly StatusUjian[] = ['berlangsung', 'dijeda', 'selesai', 'penilaian', 'dirilis'];

export function pantauRouter(k: Konteks): Router {
  const router = Router();

  router.get('/ujian/:id/pantau', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilik(k, res, id);
    res.json(muatPantau(k, id));
  });

  // Aliran potret dasbor. Koneksi baru langsung menerima potret terkini (supaya sambungan ulang tidak basi).
  router.get('/ujian/:id/pantau/stream', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilik(k, res, id);
    k.sse.bukaAliran(req, res);
    k.sse.daftarPantau(req, { res, jenis: 'guru', ujianId: id, sesiHash: sesiDari(res).idHash });
    const data = muatPantau(k, id);
    if (data) k.sse.kirim(res, 'pantau', data);
  });

  // Jawaban terkini, riwayat versi, jawaban terlambat, dan semua aktivitas satu siswa. Hanya untuk dibaca;
  // keputusan jawaban terlambat & pemulihan versi dibuat bersama penilaian (Fase 6).
  router.get('/ujian/:id/peserta/:pid/jawaban', (req, res) => {
    const { id, pid } = validasi(ParamPeserta, req.params);
    ujianMilikDiStatus(k, res, id, JAWABAN_TERLIHAT);
    const peserta = k.db
      .prepare('SELECT id, nama, nomor, status FROM peserta WHERE id = ? AND ujian_id = ?')
      .get(pid, id) as { id: number; nama: string; nomor: string; status: StatusPeserta } | undefined;
    if (!peserta) throw new GalatHttp(404, 'tidak_ditemukan');
    const jawaban = k.db
      .prepare('SELECT soal_id, isi, versi, ditandai, diubah_at FROM jawaban WHERE peserta_id = ? AND ujian_id = ? ORDER BY soal_id')
      .all(pid, id) as (Omit<JawabanGuru['jawaban'][number], 'ditandai'> & { ditandai: number })[];
    const body: JawabanGuru = {
      peserta,
      soal: k.db.prepare('SELECT id, urutan, judul FROM soal WHERE ujian_id = ? ORDER BY urutan, id').all(id) as JawabanGuru['soal'],
      jawaban: jawaban.map((j) => ({ ...j, ditandai: j.ditandai === 1 })),
      riwayat: k.db
        .prepare(
          `SELECT v.soal_id, v.versi, v.isi, v.alasan, v.disimpan_at FROM jawaban_versi v
           JOIN peserta p ON p.id = v.peserta_id WHERE v.peserta_id = ? AND p.ujian_id = ?
           ORDER BY v.soal_id, v.versi DESC`,
        )
        .all(pid, id) as JawabanGuru['riwayat'],
      terlambat: k.db
        .prepare(
          `SELECT id, soal_id, isi, diterima_at, alasan, keputusan FROM jawaban_terlambat
           WHERE peserta_id = ? AND ujian_id = ? ORDER BY diterima_at, id`,
        )
        .all(pid, id) as JawabanGuru['terlambat'],
      event: bacaEventPeserta(k, id, pid),
    };
    res.json(body);
  });

  // Guru menandai aktivitas "wajar" (mis. laptop mati yang sudah dikonfirmasi): tidak dihitung di
  // proyektor maupun ringkasan. Catatan guru untuk ditelusuri bila ada pertanyaan.
  router.patch('/ujian/:id/event/:eventId', (req, res) => {
    const { id, eventId } = validasi(ParamEvent, req.params);
    ujianMilik(k, res, id);
    const input = validasi(TandaiEventSchema, req.body);
    k.db.transaction(() => {
      const berubah = k.db
        .prepare('UPDATE event_integritas SET ditandai_wajar = ?, catatan_penguji = ? WHERE id = ? AND ujian_id = ?')
        .run(input.ditandai_wajar ? 1 : 0, input.catatan_penguji, eventId, id).changes;
      if (berubah === 0) throw new GalatHttp(404, 'tidak_ditemukan');
      catatAksiGuru(k, res, id, 'tandai_event', { event_id: eventId, ditandai_wajar: input.ditandai_wajar });
    })();
    beritahuPantau(k, id);
    res.status(204).end();
  });

  // Tandai "wajar" semua aktivitas yang belum ditandai, sudah selesai, dan sudah dilihat guru (id ≤ sampai_id);
  // opsional satu jenis saja. Catatan guru yang ada tidak diubah.
  router.post('/ujian/:id/event/tandai-wajar-semua', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilik(k, res, id);
    const { jenis, sampai_id } = validasi(TandaiWajarSemuaSchema, req.body ?? {});
    const jumlah = k.db.transaction(() => {
      const n = k.db
        .prepare(
          `UPDATE event_integritas SET ditandai_wajar = 1
           WHERE ujian_id = ? AND ditandai_wajar = 0 AND selesai_at IS NOT NULL AND id <= ? AND (? IS NULL OR jenis = ?)`,
        )
        .run(id, sampai_id, jenis, jenis).changes;
      if (n > 0) catatAksiGuru(k, res, id, 'tandai_event_semua', { jumlah: n, jenis });
      return n;
    })();
    if (jumlah > 0) beritahuPantau(k, id);
    res.json({ jumlah });
  });

  return router;
}
