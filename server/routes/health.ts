// server/routes/health.ts — endpoint GET /api/health: tanda server hidup + jam server.
// Dipanggil oleh: server/app.ts (dipasang di bawah /api).
// Memanggil: database (query ringan untuk memastikan berkas DB bisa dibaca), shared/health.ts.
// Kegunaan: dicek setelah deploy di VPS, dan dipakai klien menghitung selisih jam.
import { Router } from 'express';
import type { Db } from '../db/connection.ts';
import type { HealthResponse } from '../../shared/health.ts';

export function healthRouter(db: Db): Router {
  const router = Router();
  const ping = db.prepare('SELECT 1');

  router.get('/health', (_req, res) => {
    // Bila DB rusak/terkunci, get() melempar error dan ditangani error handler di app.ts (500).
    ping.get();
    const body: HealthResponse = { ok: true, serverTime: Date.now() };
    // Jangan di-cache: jam server harus selalu baru.
    res.set('Cache-Control', 'no-store').json(body);
  });

  return router;
}
