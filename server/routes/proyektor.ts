// server/routes/proyektor.ts — masuk layar proyektor dengan kode sekali pakai, dan profil sesinya.
// Dipanggil oleh: server/app.ts (dipasang di bawah /api).
// Memanggil: server/auth/*, shared/auth.ts, database.
// Endpoint: POST /proyektor/masuk, GET /proyektor/saya. Aliran data proyektor (SSE) dibuat di Fase 5.
// Sesi proyektor TIDAK membawa identitas guru (CHECK di skema), jadi layar kelas tidak pernah
// memegang akses ke soal, rubrik, atau data peserta (docs/DESAIN.md §1, K1).
import { Router } from 'express';
import { ProyektorMasukSchema } from '../../shared/auth.ts';
import type { ProyektorSaya, StatusUjian } from '../../shared/auth.ts';
import { sidik } from '../acak.ts';
import { ringkasPerangkat } from '../auth/perangkat.ts';
import { sesiDari, wajibSesi } from '../auth/penjaga.ts';
import { buatSesi, pasangCookieSesi } from '../auth/sesi.ts';
import { GalatHttp, tunda, validasi } from '../http.ts';
import type { Konteks } from '../konteks.ts';

export function proyektorRouter(k: Konteks): Router {
  const router = Router();
  const wajibProyektor = wajibSesi(k.db, k.jam, 'proyektor');

  // Kode salah dijawab setelah jeda tetap (sama seperti kode ujian, lihat server/konteks.ts);
  // kode benar langsung diterima. Kode 8 karakter (31^8 kemungkinan) yang berlaku 10 menit.
  router.post('/proyektor/masuk', async (req, res) => {
    const { kode } = validasi(ProyektorMasukSchema, req.body);
    const sekarang = k.jam();
    const token = k.db.transaction(() => {
      // Kode hanya berlaku sekali: dipakai_at diisi dalam transaksi yang sama dengan pembuatan sesi.
      const tautan = k.db
        .prepare(
          `UPDATE tautan_proyektor SET dipakai_at = ?
           WHERE kode_hash = ? AND dipakai_at IS NULL AND kedaluwarsa_at > ?
           RETURNING ujian_id`,
        )
        .get(sekarang, sidik(kode), sekarang) as { ujian_id: number } | undefined;
      if (!tautan) return null;
      return buatSesi(k.db, sekarang, {
        lingkup: 'proyektor',
        ujianId: tautan.ujian_id,
        infoPerangkat: ringkasPerangkat(req.get('user-agent')),
      });
    })();
    if (!token) {
      await tunda(k.opsi.jedaKodeSalahMs);
      throw new GalatHttp(404, 'kode_salah');
    }
    pasangCookieSesi(req, res, 'proyektor', token, k.originPublik);
    res.status(204).end();
  });

  router.get('/proyektor/saya', wajibProyektor, (_req, res) => {
    const ujian = k.db
      .prepare('SELECT judul, status FROM ujian WHERE id = ?')
      .get(sesiDari(res).ujianId) as { judul: string; status: StatusUjian } | undefined;
    if (!ujian) throw new GalatHttp(401, 'belum_masuk');
    const body: ProyektorSaya = { ujian: { judul: ujian.judul, status: ujian.status } };
    res.json(body);
  });

  return router;
}
