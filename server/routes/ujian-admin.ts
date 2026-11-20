// server/routes/ujian-admin.ts — aksi guru terkait akses: reset PIN, buka kunci, kode & cabut proyektor.
// Dipanggil oleh: server/app.ts (dipasang di bawah /api; sesi guru sudah dicek di app.ts untuk /api/ujian).
// Memanggil: server/auth/*, server/acak.ts, server/routes/milik.ts, database.
// Setiap aksi hanya boleh untuk ujian MILIK guru yang sedang masuk; ujian/peserta milik orang lain
// dijawab 404 (bukan 403), supaya keberadaannya tidak bocor (docs/DESAIN.md §8).
// Setiap aksi dicatat di log_aksi untuk ditelusuri bila ada sengketa.
import { Router } from 'express';
import { PANJANG_KODE_PROYEKTOR } from '../../shared/alfabet.ts';
import type { TautanProyektor } from '../../shared/auth.ts';
import { kodeAcak, sidik } from '../acak.ts';
import { cabutSesiPeserta, cabutSesiProyektor } from '../auth/sesi.ts';
import { validasi } from '../http.ts';
import type { Konteks } from '../konteks.ts';
import { catatAksiGuru, ParamPeserta, ParamUjian, pesertaMilikUjian, ujianMilik, ujianMilikDiStatus } from './milik.ts';
import type { Response } from 'express';

// Status selain draf (reset PIN & buka kunci baru bermakna setelah ujian dibuka; docs/DESAIN.md §8).
const BUKAN_DRAF = ['menunggu', 'berlangsung', 'dijeda', 'selesai', 'penilaian', 'dirilis'] as const;

export function ujianAdminRouter(k: Konteks): Router {
  const router = Router();

  function pesertaMilik(res: Response, ujianId: number, pesertaId: number): void {
    ujianMilikDiStatus(k, res, ujianId, BUKAN_DRAF);
    pesertaMilikUjian(k, ujianId, pesertaId);
  }

  function catatAksi(res: Response, ujianId: number, aksi: string, detail: Record<string, unknown>): void {
    catatAksiGuru(k, res, ujianId, aksi, detail);
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
    k.sse.tutupPeserta((kon) => kon.pesertaId === pid, 'sesi_dicabut', { alasan: 'direset_penguji' });
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
    ujianMilik(k, res, id);
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
    ujianMilik(k, res, id);
    k.db.transaction(() => {
      const dicabut = cabutSesiProyektor(k.db, k.jam(), id);
      catatAksi(res, id, 'cabut_proyektor', { sesi_dicabut: dicabut });
    })();
    res.status(204).end();
  });

  return router;
}
