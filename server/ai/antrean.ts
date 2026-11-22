// server/ai/antrean.ts — antrean penilaian AI di dalam proses server: mengambil tugas dari DB, memanggil adapter,
// memvalidasi keluaran, menulis draf nilai, mencatat biaya, dan menjaga batas biaya bulanan.
// Dipanggil oleh: server/app.ts (dibuat sekali, dipulihkan saat start), server/routes/penilaian-ai.ts (mulai,
//                 hentikan, status), tes (adapter tiruan + diam()).
// Memanggil: server/ai/adapter.ts, server/ai/prompt.ts, server/ai/harga.ts, shared/ujian.ts (baca rubrik), database.
// Cara kerja:
// - Job ada di tabel ai_run/ai_tugas (migrasi 0004), bukan di memori. Setelah restart, tugas 'berjalan' (yang
//   terputus) dikembalikan ke 'menunggu' dan antrean lanjut sendiri.
// - Paling banyak `paralel` permintaan sekaligus, diurutkan per soal supaya konteks soal yang sama terbaca dari cache.
// - Batas biaya bulanan (bulan kalender UTC, sama dengan cara Console menghitung bulan): sebelum tiap permintaan,
//   terpakai bulan ini + cadangan permintaan yang sedang jalan + biaya TERBURUK permintaan ini (seluruh max_tokens)
//   tidak boleh melewati batas. Bila akan lewat, run dihentikan ("batas_biaya"); sisanya dinilai manual.
// - Hasil yang lolos validasi ditulis ke `penilaian` sebagai sumber 'ai', status 'draf', HANYA bila jawaban itu
//   belum punya nilai (nilai/draf guru tidak pernah ditimpa). Gagal validasi → coba ulang (maks MAKS_PERCOBAAN),
//   lalu 'perlu_manual'. Tidak pernah ada nilai tebakan (aturan keras #7).
// - Log server tidak pernah memuat kunci API atau isi jawaban; hanya id tugas & pesan galat ringkas.
import type { Db } from '../db/connection.ts';
import type { Jam } from '../auth/penjaga.ts';
import type { ModelAi } from '../../shared/ai.ts';
import { MODEL_AI } from '../../shared/ai.ts';
import { RubrikSchema } from '../../shared/ujian.ts';
import type { Rubrik } from '../../shared/ujian.ts';
import type { AdapterAi, JawabanAi } from './adapter.ts';
import { GalatAi } from './adapter.ts';
import { biayaMikro, perkiraanToken } from './harga.ts';
import { bungkusJawaban, konteksSoal, MAKS_TOKEN_KELUAR, periksaKeluaran, SISTEM, skemaKeluaran, VERSI_PROMPT } from './prompt.ts';

export const MAKS_PERCOBAAN = 2;

export type OpsiAi = {
  modelBawaan: ModelAi;
  batasMikroUsd: number;
  paralel: number;
  effort: 'low' | 'medium' | 'high';
  // Jeda sebelum tugas yang kena galat sementara (mis. 429 setelah SDK menyerah) dilepas lagi ke antrean, supaya
  // batas laju penyedia sempat pulih dan jawaban tidak buru-buru jatuh ke "perlu manual". Tes memakai 0.
  jedaUlangMs: number;
};

export type LayananAi = {
  // null = ANTHROPIC_API_KEY belum diisi; penilaian manual tetap jalan.
  adapter: AdapterAi | null;
  opsi: OpsiAi;
  // Membuat run + tugas untuk jawaban yang belum dinilai, lalu menjalankan antrean. Pemeriksaan syarat (status ujian,
  // run lain, batas biaya) dilakukan rute sebelum memanggil ini.
  mulai: (ujianId: number, pengujiId: number, model: ModelAi) => number;
  hentikan: (ujianId: number, alasan: string) => boolean;
  terpakaiBulanIniMikro: () => number;
  // Dipanggil sekali saat server start.
  pulihkan: () => void;
  // Hanya untuk tes: selesai bila tidak ada lagi permintaan yang berjalan atau menunggu.
  diam: () => Promise<void>;
};

export type JawabanTarget = { peserta_id: number; soal_id: number; isi: string; soal_teks_panjang: number };

// Jawaban siswa hadir yang belum punya baris nilai (draf/disetujui, manual/AI/otomatis). Jawaban kosong sudah diberi
// 0 saat penilaian dimulai, jadi tidak ikut. Urut per soal.
export function jawabanBelumDinilai(db: Db, ujianId: number): JawabanTarget[] {
  return db
    .prepare(
      `SELECT p.id AS peserta_id, s.id AS soal_id, j.isi AS isi,
              length(s.judul) + length(s.teks) + length(s.jawaban_acuan) + length(s.rubrik_json) AS soal_teks_panjang
       FROM peserta p
       JOIN soal s ON s.ujian_id = p.ujian_id
       JOIN jawaban j ON j.peserta_id = p.id AND j.soal_id = s.id
       WHERE p.ujian_id = ? AND p.status = 'dikumpulkan' AND trim(j.isi) <> ''
         AND NOT EXISTS (SELECT 1 FROM penilaian n WHERE n.peserta_id = p.id AND n.soal_id = s.id)
       ORDER BY s.urutan, s.id, p.id`,
    )
    .all(ujianId) as JawabanTarget[];
}

// Cadangan biaya satu permintaan (perkiraan KONSERVATIF, bukan jaminan mutlak): 1 token per karakter masukan (jauh
// di atas rasio nyata, juga untuk teks Arab berharakat) + 2.000 token untuk skema keluaran & instruksi sistem
// penyedia, tanpa diskon cache, + seluruh max_tokens keluaran. Sisa celah yang diketahui: permintaan yang habis waktu
// di sisi server lalu diulang SDK bisa tetap ditagih penyedia tetapi tidak tercatat di sini.
export function biayaTerburukMikro(model: ModelAi, karakterMasuk: number): number {
  return biayaMikro(model, { masuk: SISTEM.length + karakterMasuk + 2000, tulisCache: 0, bacaCache: 0, keluar: MAKS_TOKEN_KELUAR });
}

// Perkiraan biaya wajar (bukan terburuk) untuk tampilan: masukan tanpa cache + ±1.000 token keluaran per jawaban
// (ASUMSI kasar: JSON alasan/kutipan per kriteria + catatan + sedikit thinking pada effort rendah).
export function perkiraanMikro(model: ModelAi, target: JawabanTarget[]): number {
  return target.reduce(
    (n, t) =>
      n + biayaMikro(model, { masuk: perkiraanToken(SISTEM.length + t.soal_teks_panjang + t.isi.length + 200), tulisCache: 0, bacaCache: 0, keluar: 1000 }),
    0,
  );
}

export function awalBulanUtc(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

type BarisTugas = { id: number; run_id: number; ujian_id: number; peserta_id: number; soal_id: number; percobaan: number; model: string };

export function buatLayananAi(dep: { db: Db; jam: Jam; adapter: AdapterAi | null; opsi: OpsiAi }): LayananAi {
  const { db, jam, adapter, opsi } = dep;
  let aktif = 0;
  // Cadangan biaya terburuk permintaan yang sedang berjalan (id tugas → mikro-USD).
  const cadangan = new Map<number, number>();
  const penungguDiam: (() => void)[] = [];

  const terpakaiBulanIniMikro = (): number =>
    db.prepare('SELECT COALESCE(SUM(biaya_mikro_usd), 0) FROM ai_pemakaian WHERE dibuat_at >= ?').pluck().get(awalBulanUtc(jam())) as number;

  function hentikanRun(runId: number, alasan: string): void {
    const t = jam();
    db.transaction(() => {
      db.prepare("UPDATE ai_run SET status = 'dihentikan', alasan_berhenti = ?, selesai_at = ? WHERE id = ? AND status = 'berjalan'").run(
        alasan.slice(0, 300),
        t,
        runId,
      );
      db.prepare("UPDATE ai_tugas SET status = 'dibatalkan', diubah_at = ? WHERE run_id = ? AND status = 'menunggu'").run(t, runId);
    })();
  }

  function tutupRunSelesai(): void {
    db.prepare(
      `UPDATE ai_run SET status = 'selesai', selesai_at = ?
       WHERE status = 'berjalan'
         AND NOT EXISTS (SELECT 1 FROM ai_tugas t WHERE t.run_id = ai_run.id AND t.status IN ('menunggu', 'berjalan'))`,
    ).run(jam());
  }

  function ambilTugas(): BarisTugas | null {
    const t = db
      .prepare(
        `SELECT t.id, t.run_id, t.ujian_id, t.peserta_id, t.soal_id, t.percobaan, r.model
         FROM ai_tugas t JOIN ai_run r ON r.id = t.run_id JOIN soal s ON s.id = t.soal_id
         WHERE t.status = 'menunggu' AND r.status = 'berjalan'
         ORDER BY t.run_id, s.urutan, s.id, t.id LIMIT 1`,
      )
      .get() as BarisTugas | undefined;
    if (!t) return null;
    db.prepare("UPDATE ai_tugas SET status = 'berjalan', diubah_at = ? WHERE id = ?").run(jam(), t.id);
    return t;
  }

  function setTugas(id: number, status: 'menunggu' | 'perlu_manual' | 'dibatalkan', galat: string | null, percobaan?: number): void {
    db.prepare('UPDATE ai_tugas SET status = ?, galat = ?, percobaan = COALESCE(?, percobaan), diubah_at = ? WHERE id = ?').run(
      status,
      galat === null ? null : galat.slice(0, 500),
      percobaan ?? null,
      jam(),
      id,
    );
  }

  function gagal(t: BarisTugas, masalah: string): void {
    const ke = t.percobaan + 1;
    if (ke >= MAKS_PERCOBAAN) {
      setTugas(t.id, 'perlu_manual', masalah, ke);
      return;
    }
    // Run yang sudah dihentikan (guru menekan Hentikan selama permintaan ini berjalan) tidak menerima tugas baru.
    const runBerjalan = db.prepare("SELECT 1 FROM ai_run WHERE id = ? AND status = 'berjalan'").get(t.run_id) !== undefined;
    setTugas(t.id, runBerjalan ? 'menunggu' : 'dibatalkan', masalah, ke);
  }

  async function kerjakan(t: BarisTugas): Promise<void> {
    if (!adapter) {
      setTugas(t.id, 'menunggu', null);
      return;
    }
    const model = (MODEL_AI as readonly string[]).includes(t.model) ? (t.model as ModelAi) : null;
    const ujian = db.prepare('SELECT status FROM ujian WHERE id = ?').pluck().get(t.ujian_id) as string | undefined;
    const soal = db
      .prepare('SELECT judul, teks, rubrik_json, jawaban_acuan FROM soal WHERE id = ? AND ujian_id = ?')
      .get(t.soal_id, t.ujian_id) as { judul: string; teks: string; rubrik_json: string; jawaban_acuan: string } | undefined;
    const jawaban = db.prepare('SELECT isi, versi FROM jawaban WHERE peserta_id = ? AND soal_id = ?').get(t.peserta_id, t.soal_id) as
      | { isi: string; versi: number }
      | undefined;
    const sudahDinilai = db.prepare('SELECT 1 FROM penilaian WHERE peserta_id = ? AND soal_id = ?').get(t.peserta_id, t.soal_id) !== undefined;
    if (!model || ujian !== 'penilaian' || !soal || !jawaban || jawaban.isi.trim() === '') {
      setTugas(t.id, 'dibatalkan', 'ujian tidak lagi dalam tahap penilaian atau jawaban tidak ditemukan');
      return;
    }
    if (sudahDinilai) {
      // Guru sudah menilai jawaban ini sementara antrean berjalan: tidak perlu membayar penilaian AI.
      setTugas(t.id, 'dibatalkan', 'sudah dinilai guru');
      return;
    }
    let rubrikMentah: unknown = null;
    try {
      rubrikMentah = JSON.parse(soal.rubrik_json);
    } catch {
      // Ditangani di bawah sebagai rubrik yang tidak bisa dibaca.
    }
    const rubrikParse = RubrikSchema.safeParse(rubrikMentah);
    if (!rubrikParse.success || rubrikParse.data.kriteria.length === 0) {
      setTugas(t.id, 'perlu_manual', 'rubrik soal tidak bisa dibaca');
      return;
    }
    const rubrik: Rubrik = rubrikParse.data;
    const konteks = konteksSoal({ judul: soal.judul, teks: soal.teks, jawaban_acuan: soal.jawaban_acuan, rubrik });
    const isiJawaban = bungkusJawaban(jawaban.isi);

    // Batas biaya bulanan (dicek & dicadangkan secara sinkron, jadi permintaan paralel tidak bisa "menyalip").
    const terburuk = biayaTerburukMikro(model, konteks.length + isiJawaban.length);
    const dicadangkan = [...cadangan.values()].reduce((n, v) => n + v, 0);
    if (terpakaiBulanIniMikro() + dicadangkan + terburuk > opsi.batasMikroUsd) {
      setTugas(t.id, 'menunggu', null);
      hentikanRun(t.run_id, 'batas_biaya');
      return;
    }
    cadangan.set(t.id, terburuk);

    let hasilPanggil: JawabanAi;
    try {
      hasilPanggil = await adapter.nilai({
        model,
        sistem: SISTEM,
        konteksSoal: konteks,
        jawaban: isiJawaban,
        skema: skemaKeluaran(rubrik),
        maksTokenKeluar: MAKS_TOKEN_KELUAR,
        effort: opsi.effort,
      });
    } catch (e) {
      if (e instanceof GalatAi && e.jenis === 'fatal') {
        setTugas(t.id, 'menunggu', e.message);
        hentikanRun(t.run_id, e.message);
        console.warn(`[ai] run ${t.run_id} dihentikan: ${e.kode}`);
        return;
      }
      const pesan = e instanceof GalatAi ? e.message : 'galat tak terduga saat memanggil penyedia AI';
      if (!(e instanceof GalatAi)) console.error(`[ai] tugas ${t.id}:`, e instanceof Error ? e.message : String(e));
      // Slot paralel ini menunggu dulu (slot lain tetap jalan), baru tugasnya dikembalikan ke antrean.
      cadangan.delete(t.id);
      if (opsi.jedaUlangMs > 0) await new Promise((r) => setTimeout(r, opsi.jedaUlangMs));
      gagal(t, pesan);
      return;
    }

    const biaya = biayaMikro(model, hasilPanggil.pemakaian);
    const p = hasilPanggil.pemakaian;
    db.prepare(
      // Subquery: bila ujian/run sudah terhapus selama permintaan berjalan, kolomnya NULL (bukan galat FK), jadi
      // biaya yang sudah ditagih penyedia tetap terhitung untuk batas bulanan.
      `INSERT INTO ai_pemakaian (ujian_id, run_id, model, token_masuk, token_tulis_cache, token_baca_cache, token_keluar, biaya_mikro_usd, dibuat_at)
       VALUES ((SELECT id FROM ujian WHERE id = ?), (SELECT id FROM ai_run WHERE id = ?), ?, ?, ?, ?, ?, ?, ?)`,
    ).run(t.ujian_id, t.run_id, model, p.masuk, p.tulisCache, p.bacaCache, p.keluar, biaya, jam());

    if (hasilPanggil.berhenti !== 'selesai' || hasilPanggil.teks === null) {
      const sebab = {
        batas_token: 'keluaran AI terpotong (batas token)',
        ditolak: 'AI menolak menilai jawaban ini',
        lain: 'AI berhenti tanpa keluaran yang lengkap',
        selesai: 'AI tidak mengembalikan teks',
      }[hasilPanggil.berhenti];
      gagal(t, sebab);
      return;
    }
    const periksa = periksaKeluaran(hasilPanggil.teks, rubrik, jawaban.isi);
    if (!periksa.ok) {
      gagal(t, periksa.masalah);
      return;
    }
    const hasil = periksa.hasil;
    const sekarang = jam();
    db.transaction(() => {
      db.prepare("UPDATE ai_tugas SET status = 'selesai', hasil_json = ?, galat = NULL, percobaan = percobaan + 1, versi_jawaban = ?, diubah_at = ? WHERE id = ?").run(
        JSON.stringify(hasil),
        jawaban.versi,
        sekarang,
        t.id,
      );
      const masihPenilaian = db.prepare('SELECT status FROM ujian WHERE id = ?').pluck().get(t.ujian_id) === 'penilaian';
      if (masihPenilaian) {
        db.prepare(
          `INSERT INTO penilaian (ujian_id, peserta_id, soal_id, skor_json, catatan, sumber, status, versi_jawaban, dinilai_at)
           VALUES (?, ?, ?, ?, ?, 'ai', 'draf', ?, ?) ON CONFLICT (peserta_id, soal_id) DO NOTHING`,
        ).run(t.ujian_id, t.peserta_id, t.soal_id, JSON.stringify(hasil.skor), hasil.catatan_siswa.slice(0, 2000), jawaban.versi, sekarang);
      }
    })();
  }

  function pompa(): void {
    while (adapter && aktif < opsi.paralel) {
      const t = ambilTugas();
      if (!t) break;
      aktif += 1;
      void kerjakan(t)
        .catch((e: unknown) => {
          // Galat tak terduga (mis. disk penuh): tugas dicoba lagi/ditandai manual, antrean tetap jalan.
          console.error(`[ai] tugas ${t.id} gagal:`, e instanceof Error ? e.message : String(e));
          try {
            gagal(t, 'galat server saat memproses hasil AI');
          } catch {
            // Bila DB pun gagal, tugas tetap 'berjalan' dan dipulihkan saat restart.
          }
        })
        .finally(() => {
          aktif -= 1;
          cadangan.delete(t.id);
          pompa();
        });
    }
    tutupRunSelesai();
    if (aktif === 0) {
      for (const f of penungguDiam.splice(0)) f();
    }
  }

  return {
    adapter,
    opsi,
    mulai(ujianId, pengujiId, model) {
      const t = jam();
      const runId = db.transaction(() => {
        const id = db
          .prepare("INSERT INTO ai_run (ujian_id, penguji_id, model, versi_prompt, status, dibuat_at) VALUES (?, ?, ?, ?, 'berjalan', ?)")
          .run(ujianId, pengujiId, model, VERSI_PROMPT, t).lastInsertRowid as number;
        const sisip = db.prepare(
          "INSERT INTO ai_tugas (run_id, ujian_id, peserta_id, soal_id, status, diubah_at) VALUES (?, ?, ?, ?, 'menunggu', ?)",
        );
        for (const j of jawabanBelumDinilai(db, ujianId)) sisip.run(id, ujianId, j.peserta_id, j.soal_id, t);
        return id;
      })();
      // Dijalankan setelah respons dikirim, supaya permintaan guru tidak menunggu panggilan AI pertama.
      setImmediate(pompa);
      return runId;
    },
    hentikan(ujianId, alasan) {
      const run = db.prepare("SELECT id FROM ai_run WHERE ujian_id = ? AND status = 'berjalan'").pluck().get(ujianId) as number | undefined;
      if (run === undefined) return false;
      hentikanRun(run, alasan);
      pompa();
      return true;
    },
    terpakaiBulanIniMikro,
    pulihkan() {
      // Tugas yang terputus dihitung sebagai satu percobaan: bila tugas itu sendiri yang membuat server mati
      // (mis. kehabisan memori) dan pm2 terus me-restart, ia berhenti di "perlu manual", bukan dikirim tanpa batas.
      db.prepare(
        `UPDATE ai_tugas SET percobaan = percobaan + 1, diubah_at = ?,
           status = CASE WHEN percobaan + 1 >= ? THEN 'perlu_manual' ELSE 'menunggu' END,
           galat = CASE WHEN percobaan + 1 >= ? THEN 'terputus berulang kali saat server dimulai ulang' ELSE galat END
         WHERE status = 'berjalan'`,
      ).run(jam(), MAKS_PERCOBAAN, MAKS_PERCOBAAN);
      if (!adapter) {
        for (const id of db.prepare("SELECT id FROM ai_run WHERE status = 'berjalan'").pluck().all() as number[]) {
          hentikanRun(id, 'Kunci API tidak diisi di .env server');
        }
        return;
      }
      pompa();
    },
    diam() {
      return new Promise<void>((resolve) => {
        const cek = (): void => {
          const menunggu = db
            .prepare("SELECT COUNT(*) FROM ai_tugas t JOIN ai_run r ON r.id = t.run_id WHERE t.status = 'menunggu' AND r.status = 'berjalan'")
            .pluck()
            .get() as number;
          if (aktif === 0 && (menunggu === 0 || !adapter)) resolve();
          else penungguDiam.push(cek);
        };
        // Beri kesempatan setImmediate(pompa) dari mulai() berjalan lebih dulu.
        setImmediate(cek);
      });
    },
  };
}
