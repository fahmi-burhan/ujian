// server/routes/ujian-admin.ts — aksi guru terkait akses: reset PIN, buka kunci, kode & cabut proyektor.
// Dipanggil oleh: server/app.ts (dipasang di bawah /api).
// Memanggil: server/auth/*, server/acak.ts, database.
// Setiap aksi hanya boleh untuk ujian MILIK guru yang sedang masuk; ujian/peserta milik orang lain
// dijawab 404 (bukan 403), supaya keberadaannya tidak bocor (docs/DESAIN.md §8).
// Setiap aksi dicatat di log_aksi untuk ditelusuri bila ada sengketa.
import { Router } from 'express';
import { z } from 'zod';
import type { Response } from 'express';
import { PANJANG_KODE_PROYEKTOR } from '../../shared/alfabet.ts';
import type { StatusUjian, TautanProyektor } from '../../shared/auth.ts';
import { kodeAcak, sidik } from '../acak.ts';
import { sesiDari, wajibSesi } from '../auth/penjaga.ts';
import { cabutSesiPeserta, cabutSesiProyektor } from '../auth/sesi.ts';
import { GalatHttp, validasi } from '../http.ts';
import type { Konteks } from '../konteks.ts';

const ParamUjian = z.object({ id: z.coerce.number().int().positive() });
const ParamPeserta = z.object({ id: z.coerce.number().int().positive(), pid: z.coerce.number().int().positive() });

export function ujianAdminRouter(k: Konteks): Router {
  const router = Router();
  router.use('/ujian', wajibSesi(k.db, k.jam, 'penguji'));

  function ujianMilik(res: Response, ujianId: number): { id: number; status: StatusUjian } {
    const ujian = k.db
      .prepare('SELECT id, status FROM ujian WHERE id = ? AND penguji_id = ?')
      .get(ujianId, sesiDari(res).pengujiId) as { id: number; status: StatusUjian } | undefined;
    if (!ujian) throw new GalatHttp(404, 'tidak_ditemukan');
    return ujian;
  }

  // Reset PIN & buka kunci hanya bermakna setelah ujian dibuka (docs/DESAIN.md §8: "semua kecuali draf");
  // saat draf, siswa memang belum bisa masuk.
  function pesertaMilik(res: Response, ujianId: number, pesertaId: number): void {
    const ujian = ujianMilik(res, ujianId);
    if (ujian.status === 'draf') throw new GalatHttp(409, 'status_tidak_sesuai');
    const ada = k.db.prepare('SELECT 1 FROM peserta WHERE id = ? AND ujian_id = ?').get(pesertaId, ujianId);
    if (!ada) throw new GalatHttp(404, 'tidak_ditemukan');
  }

  function catatAksi(res: Response, ujianId: number, aksi: string, detail: Record<string, unknown>): void {
    k.db
      .prepare("INSERT INTO log_aksi (ujian_id, aktor, penguji_id, aksi, detail_json, dibuat_at) VALUES (?, 'penguji', ?, ?, ?, ?)")
      .run(ujianId, sesiDari(res).pengujiId, aksi, JSON.stringify(detail), k.jam());
  }

  // Menghapus PIN siswa (mis. namanya diklaim orang lain / lupa PIN), membuka kunci, dan mengeluarkan
  // semua sesinya. Siswa lalu membuat PIN baru saat masuk.
  router.post('/ujian/:id/peserta/:pid/reset-pin', (req, res) => {
    const { id, pid } = validasi(ParamPeserta, req.params);
    pesertaMilik(res, id, pid);
    const sekarang = k.jam();
    k.db.transaction(() => {
      k.db
        .prepare('UPDATE peserta SET pin_hash = NULL, pin_dibuat_at = NULL, pin_gagal = 0, terkunci_at = NULL WHERE id = ?')
        .run(pid);
      const dicabut = cabutSesiPeserta(k.db, sekarang, pid, 'direset_penguji');
      catatAksi(res, id, 'reset_pin', { peserta_id: pid, sesi_dicabut: dicabut });
    })();
    res.status(204).end();
  });

  // Membuka kunci setelah 5 PIN salah; PIN lama tetap berlaku.
  router.post('/ujian/:id/peserta/:pid/buka-kunci', (req, res) => {
    const { id, pid } = validasi(ParamPeserta, req.params);
    pesertaMilik(res, id, pid);
    k.db.transaction(() => {
      k.db.prepare('UPDATE peserta SET pin_gagal = 0, terkunci_at = NULL WHERE id = ?').run(pid);
      catatAksi(res, id, 'buka_kunci', { peserta_id: pid });
    })();
    res.status(204).end();
  });

  // Kode 8 karakter, berlaku 10 menit, sekali pakai. Yang disimpan hanya sidiknya.
  router.post('/ujian/:id/tautan-proyektor', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilik(res, id);
    const sekarang = k.jam();
    const kode = kodeAcak(PANJANG_KODE_PROYEKTOR);
    const kedaluwarsa = sekarang + k.opsi.umurKodeProyektorMs;
    k.db
      .prepare('INSERT INTO tautan_proyektor (kode_hash, ujian_id, dibuat_at, kedaluwarsa_at) VALUES (?, ?, ?, ?)')
      .run(sidik(kode), id, sekarang, kedaluwarsa);
    const body: TautanProyektor = { kode, kedaluwarsa_at: kedaluwarsa };
    res.json(body);
  });

  router.post('/ujian/:id/proyektor/cabut', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilik(res, id);
    k.db.transaction(() => {
      const dicabut = cabutSesiProyektor(k.db, k.jam(), id);
      catatAksi(res, id, 'cabut_proyektor', { sesi_dicabut: dicabut });
    })();
    res.status(204).end();
  });

  return router;
}
