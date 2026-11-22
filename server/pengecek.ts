// server/pengecek.ts — "pengecek" yang dijalankan tiap 1 detik: detak server, jeda otomatis setelah server
// sempat mati/macet, kumpul otomatis per peserta saat waktunya habis, dan penyelarasan waktu SSE tiap 30 dtk.
// Dipanggil oleh: server/app.ts (membuatnya), server/start.ts (menjalankan sekali saat start lalu tiap detik),
//                 tes (memanggil putaran() langsung dengan jam palsu).
// Memanggil: server/waktu-ujian.ts, server/siaran.ts, database.
// Aturan (docs/DESAIN.md §3–§4):
// 1. Detak dulu: ujian "berlangsung" yang detaknya lebih tua dari 15 dtk berarti server sempat mati atau
//    macet. Ujian itu DIJEDA sejak detak terakhir (waktu siswa tidak habis selama server mati), dicatat di
//    log_aksi "jeda_otomatis". Pemeriksaan ini selalu SEBELUM kumpul otomatis, supaya server yang baru
//    hidup tidak langsung mengumpulkan semua siswa.
// 2. Detak ujian berlangsung diperbarui tiap 5 dtk.
// 3. Peserta yang sisa waktunya ≤ −10 dtk dikumpulkan otomatis (cara "waktu_habis").
// 4. Tiap 30 dtk semua siswa yang tersambung menerima event `waktu` untuk menyelaraskan hitung mundur.
// 5. (Fase 5) Siswa yang alirannya putus > 10 dtk saat mengerjakan dicatat sebagai event `koneksi_putus`
//    (hanya untuk dasbor guru, docs/DESAIN.md §6), dan ditutup saat ia tersambung lagi.
// 6. (Fase 5) Tiap 5 dtk dasbor guru & proyektor yang terbuka dikirimi potret baru, supaya sisa waktu per
//    siswa dan lama kepergian yang masih berlangsung tetap segar walau tidak ada kejadian lain.
// Ujian TIDAK pernah diakhiri otomatis (K2): guru yang menekan Akhiri.
import type { Konteks } from './konteks.ts';
import { beritahuPantau } from './pantau.ts';
import { kirimStatusPeserta, siarkanStatus, siarkanWaktu } from './siaran.ts';
import type { UjianWaktu } from './waktu-ujian.ts';
import { bacaUjianWaktu, daftarPesertaWaktu, harusDikumpulkanOtomatis, kumpulkanPeserta } from './waktu-ujian.ts';

export const BATAS_DETAK_MS = 15_000;
export const JEDA_DETAK_MS = 5_000;
export const JEDA_SIARAN_WAKTU_MS = 30_000;
export const BATAS_PUTUS_MS = 10_000;
export const JEDA_SEGAR_PANTAU_MS = 5_000;

export type Pengecek = { putaran: () => void };

export function buatPengecek(k: Konteks): Pengecek {
  let siaranWaktuTerakhir = 0;
  let segarPantauTerakhir = 0;

  function koneksiPutus(t: number): void {
    for (const p of k.sse.putus.values()) {
      if (p.eventId !== null || t - p.sejak < BATAS_PUTUS_MS) continue;
      const sedang = k.db
        .prepare(
          `SELECT 1 FROM peserta ps JOIN ujian u ON u.id = ps.ujian_id
           WHERE ps.id = ? AND ps.status = 'mengerjakan' AND u.status = 'berlangsung'`,
        )
        .get(p.pesertaId);
      if (!sedang) {
        // Sudah mengumpulkan / ujian berakhir: tidak perlu dicatat lagi. Bila hanya sedang dijeda atau di ruang
        // tunggu, entri dipertahankan: siswa yang masih terputus setelah Lanjutkan/Mulai tetap tercatat.
        const masihMungkin = k.db
          .prepare(
            `SELECT 1 FROM peserta ps JOIN ujian u ON u.id = ps.ujian_id
             WHERE ps.id = ? AND ps.status IN ('menunggu', 'mengerjakan') AND u.status IN ('menunggu', 'berlangsung', 'dijeda')`,
          )
          .get(p.pesertaId);
        if (!masihMungkin) k.sse.putus.delete(p.pesertaId);
        continue;
      }
      p.eventId = k.db
        .prepare(
          `INSERT INTO event_integritas (ujian_id, peserta_id, jenis, mulai_at) VALUES (?, ?, 'koneksi_putus', ?)
           RETURNING id`,
        )
        .pluck()
        .get(p.ujianId, p.pesertaId, p.sejak) as number;
      beritahuPantau(k, p.ujianId);
    }
    for (const kb of k.sse.ambilKembali()) {
      const ujianId = k.db
        .prepare(
          `UPDATE event_integritas SET selesai_at = ?, durasi_ms = ? - mulai_at
           WHERE id = ? AND selesai_at IS NULL RETURNING ujian_id`,
        )
        .pluck()
        .get(kb.pada, kb.pada, kb.eventId) as number | undefined;
      if (ujianId !== undefined) beritahuPantau(k, ujianId);
    }
  }

  // Aliran dasbor guru & proyektor yang sesinya sudah dicabut atau kedaluwarsa (Max-Age 12 jam) ditutup.
  function tutupAliranBasi(t: number): void {
    const sesiValid = k.db.prepare('SELECT 1 FROM sesi WHERE id_hash = ? AND dicabut_at IS NULL AND kedaluwarsa_at > ?');
    for (const a of k.sse.aliranPantau(() => true)) {
      if (sesiValid.get(a.sesiHash, t)) continue;
      k.sse.tutupPantau((x) => x === a, 'sesi_dicabut', { alasan: 'berakhir' });
    }
  }

  function jedaOtomatis(t: number): void {
    const basi = k.db
      .prepare("SELECT id, detak_at FROM ujian WHERE status = 'berlangsung' AND detak_at < ?")
      .all(t - BATAS_DETAK_MS) as { id: number; detak_at: number }[];
    for (const u of basi) {
      const dijeda = k.db.transaction(() => {
        // dijeda_at = detak terakhir: waktu siswa membeku sejak saat server berhenti berdetak.
        const berubah = k.db
          .prepare(
            "UPDATE ujian SET status = 'dijeda', dijeda_at = detak_at, diubah_at = ? WHERE id = ? AND status = 'berlangsung' AND detak_at = ?",
          )
          .run(t, u.id, u.detak_at).changes;
        if (berubah === 0) return false;
        k.db
          .prepare("INSERT INTO log_aksi (ujian_id, aktor, aksi, detail_json, dibuat_at) VALUES (?, 'server', 'jeda_otomatis', ?, ?)")
          .run(u.id, JSON.stringify({ detak_terakhir_at: u.detak_at, mati_ms: t - u.detak_at }), t);
        return true;
      })();
      if (dijeda) {
        console.warn(`[pengecek] Ujian ${u.id} dijeda otomatis: server tidak berdetak selama ${Math.round((t - u.detak_at) / 1000)} dtk.`);
        siarkanStatus(k, u.id);
      }
    }
  }

  function kumpulOtomatis(t: number): void {
    const berjalan = k.db
      .prepare("SELECT id FROM ujian WHERE status IN ('berlangsung', 'dijeda')")
      .pluck()
      .all() as number[];
    for (const ujianId of berjalan) {
      const u = bacaUjianWaktu(k.db, ujianId) as UjianWaktu;
      for (const p of daftarPesertaWaktu(k.db, ujianId)) {
        if (!harusDikumpulkanOtomatis(u, p, t)) continue;
        const berubah = k.db.transaction(() => kumpulkanPeserta(k.db, p.id, 'waktu_habis', t))();
        if (berubah) kirimStatusPeserta(k, p.id);
      }
    }
  }

  return {
    putaran() {
      const t = k.jam();
      jedaOtomatis(t);
      k.db
        .prepare("UPDATE ujian SET detak_at = ? WHERE status = 'berlangsung' AND detak_at <= ?")
        .run(t, t - JEDA_DETAK_MS);
      kumpulOtomatis(t);
      // Langkah tambahan Fase 5 dijaga sendiri-sendiri: galat di sini tidak boleh menghentikan siaran waktu.
      try {
        koneksiPutus(t);
      } catch (galat) {
        console.error('[pengecek] Gagal mencatat koneksi putus:', galat);
      }
      if (t - segarPantauTerakhir >= JEDA_SEGAR_PANTAU_MS) {
        segarPantauTerakhir = t;
        try {
          tutupAliranBasi(t);
          const dipantau = new Set(k.sse.aliranPantau(() => true).map((a) => a.ujianId));
          for (const id of dipantau) beritahuPantau(k, id);
        } catch (galat) {
          console.error('[pengecek] Gagal menyegarkan dasbor/proyektor:', galat);
        }
      }
      if (t - siaranWaktuTerakhir >= JEDA_SIARAN_WAKTU_MS) {
        siaranWaktuTerakhir = t;
        const berjalan = k.db
          .prepare("SELECT id FROM ujian WHERE status IN ('berlangsung', 'dijeda')")
          .pluck()
          .all() as number[];
        for (const id of berjalan) siarkanWaktu(k, id);
      }
    },
  };
}
