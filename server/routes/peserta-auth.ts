// server/routes/peserta-auth.ts — masuk siswa: kode ujian → pilih nama → PIN 4 angka buatan sendiri.
// Dipanggil oleh: server/app.ts (dipasang di bawah /api).
// Memanggil: server/auth/*, shared/auth.ts, database.
// Endpoint (docs/DESAIN.md §8): POST /peserta/daftar-nama, POST /peserta/masuk, POST /peserta/keluar,
// GET /peserta/saya.
// Aturan PIN:
// - Belum punya PIN → PIN dibuat (wajib diketik dua kali).
// - Sudah punya → dicek. 5 kali salah berturut-turut → nama terkunci sampai guru membukanya
//   (penguncian dicatat di log_aksi sebagai aksi server 'pin_terkunci').
// - Login berhasil saat sesi lama masih aktif → sesi lama dicabut ("diambil alih") + event masuk_ulang
//   untuk dasbor guru (keputusan pemilik: login baru langsung mengambil alih).
import { Router } from 'express';
import { DaftarNamaPermintaanSchema, PesertaMasukSchema } from '../../shared/auth.ts';
import type { DaftarNamaRespons, PesertaSaya, StatusPeserta, StatusUjian } from '../../shared/auth.ts';
import { cocokkanRahasia, hashRahasia, scryptPenuh } from '../auth/kata-sandi.ts';
import { ringkasPerangkat } from '../auth/perangkat.ts';
import { sesiDari, wajibSesi } from '../auth/penjaga.ts';
import { buatSesi, cabutSesi, cabutSesiPeserta, hapusCookieSesi, pasangCookieSesi } from '../auth/sesi.ts';
import { GalatHttp, tunda, validasi } from '../http.ts';
import type { Konteks } from '../konteks.ts';
import { beritahuPantau } from '../pantau.ts';

export const BATAS_PIN_SALAH = 5;

type BarisUjian = { id: number; judul: string; status: StatusUjian };
type BarisPeserta = {
  id: number;
  ujian_id: number;
  status: StatusPeserta;
  pin_hash: string | null;
  pin_gagal: number;
  terkunci_at: number | null;
  masuk_pertama_at: number | null;
};

export function pesertaAuthRouter(k: Konteks): Router {
  const router = Router();
  const wajibPeserta = wajibSesi(k.db, k.jam, 'peserta');

  // Ujian draf diperlakukan seperti kode salah: keberadaannya tidak dibocorkan.
  const cariUjianTerbuka = k.db.prepare("SELECT id, judul, status FROM ujian WHERE kode = ? AND status <> 'draf'");

  // Kode benar selalu langsung diterima; kode salah dijawab setelah jeda tetap (keputusan pemilik
  // 20 Nov 2026, menggantikan blokir per IP yang bisa dipakai satu siswa untuk menghalangi sekelas).
  // Ruang kode 31^6 ≈ 887 juta, jadi menebak dengan jeda 1 dtk per tebakan tidak praktis.
  async function ujianDariKode(kode: string): Promise<BarisUjian> {
    const ujian = cariUjianTerbuka.get(kode) as BarisUjian | undefined;
    if (!ujian) {
      await tunda(k.opsi.jedaKodeSalahMs);
      throw new GalatHttp(404, 'kode_salah');
    }
    return ujian;
  }

  router.post('/peserta/daftar-nama', async (req, res) => {
    const { kode } = validasi(DaftarNamaPermintaanSchema, req.body);
    const ujian = await ujianDariKode(kode);
    const baris = k.db
      .prepare(
        `SELECT id, nama, nomor, pin_hash IS NOT NULL AS punya_pin FROM peserta
         WHERE ujian_id = ? ORDER BY nama COLLATE NOCASE, nomor`,
      )
      .all(ujian.id) as { id: number; nama: string; nomor: string; punya_pin: number }[];
    // Daftar putih: hanya field ini yang keluar (tanpa pin_hash, id_anonim, status).
    const body: DaftarNamaRespons = {
      judul: ujian.judul,
      peserta: baris.map((p) => ({ id: p.id, nama: p.nama, nomor: p.nomor, punya_pin: p.punya_pin === 1 })),
    };
    res.json(body);
  });

  // Pesan satu "slot percobaan" SEBELUM PIN dicek (scrypt butuh waktu). Penambahan & penguncian
  // terjadi dalam satu UPDATE atomik, dan hanya bila nama belum terkunci. Akibatnya, sebanyak apa pun
  // tebakan yang dikirim bersamaan, paling banyak 5 yang benar-benar dicek; sisanya langsung 423.
  // (Bila penambahan dilakukan SETELAH cek, tebakan paralel yang sudah lolos pemeriksaan "terkunci"
  // semuanya ikut dicek, sehingga batas 5 bisa ditembus.)
  // Pada slot ke-5 nama langsung terkunci; bila ternyata PIN-nya benar, kunci dibuka lagi oleh login.
  const pesanSlot = k.db.prepare(
    `UPDATE peserta SET pin_gagal = pin_gagal + 1,
       terkunci_at = CASE WHEN pin_gagal + 1 >= ? THEN ? ELSE NULL END
     WHERE id = ? AND terkunci_at IS NULL
     RETURNING pin_gagal`,
  );

  async function cekPin(peserta: BarisPeserta, pin: string, perangkat: string): Promise<void> {
    if (peserta.pin_hash === null) throw new GalatHttp(404, 'tidak_ditemukan');
    // Ditolak sebelum memesan slot, supaya "server sibuk" tidak terhitung sebagai PIN salah.
    // Tidak ada `await` antara cek ini dan masuk antrean scrypt, jadi hasil cek tetap berlaku.
    if (scryptPenuh()) throw new GalatHttp(503, 'server_sibuk');
    const slot = pesanSlot.pluck().get(BATAS_PIN_SALAH, k.jam(), peserta.id) as number | undefined;
    if (slot === undefined) throw new GalatHttp(423, 'terkunci');
    if (await cocokkanRahasia(pin, peserta.pin_hash)) return;
    if (slot >= BATAS_PIN_SALAH) {
      // Dicatat agar guru bisa melihat kapan & dari perangkat apa nama ini terkunci (docs/DESAIN.md §8).
      k.db
        .prepare(
          "INSERT INTO log_aksi (ujian_id, aktor, aksi, detail_json, dibuat_at) VALUES (?, 'server', 'pin_terkunci', ?, ?)",
        )
        .run(peserta.ujian_id, JSON.stringify({ peserta_id: peserta.id, perangkat }), k.jam());
      beritahuPantau(k, peserta.ujian_id);
      throw new GalatHttp(423, 'terkunci');
    }
    throw new GalatHttp(401, 'pin_salah', { sisa: BATAS_PIN_SALAH - slot });
  }

  router.post('/peserta/masuk', async (req, res) => {
    const input = validasi(PesertaMasukSchema, req.body);
    const ujian = await ujianDariKode(input.kode);
    const ambilPeserta = () =>
      k.db
        .prepare(
          'SELECT id, ujian_id, status, pin_hash, pin_gagal, terkunci_at, masuk_pertama_at FROM peserta WHERE id = ? AND ujian_id = ?',
        )
        .get(input.peserta_id, ujian.id) as BarisPeserta | undefined;

    let peserta = ambilPeserta();
    if (!peserta) throw new GalatHttp(404, 'tidak_ditemukan');
    if (peserta.terkunci_at !== null) throw new GalatHttp(423, 'terkunci');
    const perangkat = ringkasPerangkat(req.get('user-agent'));

    let pinBaruDibuat = false;
    // Hash yang benar-benar dicocokkan; dipastikan masih sama saat sesi dibuat (lihat transaksi di bawah).
    let hashDicek: string | null = peserta.pin_hash;
    if (peserta.pin_hash === null) {
      // Membuat PIN pertama kali.
      if (input.pin_ulang !== input.pin) throw new GalatHttp(400, 'pin_tidak_sama');
      const hash = await hashRahasia(input.pin);
      // "AND pin_hash IS NULL": bila dua orang memilih nama yang sama hampir bersamaan,
      // hanya yang pertama yang berhasil membuat PIN; yang kedua diperlakukan sebagai login biasa.
      const dibuat = k.db
        .prepare('UPDATE peserta SET pin_hash = ?, pin_dibuat_at = ? WHERE id = ? AND pin_hash IS NULL')
        .run(hash, k.jam(), peserta.id).changes;
      pinBaruDibuat = dibuat === 1;
      if (pinBaruDibuat) {
        hashDicek = hash;
      } else {
        peserta = ambilPeserta();
        if (!peserta) throw new GalatHttp(404, 'tidak_ditemukan');
        // PIN yang baru dibuat orang lain sudah direset lagi oleh guru di sela-selanya.
        if (peserta.pin_hash === null) throw new GalatHttp(409, 'pin_berubah');
        hashDicek = peserta.pin_hash;
      }
    }

    if (!pinBaruDibuat) await cekPin(peserta, input.pin, perangkat);

    const pesertaId = peserta.id;
    const sekarang = k.jam();
    const token = k.db.transaction(() => {
      // PIN benar: penghitung (termasuk slot yang dipesan cekPin) dikembalikan ke 0.
      // "AND pin_hash IS ?": bila guru menekan Reset PIN saat PIN ini sedang dicek, login dibatalkan
      // supaya tidak ada sesi yang lahir dari PIN yang sudah dihapus.
      const tetap = k.db
        .prepare('UPDATE peserta SET pin_gagal = 0, terkunci_at = NULL WHERE id = ? AND pin_hash IS ?')
        .run(pesertaId, hashDicek).changes;
      if (tetap === 0) throw new GalatHttp(409, 'pin_berubah');
      const dicabut = cabutSesiPeserta(k.db, sekarang, pesertaId, 'diambil_alih');
      if (dicabut > 0) {
        k.db
          .prepare(
            "INSERT INTO event_integritas (ujian_id, peserta_id, jenis, mulai_at, detail_json) VALUES (?, ?, 'masuk_ulang', ?, ?)",
          )
          .run(ujian.id, pesertaId, sekarang, JSON.stringify({ perangkat }));
      }
      // Status peserta mengikuti fase ujian (docs/DESAIN.md §3, tabel status peserta). Status ujian DIBACA
      // ULANG di sini: pengecekan PIN (scrypt) bisa antre beberapa detik, dan guru mungkin menekan Mulai/Akhiri
      // di sela-selanya. Memakai status lama membuat siswa terjebak "menunggu" saat ujian sudah berlangsung.
      const statusKini = k.db.prepare('SELECT status FROM ujian WHERE id = ?').pluck().get(ujian.id) as StatusUjian;
      if (statusKini === 'menunggu') {
        k.db
          .prepare("UPDATE peserta SET status = 'menunggu', masuk_pertama_at = ? WHERE id = ? AND status = 'belum_masuk'")
          .run(sekarang, pesertaId);
      } else if (statusKini === 'berlangsung' || statusKini === 'dijeda') {
        // Peserta terlambat langsung mengerjakan dengan sisa waktu global.
        k.db
          .prepare(
            `UPDATE peserta SET status = 'mengerjakan', masuk_pertama_at = COALESCE(masuk_pertama_at, ?)
             WHERE id = ? AND status IN ('belum_masuk', 'menunggu')`,
          )
          .run(sekarang, pesertaId);
      }
      return buatSesi(k.db, sekarang, { lingkup: 'peserta', pesertaId, infoPerangkat: perangkat });
    })();

    // Aliran SSE yang masih terbuka milik sesi lama (mis. laptop lain) ditutup dengan `sesi_dicabut`.
    // Sesi baru belum punya aliran, jadi semua aliran peserta ini memang milik sesi lama.
    k.sse.tutupPeserta((kon) => kon.pesertaId === pesertaId, 'sesi_dicabut', { alasan: 'diambil_alih' });
    beritahuPantau(k, ujian.id);
    pasangCookieSesi(req, res, 'peserta', token, k.originPublik);
    res.status(204).end();
  });

  router.post('/peserta/keluar', wajibPeserta, (req, res) => {
    const { idHash } = sesiDari(res);
    cabutSesi(k.db, k.jam(), idHash, 'keluar');
    k.sse.tutupPeserta((kon) => kon.sesiHash === idHash, 'sesi_dicabut', { alasan: 'keluar' });
    hapusCookieSesi(req, res, 'peserta', k.originPublik);
    res.status(204).end();
  });

  router.get('/peserta/saya', wajibPeserta, (_req, res) => {
    const baris = k.db
      .prepare(
        `SELECT p.nama, p.nomor, p.status, u.judul, u.status AS status_ujian
         FROM peserta p JOIN ujian u ON u.id = p.ujian_id WHERE p.id = ?`,
      )
      .get(sesiDari(res).pesertaId) as
      | { nama: string; nomor: string; status: StatusPeserta; judul: string; status_ujian: StatusUjian }
      | undefined;
    if (!baris) throw new GalatHttp(401, 'belum_masuk');
    const body: PesertaSaya = {
      nama: baris.nama,
      nomor: baris.nomor,
      status: baris.status,
      ujian: { judul: baris.judul, status: baris.status_ujian },
    };
    res.json(body);
  });

  return router;
}
