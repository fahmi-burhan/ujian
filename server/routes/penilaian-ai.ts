// server/routes/penilaian-ai.ts — rute guru untuk draf nilai AI: status antrean & biaya, mulai, dan hentikan.
// Dipanggil oleh: server/app.ts (dipasang di bawah /api; sesi guru dicek di app.ts untuk /api/ujian).
// Memanggil: server/ai/antrean.ts, server/ai/harga.ts (lewat antrean), server/routes/milik.ts, shared/ai.ts, database.
// Aturan:
// - Hanya di tahap `penilaian` (mulai/hentikan); status boleh dilihat juga saat `dirilis`.
// - Mulai ditolak bila kunci API belum diisi, run lain masih berjalan, tidak ada jawaban yang perlu dinilai, atau
//   batas biaya bulan ini sudah habis. Batas biaya juga dijaga per permintaan oleh antrean.
// - Respons tidak pernah memuat kunci API atau isi jawaban.
import { Router } from 'express';
import type { Response } from 'express';
import { LABEL_MODEL_AI, MODEL_AI, MulaiAiSchema, STATUS_TUGAS_AI, usd } from '../../shared/ai.ts';
import type { StatusAi } from '../../shared/ai.ts';
import { sesiDari } from '../auth/penjaga.ts';
import { jawabanBelumDinilai, perkiraanMikro } from '../ai/antrean.ts';
import { GalatHttp, validasi } from '../http.ts';
import type { Konteks } from '../konteks.ts';
import { catatAksiGuru, ParamUjian, ujianMilikDiStatus } from './milik.ts';

type BarisRun = { id: number; model: string; status: 'berjalan' | 'selesai' | 'dihentikan'; alasan_berhenti: string | null; dibuat_at: number; selesai_at: number | null };

export function muatStatusAi(k: Konteks, ujianId: number): StatusAi {
  const target = jawabanBelumDinilai(k.db, ujianId);
  const run = k.db
    .prepare('SELECT id, model, status, alasan_berhenti, dibuat_at, selesai_at FROM ai_run WHERE ujian_id = ? ORDER BY id DESC LIMIT 1')
    .get(ujianId) as BarisRun | undefined;
  let ringkasRun: StatusAi['run'] = null;
  if (run) {
    const jumlah = Object.fromEntries(STATUS_TUGAS_AI.map((s) => [s, 0])) as Record<(typeof STATUS_TUGAS_AI)[number], number>;
    for (const b of k.db.prepare('SELECT status, COUNT(*) AS n FROM ai_tugas WHERE run_id = ? GROUP BY status').all(run.id) as {
      status: (typeof STATUS_TUGAS_AI)[number];
      n: number;
    }[]) {
      jumlah[b.status] = b.n;
    }
    const biaya = k.db.prepare('SELECT COALESCE(SUM(biaya_mikro_usd), 0) FROM ai_pemakaian WHERE run_id = ?').pluck().get(run.id) as number;
    ringkasRun = { ...run, jumlah, biaya_usd: usd(biaya) };
  }
  return {
    tersedia: k.ai.adapter !== null,
    model: MODEL_AI.map((id) => ({ id, ...LABEL_MODEL_AI[id] })),
    model_bawaan: k.ai.opsi.modelBawaan,
    batas_usd_bulanan: usd(k.ai.opsi.batasMikroUsd),
    terpakai_usd_bulan_ini: usd(k.ai.terpakaiBulanIniMikro()),
    belum_dinilai: target.length,
    perkiraan_usd: Object.fromEntries(MODEL_AI.map((m) => [m, usd(perkiraanMikro(m, target))])),
    run: ringkasRun,
  };
}

export function penilaianAiRouter(k: Konteks): Router {
  const router = Router();

  const kirim = (res: Response, id: number): void => {
    res.set('Cache-Control', 'private, no-store');
    res.json(muatStatusAi(k, id));
  };

  router.get('/ujian/:id/ai', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilikDiStatus(k, res, id, ['penilaian', 'dirilis']);
    kirim(res, id);
  });

  router.post('/ujian/:id/ai/mulai', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilikDiStatus(k, res, id, ['penilaian']);
    const { model } = validasi(MulaiAiSchema, req.body);
    if (!k.ai.adapter) throw new GalatHttp(409, 'ai_belum_diatur');
    const berjalan = k.db.prepare("SELECT 1 FROM ai_run WHERE ujian_id = ? AND status = 'berjalan'").get(id);
    if (berjalan) throw new GalatHttp(409, 'ai_sedang_berjalan');
    const jumlah = jawabanBelumDinilai(k.db, id).length;
    if (jumlah === 0) throw new GalatHttp(409, 'tidak_ada_jawaban');
    if (k.ai.terpakaiBulanIniMikro() >= k.ai.opsi.batasMikroUsd) throw new GalatHttp(409, 'batas_biaya');
    const pengujiId = sesiDari(res).pengujiId;
    // Rute /api/ujian hanya bisa dicapai sesi guru (app.ts), jadi pengujiId selalu terisi di sini.
    if (pengujiId === null) throw new GalatHttp(401, 'belum_masuk');
    const runId = k.ai.mulai(id, pengujiId, model);
    catatAksiGuru(k, res, id, 'ai_mulai', { run_id: runId, model, jumlah });
    res.status(202);
    kirim(res, id);
  });

  router.post('/ujian/:id/ai/hentikan', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilikDiStatus(k, res, id, ['penilaian', 'dirilis']);
    if (k.ai.hentikan(id, 'guru')) catatAksiGuru(k, res, id, 'ai_hentikan');
    kirim(res, id);
  });

  return router;
}
