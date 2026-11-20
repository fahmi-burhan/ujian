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
// Ujian TIDAK pernah diakhiri otomatis (K2): guru yang menekan Akhiri.
import type { Konteks } from './konteks.ts';
import { kirimStatusPeserta, siarkanStatus, siarkanWaktu } from './siaran.ts';
import type { UjianWaktu } from './waktu-ujian.ts';
import { bacaUjianWaktu, daftarPesertaWaktu, harusDikumpulkanOtomatis, kumpulkanPeserta } from './waktu-ujian.ts';

export const BATAS_DETAK_MS = 15_000;
export const JEDA_DETAK_MS = 5_000;
export const JEDA_SIARAN_WAKTU_MS = 30_000;

export type Pengecek = { putaran: () => void };

export function buatPengecek(k: Konteks): Pengecek {
  let siaranWaktuTerakhir = 0;

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
