// server/pantau.ts — merakit potret dasbor guru (`pantau`) dan layar proyektor (`proyektor`) dari DB, lalu
// mengirimkannya ke aliran SSE yang terbuka.
// Dipanggil oleh: server/siaran.ts (setiap ada perubahan), server/routes/pantau.ts (GET & koneksi baru),
//                 server/routes/proyektor.ts (koneksi baru), server/pengecek.ts (penyegaran berkala).
// Memanggil: server/sse.ts, server/waktu-ujian.ts, shared/pantau.ts, database.
// Daftar putih (docs/DESAIN.md §8.1):
// - Potret guru tanpa hash PIN, id anonim, teks soal, atau isi jawaban.
// - Potret proyektor dirakit field demi field: label (nama/inisial), status, jumlah terjawab, ringkasan
//   aktivitas tiga jenis kepergian yang TIDAK ditandai wajar. Tanpa teks, isi, detail, atau upaya tempel.
// Alasan potret utuh (bukan event per perubahan): 30 siswa × ±40 baris kecil, jadi murah; klien cukup
// mengganti datanya, dan sambungan ulang tidak pernah membuat tampilan basi. Pengiriman digabung per 300 ms.
import type { StatusPeserta, StatusUjian } from '../shared/auth.ts';
import type { CaraKumpul } from '../shared/peserta.ts';
import { inisial, JENIS_DI_PROYEKTOR, JENIS_KEPERGIAN } from '../shared/pantau.ts';
import type { EventGuru, JenisEvent, JenisKepergian, LogGuru, Pantau, ProyektorData, Ringkasan } from '../shared/pantau.ts';
import type { Konteks } from './konteks.ts';
import { bacaUjianWaktu, sisaMs, waktuPeserta } from './waktu-ujian.ts';

export const JEDA_GABUNG_PANTAU_MS = 300;
const MAKS_EVENT_GURU = 300;
const MAKS_LOG_GURU = 100;
const MAKS_TERBARU_PROYEKTOR = 8;

type BarisEvent = {
  id: number;
  peserta_id: number;
  jenis: JenisEvent;
  mulai_at: number;
  selesai_at: number | null;
  durasi_ms: number | null;
  detail_json: string;
  ditandai_wajar: number;
  catatan_penguji: string;
};

type BarisPeserta = {
  id: number;
  nama: string;
  nomor: string;
  status: StatusPeserta;
  cara_kumpul: CaraKumpul | null;
  perpanjangan_ms: number;
  dikumpulkan_at: number | null;
  punya_pin: number;
  terkunci: number;
};

function bacaJson(teks: string): Record<string, unknown> {
  try {
    const nilai: unknown = JSON.parse(teks);
    return nilai && typeof nilai === 'object' && !Array.isArray(nilai) ? (nilai as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const KEPERGIAN = new Set<JenisEvent>(JENIS_KEPERGIAN);

// Lama satu event. Kepergian yang belum selesai dihitung sampai `batas`: sekarang, atau saat siswa itu
// dikumpulkan (waktunya sudah berakhir; sama dengan pemotongan di server/routes/event.ts).
// Event tanpa durasi (masuk ulang, tempel, akses sebelum mulai) dihitung 0.
export function lamaEvent(e: Pick<BarisEvent, 'jenis' | 'mulai_at' | 'selesai_at' | 'durasi_ms'>, batas: number): number {
  if (e.durasi_ms !== null) return e.durasi_ms;
  if (e.jenis === 'koneksi_putus' || KEPERGIAN.has(e.jenis)) return Math.max(0, (e.selesai_at ?? batas) - e.mulai_at);
  return 0;
}

function tambahRingkasan(r: Ringkasan, jenis: string, lama: number): void {
  const ada = r[jenis] ?? { kali: 0, total_ms: 0 };
  r[jenis] = { kali: ada.kali + 1, total_ms: ada.total_ms + lama };
}

// mulai_at yang ditampilkan & dipakai mengurutkan = waktu KEJADIAN (mulai_klien_at, sudah dalam jam server),
// bukan saat laporan tiba: laporan yang tertahan offline tetap tampil di jam & urutan yang benar.
const KOLOM_EVENT = `id, peserta_id, jenis, COALESCE(mulai_klien_at, mulai_at) AS mulai_at, selesai_at, durasi_ms,
  detail_json, ditandai_wajar, catatan_penguji`;

function bacaEvent(k: Konteks, ujianId: number): BarisEvent[] {
  return k.db
    .prepare(
      `SELECT ${KOLOM_EVENT} FROM event_integritas WHERE ujian_id = ? ORDER BY mulai_at DESC, id DESC`,
    )
    .all(ujianId) as BarisEvent[];
}

export function keEventGuru(e: BarisEvent): EventGuru {
  return {
    id: e.id,
    peserta_id: e.peserta_id,
    jenis: e.jenis,
    mulai_at: e.mulai_at,
    selesai_at: e.selesai_at,
    durasi_ms: e.durasi_ms,
    detail: bacaJson(e.detail_json),
    ditandai_wajar: e.ditandai_wajar === 1,
    catatan_penguji: e.catatan_penguji,
  };
}

export function bacaEventPeserta(k: Konteks, ujianId: number, pesertaId: number): EventGuru[] {
  const baris = k.db
    .prepare(
      `SELECT ${KOLOM_EVENT} FROM event_integritas WHERE ujian_id = ? AND peserta_id = ? ORDER BY mulai_at DESC, id DESC`,
    )
    .all(ujianId, pesertaId) as BarisEvent[];
  return baris.map(keEventGuru);
}

function bacaPeserta(k: Konteks, ujianId: number): BarisPeserta[] {
  return k.db
    .prepare(
      `SELECT id, nama, nomor, status, cara_kumpul, perpanjangan_ms, dikumpulkan_at,
         pin_hash IS NOT NULL AS punya_pin, terkunci_at IS NOT NULL AS terkunci
       FROM peserta WHERE ujian_id = ? ORDER BY nama COLLATE NOCASE, nomor, id`,
    )
    .all(ujianId) as BarisPeserta[];
}

// Batas hitung kepergian yang belum selesai per siswa: saat dikumpulkan, atau sekarang.
function batasPeserta(peserta: BarisPeserta[], t: number): Map<number, number> {
  return new Map(peserta.map((p) => [p.id, Math.min(t, p.dikumpulkan_at ?? t)]));
}

function bacaTerjawab(k: Konteks, ujianId: number): Map<number, { terjawab: number; terakhir: number }> {
  const baris = k.db
    .prepare(
      `SELECT peserta_id, SUM(CASE WHEN length(trim(isi)) > 0 THEN 1 ELSE 0 END) AS terjawab,
         MAX(CASE WHEN versi > 0 THEN diubah_at END) AS terakhir
       FROM jawaban WHERE ujian_id = ? GROUP BY peserta_id`,
    )
    .all(ujianId) as { peserta_id: number; terjawab: number; terakhir: number | null }[];
  return new Map(baris.map((b) => [b.peserta_id, { terjawab: b.terjawab, terakhir: b.terakhir ?? 0 }]));
}

export function muatPantau(k: Konteks, ujianId: number): Pantau | null {
  const info = k.db
    .prepare('SELECT id, judul, kode, status, mode_tampil FROM ujian WHERE id = ?')
    .get(ujianId) as { id: number; judul: string; kode: string; status: StatusUjian; mode_tampil: 'nama' | 'inisial' } | undefined;
  const u = bacaUjianWaktu(k.db, ujianId);
  if (!info || !u) return null;
  const t = k.jam();
  const dimulai = u.dimulai_at !== null;
  const jumlahSoal = k.db.prepare('SELECT COUNT(*) FROM soal WHERE ujian_id = ?').pluck().get(ujianId) as number;
  const terjawab = bacaTerjawab(k, ujianId);

  // Perangkat terakhir yang dipakai masuk tiap siswa (sesi terbaru).
  const perangkat = new Map<number, string>();
  const sesi = k.db
    .prepare(
      `SELECT s.peserta_id, s.info_perangkat FROM sesi s JOIN peserta p ON p.id = s.peserta_id
       WHERE p.ujian_id = ? ORDER BY s.dibuat_at, s.rowid`,
    )
    .all(ujianId) as { peserta_id: number; info_perangkat: string }[];
  for (const s of sesi) perangkat.set(s.peserta_id, s.info_perangkat);

  const terlambat = new Map(
    (
      k.db
        .prepare(
          "SELECT peserta_id, COUNT(*) AS n FROM jawaban_terlambat WHERE ujian_id = ? AND keputusan = 'menunggu' GROUP BY peserta_id",
        )
        .all(ujianId) as { peserta_id: number; n: number }[]
    ).map((b) => [b.peserta_id, b.n]),
  );

  const daftarPeserta = bacaPeserta(k, ujianId);
  const batas = batasPeserta(daftarPeserta, t);
  const event = bacaEvent(k, ujianId);
  const aktivitas = new Map<number, Ringkasan>();
  for (const e of event) {
    if (e.ditandai_wajar === 1) continue;
    const r = aktivitas.get(e.peserta_id) ?? {};
    tambahRingkasan(r, e.jenis, lamaEvent(e, batas.get(e.peserta_id) ?? t));
    aktivitas.set(e.peserta_id, r);
  }

  const tersambung = new Set(k.sse.koneksiPeserta((kon) => kon.ujianId === ujianId).map((kon) => kon.pesertaId));

  const log = k.db
    .prepare('SELECT id, aktor, aksi, detail_json, dibuat_at FROM log_aksi WHERE ujian_id = ? ORDER BY dibuat_at DESC, id DESC LIMIT ?')
    .all(ujianId, MAKS_LOG_GURU) as { id: number; aktor: LogGuru['aktor']; aksi: string; detail_json: string; dibuat_at: number }[];

  return {
    ujian: {
      id: info.id,
      judul: info.judul,
      kode: info.kode,
      status: info.status,
      mode_tampil: info.mode_tampil,
      jumlah_soal: jumlahSoal,
      waktu: dimulai ? waktuPeserta(u, { perpanjangan_ms: 0 }, t) : null,
    },
    peserta: daftarPeserta.map((p) => ({
      id: p.id,
      nama: p.nama,
      nomor: p.nomor,
      status: p.status,
      cara_kumpul: p.cara_kumpul,
      tersambung: tersambung.has(p.id),
      info_perangkat: perangkat.get(p.id) ?? '',
      terjawab: terjawab.get(p.id)?.terjawab ?? 0,
      simpan_terakhir_at: terjawab.get(p.id)?.terakhir || null,
      sisa_ms: dimulai ? sisaMs(u, p, t) : null,
      perpanjangan_ms: p.perpanjangan_ms,
      punya_pin: p.punya_pin === 1,
      terkunci: p.terkunci === 1,
      aktivitas: aktivitas.get(p.id) ?? {},
      terlambat_menunggu: terlambat.get(p.id) ?? 0,
    })),
    event: event.slice(0, MAKS_EVENT_GURU).map(keEventGuru),
    log: log.map((l) => ({ id: l.id, aktor: l.aktor, aksi: l.aksi, detail: bacaJson(l.detail_json), dibuat_at: l.dibuat_at })),
    jam_server: t,
  };
}

export function muatProyektor(k: Konteks, ujianId: number): ProyektorData | null {
  const info = k.db
    .prepare('SELECT judul, kode, status, mode_tampil FROM ujian WHERE id = ?')
    .get(ujianId) as { judul: string; kode: string; status: StatusUjian; mode_tampil: 'nama' | 'inisial' } | undefined;
  const u = bacaUjianWaktu(k.db, ujianId);
  if (!info || !u) return null;
  const t = k.jam();
  const label = (nama: string): string => (info.mode_tampil === 'inisial' ? inisial(nama) : nama);
  const jumlahSoal = k.db.prepare('SELECT COUNT(*) FROM soal WHERE ujian_id = ?').pluck().get(ujianId) as number;
  const terjawab = bacaTerjawab(k, ujianId);
  const peserta = bacaPeserta(k, ujianId);
  const namaPeserta = new Map(peserta.map((p) => [p.id, p.nama]));

  // Hanya tiga jenis kepergian yang tidak ditandai wajar (upaya tempel & kejadian server hanya untuk guru).
  const boleh = new Set(JENIS_DI_PROYEKTOR);
  const batas = batasPeserta(peserta, t);
  const event = bacaEvent(k, ujianId).filter((e) => e.ditandai_wajar === 0 && boleh.has(e.jenis));
  const aktivitas = new Map<number, Ringkasan>();
  for (const e of event) {
    const r = aktivitas.get(e.peserta_id) ?? {};
    tambahRingkasan(r, e.jenis, lamaEvent(e, batas.get(e.peserta_id) ?? t));
    aktivitas.set(e.peserta_id, r);
  }

  return {
    judul: info.judul,
    status: info.status,
    kode: info.status === 'menunggu' ? info.kode : null,
    waktu: u.dimulai_at !== null ? waktuPeserta(u, { perpanjangan_ms: 0 }, t) : null,
    hadir: peserta.filter((p) => p.status !== 'belum_masuk').length,
    total: peserta.length,
    terkumpul: peserta.filter((p) => p.status === 'dikumpulkan').length,
    peserta: peserta.map((p) => ({
      label: label(p.nama),
      status: p.status,
      terjawab: terjawab.get(p.id)?.terjawab ?? 0,
      jumlah_soal: jumlahSoal,
      aktivitas: aktivitas.get(p.id) ?? {},
    })),
    terbaru: event.slice(0, MAKS_TERBARU_PROYEKTOR).map((e) => ({
      label: label(namaPeserta.get(e.peserta_id) ?? ''),
      jenis: e.jenis as JenisKepergian,
      // null = masih berlangsung (siswa belum kembali dan waktunya belum berakhir).
      durasi_ms: e.selesai_at === null && (batas.get(e.peserta_id) ?? t) >= t ? null : lamaEvent(e, batas.get(e.peserta_id) ?? t),
      mulai_at: e.mulai_at,
    })),
    jam_server: t,
  };
}

// Mengirim potret terbaru ke semua aliran guru & proyektor milik ujian ini, sekarang juga.
export function kirimPantauSekarang(k: Konteks, ujianId: number): void {
  const guru = k.sse.aliranPantau((a) => a.ujianId === ujianId && a.jenis === 'guru');
  if (guru.length > 0) {
    const data = muatPantau(k, ujianId);
    if (data) for (const a of guru) k.sse.kirim(a.res, 'pantau', data);
  }
  const proyektor = k.sse.aliranPantau((a) => a.ujianId === ujianId && a.jenis === 'proyektor');
  if (proyektor.length > 0) {
    const data = muatProyektor(k, ujianId);
    if (data) for (const a of proyektor) k.sse.kirim(a.res, 'proyektor', data);
  }
}

// Ada yang berubah di ujian ini: potret dikirim paling lambat 300 ms lagi, digabung dengan perubahan lain.
// Syarat "event muncul ≤ 3 dtk di dasbor & proyektor" (docs/PLAN.md Fase 5) tetap terpenuhi.
export function beritahuPantau(k: Konteks, ujianId: number): void {
  if (k.sse.aliranPantau((a) => a.ujianId === ujianId).length === 0) return;
  k.sse.tunda(`pantau:${ujianId}`, JEDA_GABUNG_PANTAU_MS, () => {
    try {
      kirimPantauSekarang(k, ujianId);
    } catch (galat) {
      console.error(`[pantau] Gagal mengirim potret ujian ${ujianId}:`, galat);
    }
  });
}
