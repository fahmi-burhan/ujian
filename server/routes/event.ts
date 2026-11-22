// server/routes/event.ts — laporan aktivitas di luar halaman dari browser siswa (POST /api/peserta/event).
// Dipanggil oleh: server/app.ts (dipasang di bawah /api, setelah peserta-ujian.ts yang memasang wajibSesi).
// Memanggil: server/routes/peserta-ujian.ts (pesertaDariSesi), server/waktu-ujian.ts, server/pantau.ts,
//            shared/pantau.ts, database.
// Aturan (docs/DESAIN.md §6, "Penerimaan laporan"):
// - Laporan BARU (mulai, atau selesai tanpa mulai) dinilai dari waktu KEJADIAN (mulai_klien_at), bukan saat
//   laporan tiba: diterima bila saat itu ujian berjalan (tidak dijeda/diakhiri) dan siswa sedang mengerjakan.
//   Jadi laporan yang tertahan offline lalu tiba saat dijeda tetap tercatat benar.
// - Laporan "selesai" untuk id_klien yang sudah ada SELALU diterima, durasinya dipotong di akhir waktu siswa.
//   Tidak ada event yang terbuka selamanya.
// - UPSERT tidak pernah membuka ulang event yang sudah selesai (COALESCE), dan jenis tidak pernah turun
//   peringkat, jadi urutan laporan yang terbalik atau terkirim dua kali aman.
// - Laporan yang tidak memenuhi syarat dijawab 204 dan diabaikan (bukan galat: browser tidak perlu mengulang).
// Batasan yang diketahui: jeda yang SUDAH selesai tidak tercatat per rentang di DB (hanya total), jadi
// laporan offline yang kejadiannya jatuh di jeda sebelumnya tetap diterima. Dampaknya kecil dan bukan sanksi.
import { Router } from 'express';
import { LaporanEventSchema } from '../../shared/pantau.ts';
import { validasi } from '../http.ts';
import type { Konteks } from '../konteks.ts';
import { beritahuPantau } from '../pantau.ts';
import { akhirEfektif } from '../waktu-ujian.ts';
import { pesertaDariSesi } from './peserta-ujian.ts';

// Pengaman banjir laporan palsu (DevTools): lebih dari ini per siswa per ujian diabaikan.
export const BATAS_EVENT_PER_PESERTA = 500;

// Peringkat jenis dalam SQL, sama dengan peringkatKepergian() di shared/pantau.ts (tab_tersembunyi tertinggi).
// tempel_dari_luar = 0; ia tidak pernah berbagi id_klien dengan kepergian.
const SQL_PERINGKAT = (kolom: string): string =>
  `CASE ${kolom} WHEN 'tab_tersembunyi' THEN 3 WHEN 'fokus_hilang' THEN 2 WHEN 'keluar_layar_penuh' THEN 1 ELSE 0 END`;

export function eventRouter(k: Konteks): Router {
  const router = Router();

  router.post('/peserta/event', (req, res) => {
    const lap = validasi(LaporanEventSchema, req.body);
    const { sesi, peserta, ujian } = pesertaDariSesi(k, res);
    const t = k.jam();
    const tabAktif = k.db.prepare('SELECT tab_aktif FROM sesi WHERE id_hash = ?').pluck().get(sesi.idHash) as string | null;
    // Event dari tab yang bukan tab aktif diabaikan (docs/DESAIN.md §5).
    if (tabAktif === null || req.get('x-tab-id') !== tabAktif || ujian.dimulai_at === null) {
      res.status(204).end();
      return;
    }
    const ekstra = k.db
      .prepare('SELECT masuk_pertama_at, dikumpulkan_at FROM peserta WHERE id = ?')
      .get(peserta.id) as { masuk_pertama_at: number | null; dikumpulkan_at: number | null };
    // Waktu kejadian tidak boleh di masa depan (jam/hitungan browser bisa meleset).
    const kejadian = Math.min(lap.mulai_klien_at, t);
    // Akhir waktu siswa ini: kumpul, waktu habis, jeda yang sedang berlangsung, atau diakhiri.
    const akhir = Math.min(t, akhirEfektif(ujian, peserta, t), ekstra.dikumpulkan_at ?? Infinity);

    const ada = k.db
      .prepare('SELECT id FROM event_integritas WHERE peserta_id = ? AND id_klien = ?')
      .get(peserta.id, lap.id_klien);
    if (!ada) {
      const sedangMengerjakan =
        peserta.status === 'mengerjakan' || (peserta.status === 'dikumpulkan' && ekstra.dikumpulkan_at !== null);
      const diterima =
        sedangMengerjakan &&
        ujian.status !== 'draf' &&
        ujian.status !== 'menunggu' &&
        kejadian >= ujian.dimulai_at &&
        kejadian >= (ekstra.masuk_pertama_at ?? Infinity) &&
        kejadian <= akhir;
      const jumlah = k.db.prepare('SELECT COUNT(*) FROM event_integritas WHERE peserta_id = ?').pluck().get(peserta.id) as number;
      if (!diterima || jumlah >= BATAS_EVENT_PER_PESERTA) {
        res.status(204).end();
        return;
      }
    }

    const selesai = lap.tahap === 'selesai';
    // Durasi dipotong supaya tidak melewati akhir waktu siswa (mis. kembali ke tab setelah dijeda/kumpul).
    const durasi = selesai ? Math.max(0, Math.min(lap.durasi_ms ?? 0, akhir - kejadian)) : null;
    k.db
      .prepare(
        `INSERT INTO event_integritas
           (ujian_id, peserta_id, id_klien, jenis, mulai_at, mulai_klien_at, selesai_at, durasi_ms, detail_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (peserta_id, id_klien) DO UPDATE SET
           jenis = CASE WHEN event_integritas.selesai_at IS NULL
             AND ${SQL_PERINGKAT('excluded.jenis')} >= ${SQL_PERINGKAT('event_integritas.jenis')}
             THEN excluded.jenis ELSE event_integritas.jenis END,
           detail_json = CASE WHEN event_integritas.selesai_at IS NULL
             AND ${SQL_PERINGKAT('excluded.jenis')} >= ${SQL_PERINGKAT('event_integritas.jenis')}
             THEN excluded.detail_json ELSE event_integritas.detail_json END,
           selesai_at = COALESCE(event_integritas.selesai_at, excluded.selesai_at),
           durasi_ms = COALESCE(event_integritas.durasi_ms, excluded.durasi_ms)`,
      )
      .run(
        ujian.id,
        peserta.id,
        lap.id_klien,
        lap.jenis,
        t,
        kejadian,
        selesai ? t : null,
        durasi,
        JSON.stringify(lap.detail),
      );
    beritahuPantau(k, ujian.id);
    res.status(204).end();
  });

  return router;
}
