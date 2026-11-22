// server/routes/ujian-jalan.ts — transisi jalannya ujian oleh guru: Mulai, Jeda, Lanjutkan, Akhiri.
// Dipanggil oleh: server/app.ts (dipasang di bawah /api; sesi guru dicek di app.ts untuk /api/ujian).
// Memanggil: server/routes/milik.ts, server/waktu-ujian.ts, server/siaran.ts, server/routes/ujian.ts
//            (muatUjianDetail), database.
// Kontrak: docs/DESAIN.md §3. Setiap transisi berjalan di dalam transaksi dengan "WHERE status = <asal>",
// jadi dua klik bersamaan tidak berefek ganda; yang kalah mendapat 409 transisi_tidak_sah. Setelah
// transaksi berhasil, semua siswa yang tersambung menerima event SSE `status` (+ `waktu`).
// Fase 5: perpanjangan (semua/satu siswa) dan buka kembali siswa yang sudah mengumpulkan (§4 "Perpanjangan").
import { Router } from 'express';
import type { Response } from 'express';
import { BukaKembaliSchema, PerpanjangSchema } from '../../shared/pantau.ts';
import { GalatHttp, validasi } from '../http.ts';
import type { Konteks } from '../konteks.ts';
import { beritahuPantau } from '../pantau.ts';
import { kirimStatusPeserta, siarkanStatus, siarkanWaktu } from '../siaran.ts';
import type { PesertaWaktu, UjianWaktu } from '../waktu-ujian.ts';
import { bacaPesertaWaktu, bacaUjianWaktu, daftarPesertaWaktu, kumpulkanPeserta, sisaMs } from '../waktu-ujian.ts';
import { catatAksiGuru, ParamPeserta, ParamUjian, pesertaMilikUjian, ujianMilik, ujianMilikDiStatus } from './milik.ts';
import { muatUjianDetail } from './ujian.ts';

const SEDANG_BERJALAN = ['berlangsung', 'dijeda'] as const;

// Membuka kembali siswa yang sudah dikumpulkan: status kembali "mengerjakan" (CHECK skema mewajibkan
// cara_kumpul & dikumpulkan_at kosong). Jawabannya tetap; riwayat "kumpul" tetap tersimpan.
function bukaKembaliPeserta(k: Konteks, pesertaId: number, hanyaWaktuHabis: boolean): boolean {
  const sql = `UPDATE peserta SET status = 'mengerjakan', cara_kumpul = NULL, dikumpulkan_at = NULL
     WHERE id = ? AND status = 'dikumpulkan'${hanyaWaktuHabis ? " AND cara_kumpul = 'waktu_habis'" : ''}`;
  return k.db.prepare(sql).run(pesertaId).changes === 1;
}

// Perpanjangan (docs/DESAIN.md §4): "sisa menjadi max(sisa, 0) + X menit", hasil perpanjangan ≥ 0.
// X negatif = koreksi salah ketik: hanya MENGURANGI perpanjangan yang sudah diberikan (tanpa "menambal" sisa
// negatif ke 0 dulu, yang justru menaikkan angka perpanjangan dan menyesatkan di dasbor).
function perpanjanganBaru(lama: number, sisa: number, menit: number): number {
  if (menit < 0) return Math.max(0, lama + menit * 60_000);
  return lama + Math.max(0, -sisa) + menit * 60_000;
}

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
        // Kepergian yang belum dilaporkan selesai (mis. siswa menutup laptop) ditutup di sini, supaya tidak
        // ada aktivitas yang terbuka selamanya. Durasinya dipotong saat siswa itu dikumpulkan (waktunya
        // berakhir), sama dengan aturan §6. Laporan "selesai" yang tiba belakangan tidak mengubahnya.
        k.db
          .prepare(
            `UPDATE event_integritas SET selesai_at = ?,
               durasi_ms = MAX(0, MIN(?, COALESCE((SELECT p.dikumpulkan_at FROM peserta p WHERE p.id = peserta_id), ?))
                 - COALESCE(mulai_klien_at, mulai_at))
             WHERE ujian_id = ? AND selesai_at IS NULL
               AND jenis IN ('tab_tersembunyi', 'fokus_hilang', 'keluar_layar_penuh', 'koneksi_putus')`,
          )
          .run(t, t, t, id);
      }
      return berubah;
    });
  });

  // Perpanjangan untuk semua siswa (tanpa peserta_id) atau satu siswa. Menit negatif = koreksi salah ketik.
  // Siswa yang dikumpulkan otomatis karena waktu habis dan kini punya sisa waktu dibuka kembali. Siswa yang
  // mengumpulkan sendiri hanya dibuka lewat "Buka kembali".
  router.post('/ujian/:id/perpanjang', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilikDiStatus(k, res, id, SEDANG_BERJALAN);
    const input = validasi(PerpanjangSchema, req.body);
    if (input.peserta_id !== undefined) pesertaMilikUjian(k, id, input.peserta_id);
    const t = k.jam();
    const dibuka = k.db.transaction(() => {
      const u = bacaUjianWaktu(k.db, id) as UjianWaktu;
      if (u.status !== 'berlangsung' && u.status !== 'dijeda') throw new GalatHttp(409, 'status_tidak_sesuai');
      let tercakup: PesertaWaktu[];
      let ujianBaru = u;
      if (input.peserta_id !== undefined) {
        const p = bacaPesertaWaktu(k.db, input.peserta_id) as PesertaWaktu;
        const baru = perpanjanganBaru(p.perpanjangan_ms, sisaMs(u, p, t), input.menit);
        k.db.prepare('UPDATE peserta SET perpanjangan_ms = ? WHERE id = ?').run(baru, p.id);
        tercakup = [{ ...p, perpanjangan_ms: baru }];
      } else {
        const baru = perpanjanganBaru(u.perpanjangan_ms, sisaMs(u, { perpanjangan_ms: 0 }, t), input.menit);
        k.db.prepare('UPDATE ujian SET perpanjangan_ms = ?, diubah_at = ? WHERE id = ?').run(baru, t, id);
        ujianBaru = { ...u, perpanjangan_ms: baru };
        tercakup = daftarPesertaWaktu(k.db, id);
      }
      const buka: number[] = [];
      for (const p of tercakup) {
        if (p.status === 'dikumpulkan' && p.cara_kumpul === 'waktu_habis' && sisaMs(ujianBaru, p, t) > 0) {
          if (bukaKembaliPeserta(k, p.id, true)) buka.push(p.id);
        }
      }
      catatAksiGuru(k, res, id, 'perpanjang', {
        menit: input.menit,
        peserta_id: input.peserta_id ?? null,
        dibuka_kembali: buka,
      });
      return buka;
    })();
    // Hitung mundur semua siswa diselaraskan; siswa yang dibuka kembali memuat ulang halamannya.
    siarkanWaktu(k, id);
    for (const pid of dibuka) kirimStatusPeserta(k, pid);
    beritahuPantau(k, id);
    res.json(muatUjianDetail(k, id));
  });

  // "Buka kembali" satu siswa yang sudah mengumpulkan, dengan jumlah menit wajib: sisa waktunya menjadi
  // minimal X menit (perpanjangan khusus siswa itu ditambah bila perlu).
  router.post('/ujian/:id/peserta/:pid/buka-kembali', (req, res) => {
    const { id, pid } = validasi(ParamPeserta, req.params);
    ujianMilikDiStatus(k, res, id, SEDANG_BERJALAN);
    pesertaMilikUjian(k, id, pid);
    const { menit } = validasi(BukaKembaliSchema, req.body);
    const t = k.jam();
    k.db.transaction(() => {
      const u = bacaUjianWaktu(k.db, id) as UjianWaktu;
      if (u.status !== 'berlangsung' && u.status !== 'dijeda') throw new GalatHttp(409, 'status_tidak_sesuai');
      const p = bacaPesertaWaktu(k.db, pid) as PesertaWaktu;
      if (p.status !== 'dikumpulkan') throw new GalatHttp(409, 'status_tidak_sesuai');
      const sisa = sisaMs(u, p, t);
      const target = menit * 60_000;
      const tambah = sisa < target ? target - sisa : 0;
      k.db.prepare('UPDATE peserta SET perpanjangan_ms = perpanjangan_ms + ? WHERE id = ?').run(tambah, pid);
      bukaKembaliPeserta(k, pid, false);
      catatAksiGuru(k, res, id, 'buka_kembali', { peserta_id: pid, menit, cara_kumpul_sebelumnya: p.cara_kumpul });
    })();
    kirimStatusPeserta(k, pid);
    res.json(muatUjianDetail(k, id));
  });

  return router;
}
