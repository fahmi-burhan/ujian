// server/routes/jawaban.ts — simpan jawaban siswa (autosave berversi): PUT /api/peserta/jawaban/:soalId.
// Dipanggil oleh: server/app.ts (dipasang di bawah /api, SETELAH peserta-ujian.ts yang memasang wajibSesi
//                 untuk /api/peserta).
// Memanggil: server/routes/peserta-ujian.ts (sesi, tab, tolak sebelum mulai), server/waktu-ujian.ts,
//            shared/peserta.ts, database.
// Urutan pemeriksaan mengikuti docs/DESAIN.md §5 dan TIDAK boleh ditukar:
//   1. Fase ujian (sebelum soal, supaya ID soal tidak bisa ditebak sebelum mulai).
//   2. Soal milik ujian peserta ini (bila tidak: 404).
//   3. Tab aktif (bila tidak: 409 tab_tidak_aktif).
//   4. Idempotensi, SEBELUM aturan waktu: kiriman ulang yang sama dijawab sama, tidak disimpan dua kali.
//   5. Aturan penerimaan waktu (§4): terima / 409 dijeda / 202 terlambat.
//   6. Versi: versi_dasar ≠ versi server → 409 versi_bentrok + teks server (klien menampilkan dua teks).
//   7. Simpan sebagai versi + 1; riwayat maks 1 per 30 dtk per soal (atau selalu bila sudah dikumpulkan).
// Semua langkah 4–7 berada dalam SATU transaksi SQLite, jadi dua kiriman bersamaan tidak saling menimpa.
import { Router } from 'express';
import { z } from 'zod';
import { SimpanJawabanSchema } from '../../shared/peserta.ts';
import type { SimpanHasil } from '../../shared/peserta.ts';
import { GalatHttp, validasi } from '../http.ts';
import type { Konteks } from '../konteks.ts';
import { beritahuPantau } from '../pantau.ts';
import { penerimaanSimpan } from '../waktu-ujian.ts';
import { pesertaDariSesi, tolakSebelumMulai, wajibTabAktif } from './peserta-ujian.ts';

const ParamSoalPeserta = z.object({ soalId: z.coerce.number().int().positive() });
export const JEDA_RIWAYAT_MS = 30_000;

type BarisJawaban = { isi: string; versi: number; ditandai: number; id_simpan_terakhir: string | null; diubah_at: number };

type Hasil = { status: 200; body: SimpanHasil } | { status: 202; body: { terlambat: true } };

export function jawabanRouter(k: Konteks): Router {
  const router = Router();

  router.put('/peserta/jawaban/:soalId', (req, res) => {
    const kp = pesertaDariSesi(k, res);
    const { peserta, ujian, sesi } = kp;
    // 1. Fase.
    if (ujian.status === 'draf' || ujian.status === 'menunggu') tolakSebelumMulai(k, kp);
    if (ujian.status !== 'berlangsung' && ujian.status !== 'dijeda' && ujian.status !== 'selesai') {
      throw new GalatHttp(409, 'status_tidak_sesuai');
    }
    // Peserta yang belum pernah mengerjakan (mis. masuk setelah ujian diakhiri) tidak punya jawaban.
    if (peserta.status !== 'mengerjakan' && peserta.status !== 'dikumpulkan') throw new GalatHttp(409, 'status_tidak_sesuai');
    // 2. Soal milik ujian ini.
    const { soalId } = validasi(ParamSoalPeserta, req.params);
    const soalAda = k.db.prepare('SELECT 1 FROM soal WHERE id = ? AND ujian_id = ?').get(soalId, ujian.id);
    if (!soalAda) throw new GalatHttp(404, 'tidak_ditemukan');
    // 3. Tab aktif.
    wajibTabAktif(k, sesi, req.get('x-tab-id'));
    const input = validasi(SimpanJawabanSchema, req.body);
    const ditandai = input.ditandai ? 1 : 0;

    const hasil = k.db.transaction((): Hasil => {
      const t = k.jam();
      const kini = k.db
        .prepare('SELECT isi, versi, ditandai, id_simpan_terakhir, diubah_at FROM jawaban WHERE peserta_id = ? AND soal_id = ?')
        .get(peserta.id, soalId) as BarisJawaban | undefined;
      const versiKini = kini?.versi ?? 0;

      // 4. Idempotensi. Balasan kiriman pertama mungkin hilang di jalan; kiriman ulang yang sama
      //    dijawab dengan versi saat ini tanpa menyimpan lagi. Isi yang sudah sama juga tidak perlu disimpan.
      if (kini && kini.id_simpan_terakhir === input.id_simpan) {
        return { status: 200, body: { versi: versiKini, disimpan_at: kini.diubah_at } };
      }
      if ((kini?.isi ?? '') === input.isi && (kini?.ditandai ?? 0) === ditandai) {
        return { status: 200, body: { versi: versiKini, disimpan_at: kini?.diubah_at ?? t } };
      }
      const sudahTerlambat = k.db
        .prepare('SELECT 1 FROM jawaban_terlambat WHERE peserta_id = ? AND id_simpan = ?')
        .get(peserta.id, input.id_simpan);
      if (sudahTerlambat) return { status: 202, body: { terlambat: true } };

      // 5. Aturan waktu.
      const terima = penerimaanSimpan(ujian, peserta, t);
      if (terima.jenis === 'dijeda') throw new GalatHttp(409, 'dijeda');
      if (terima.jenis === 'terlambat') {
        // Teks tidak hilang: disimpan terpisah, guru yang memutuskan diterima atau tidak.
        k.db
          .prepare(
            `INSERT INTO jawaban_terlambat (ujian_id, peserta_id, soal_id, isi, versi_dasar, id_simpan, diterima_at, alasan)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(ujian.id, peserta.id, soalId, input.isi, input.versi_dasar, input.id_simpan, t, terima.alasan);
        return { status: 202, body: { terlambat: true } };
      }

      // 6. Versi.
      if (input.versi_dasar !== versiKini) {
        throw new GalatHttp(409, 'versi_bentrok', { versi: versiKini, isi: kini?.isi ?? '', ditandai: (kini?.ditandai ?? 0) === 1 });
      }

      // 7. Simpan.
      const versiBaru = versiKini + 1;
      if (kini) {
        k.db
          .prepare(
            `UPDATE jawaban SET isi = ?, ditandai = ?, versi = ?, id_simpan_terakhir = ?, diubah_at = ?
             WHERE peserta_id = ? AND soal_id = ? AND versi = ?`,
          )
          .run(input.isi, ditandai, versiBaru, input.id_simpan, t, peserta.id, soalId, versiKini);
      } else {
        k.db
          .prepare(
            `INSERT INTO jawaban (ujian_id, peserta_id, soal_id, isi, versi, ditandai, id_simpan_terakhir, diubah_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(ujian.id, peserta.id, soalId, input.isi, versiBaru, ditandai, input.id_simpan, t);
      }
      const riwayatTerakhir = k.db
        .prepare('SELECT MAX(disimpan_at) FROM jawaban_versi WHERE peserta_id = ? AND soal_id = ?')
        .pluck()
        .get(peserta.id, soalId) as number | null;
      // Alasan riwayat: pilihan siswa saat bentrok → "konflik"; simpanan dalam toleransi setelah
      // dikumpulkan (Akhiri oleh guru) → "kumpul", supaya riwayat terakhir = jawaban final; selain itu
      // "berkala" paling banyak sekali per 30 dtk.
      const alasan = input.konflik
        ? 'konflik'
        : peserta.status === 'dikumpulkan'
          ? 'kumpul'
          : riwayatTerakhir === null || t - riwayatTerakhir >= JEDA_RIWAYAT_MS
            ? 'berkala'
            : null;
      if (alasan !== null) {
        k.db
          .prepare(
            `INSERT INTO jawaban_versi (peserta_id, soal_id, versi, isi, alasan, disimpan_at) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (peserta_id, soal_id, versi) DO NOTHING`,
          )
          .run(peserta.id, soalId, versiBaru, input.isi, alasan, t);
      }
      return { status: 200, body: { versi: versiBaru, disimpan_at: t } };
    })();
    beritahuPantau(k, ujian.id);
    res.status(hasil.status).json(hasil.body);
  });

  return router;
}
