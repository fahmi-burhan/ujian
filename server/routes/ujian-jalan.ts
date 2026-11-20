// server/routes/ujian-jalan.ts — transisi jalannya ujian oleh guru: Mulai, Jeda, Lanjutkan, Akhiri.
// Dipanggil oleh: server/app.ts (dipasang di bawah /api; sesi guru dicek di app.ts untuk /api/ujian).
// Memanggil: server/routes/milik.ts, server/waktu-ujian.ts, server/siaran.ts, server/routes/ujian.ts
//            (muatUjianDetail), database.
// Kontrak: docs/DESAIN.md §3. Setiap transisi berjalan di dalam transaksi dengan "WHERE status = <asal>",
// jadi dua klik bersamaan tidak berefek ganda; yang kalah mendapat 409 transisi_tidak_sah. Setelah
// transaksi berhasil, semua siswa yang tersambung menerima event SSE `status` (+ `waktu`).
// Perpanjangan & buka kembali peserta dibuat di Fase 5.
import { Router } from 'express';
import type { Response } from 'express';
import { GalatHttp, validasi } from '../http.ts';
import type { Konteks } from '../konteks.ts';
import { siarkanStatus } from '../siaran.ts';
import { kumpulkanPeserta } from '../waktu-ujian.ts';
import { catatAksiGuru, ParamUjian, ujianMilik } from './milik.ts';
import { muatUjianDetail } from './ujian.ts';

export function ujianJalanRouter(k: Konteks): Router {
  const router = Router();

  // Menjalankan `ubah` dalam transaksi; `ubah` mengembalikan jumlah baris ujian yang berubah (0 = status
  // sudah bukan status asal). Lalu mencatat log, menyiarkan status, dan menjawab detail ujian terbaru.
  function jalankan(res: Response, id: number, aksi: string, ubah: (t: number) => number): void {
    ujianMilik(k, res, id);
    const t = k.jam();
    k.db.transaction(() => {
      if (ubah(t) === 0) throw new GalatHttp(409, 'transisi_tidak_sah');
      catatAksiGuru(k, res, id, aksi);
    })();
    siarkanStatus(k, id);
    res.json(muatUjianDetail(k, id));
  }

  // menunggu → berlangsung: semua siswa di ruang tunggu mulai serentak. Siswa yang belum masuk tetap
  // "belum_masuk"; saat masuk nanti mereka langsung mengerjakan dengan SISA waktu global.
  router.post('/ujian/:id/mulai', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    jalankan(res, id, 'mulai', (t) => {
      const berubah = k.db
        .prepare(
          "UPDATE ujian SET status = 'berlangsung', dimulai_at = ?, detak_at = ?, diubah_at = ? WHERE id = ? AND status = 'menunggu'",
        )
        .run(t, t, t, id).changes;
      if (berubah === 1) {
        k.db.prepare("UPDATE peserta SET status = 'mengerjakan' WHERE ujian_id = ? AND status = 'menunggu'").run(id);
      }
      return berubah;
    });
  });

  // berlangsung → dijeda: waktu semua siswa berhenti; soal tetap terlihat, editor terkunci.
  router.post('/ujian/:id/jeda', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    jalankan(res, id, 'jeda', (t) =>
      k.db
        .prepare("UPDATE ujian SET status = 'dijeda', dijeda_at = ?, diubah_at = ? WHERE id = ? AND status = 'berlangsung'")
        .run(t, t, id).changes,
    );
  });

  // dijeda → berlangsung: lama jeda ditambahkan ke total_jeda_ms; detak dimulai lagi dari sekarang (kalau
  // tidak, pengecek akan mengira server baru mati dan langsung menjeda lagi).
  router.post('/ujian/:id/lanjutkan', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    jalankan(res, id, 'lanjutkan', (t) =>
      k.db
        .prepare(
          `UPDATE ujian SET status = 'berlangsung', total_jeda_ms = total_jeda_ms + (? - dijeda_at), dijeda_at = NULL,
             detak_at = ?, diubah_at = ?
           WHERE id = ? AND status = 'dijeda'`,
        )
        .run(t, t, t, id).changes,
    );
  });

  // berlangsung/dijeda → selesai: siswa yang masih mengerjakan dikumpulkan ("diakhiri_penguji").
  // Siswa yang belum pernah masuk tetap "belum_masuk" (= tidak hadir).
  router.post('/ujian/:id/akhiri', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    jalankan(res, id, 'akhiri', (t) => {
      const berubah = k.db
        .prepare(
          `UPDATE ujian SET status = 'selesai',
             total_jeda_ms = total_jeda_ms + CASE WHEN dijeda_at IS NULL THEN 0 ELSE ? - dijeda_at END,
             dijeda_at = NULL, diakhiri_at = ?, diubah_at = ?
           WHERE id = ? AND status IN ('berlangsung', 'dijeda')`,
        )
        .run(t, t, t, id).changes;
      if (berubah === 1) {
        const mengerjakan = k.db
          .prepare("SELECT id FROM peserta WHERE ujian_id = ? AND status = 'mengerjakan'")
          .pluck()
          .all(id) as number[];
        for (const pid of mengerjakan) kumpulkanPeserta(k.db, pid, 'diakhiri_penguji', t);
      }
      return berubah;
    });
  });

  return router;
}
