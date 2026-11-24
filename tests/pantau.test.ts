// tests/pantau.test.ts — Fase 5: laporan aktivitas dari browser siswa, dasbor guru (potret & SSE), layar
// proyektor (daftar putih), tanda "wajar", perpanjangan & buka kembali, buka kunci semua, koneksi putus,
// jawaban per siswa untuk guru, dan perangkat dikenal.
// Dipanggil oleh: `npm test`. Memanggil: tests/bantuan.ts, server lewat HTTP sungguhan (jam palsu).
// Mengacu pada docs/DESAIN.md §4 (perpanjangan), §6 (penerimaan laporan), §8 (endpoint), §8.1 (daftar putih).
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BukaKunciSemuaHasilSchema,
  DaftarPerangkatGuruSchema,
  JawabanGuruSchema,
  KUNCI_TERLARANG_PROYEKTOR,
  PantauSchema,
  ProyektorDataSchema,
} from '../shared/pantau.ts';
import type { LaporanEvent, Pantau } from '../shared/pantau.ts';
import { TOLERANSI_MS } from '../shared/peserta.ts';
import { isiDataAwal, mulaiAplikasiUji, PASSWORD_GURU, T0 } from './bantuan.ts';
import type { AplikasiUji, Klien } from './bantuan.ts';

let a: AplikasiUji;
let guru: Klien;

const MENIT = 60_000;
const DURASI_MS = 90 * MENIT;
const RUBRIK = JSON.stringify({
  kriteria: [{ id: 'k1', nama: 'Analisis', bobot: 1, level: [{ skor: 0, deskriptor: 'x' }, { skor: 2, deskriptor: 'y' }] }],
  poin_wajib: [],
});

type Siswa = { k: Klien; tab: string; id: number };

async function masukGuru(): Promise<Klien> {
  const k = a.klien();
  assert.equal((await k.minta('POST', '/api/penguji/masuk', { body: { username: 'guru1', password: PASSWORD_GURU } })).status, 204);
  return k;
}

async function masukSiswa(id: number): Promise<Siswa> {
  const k = a.klien();
  const r = await k.minta('POST', '/api/peserta/masuk', { body: { kode: 'ABC234', peserta_id: id, pin: '1234', pin_ulang: '1234' } });
  assert.equal(r.status, 204, JSON.stringify(r.body));
  const tab = randomUUID();
  assert.equal((await k.minta('POST', '/api/peserta/tab', { body: { tab_id: tab } })).status, 204);
  return { k, tab, id };
}

function lapor(s: Siswa, lap: Partial<LaporanEvent> = {}, tab = s.tab) {
  return s.k.minta('POST', '/api/peserta/event', {
    headers: { 'x-tab-id': tab },
    body: { id_klien: randomUUID(), jenis: 'tab_tersembunyi', tahap: 'mulai', mulai_klien_at: T0, ...lap },
  });
}

type BarisEvent = { jenis: string; mulai_at: number; selesai_at: number | null; durasi_ms: number | null; detail_json: string };
function eventSiswa(id: number): BarisEvent[] {
  return a.db
    .prepare('SELECT jenis, mulai_at, selesai_at, durasi_ms, detail_json FROM event_integritas WHERE peserta_id = ? ORDER BY id')
    .all(id) as BarisEvent[];
}

async function pantau(): Promise<Pantau> {
  const r = await guru.minta('GET', '/api/ujian/1/pantau');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return PantauSchema.parse(r.body);
}

async function aksi(path: string, body?: unknown): Promise<number> {
  return (await guru.minta('POST', `/api/ujian/1/${path}`, body === undefined ? {} : { body })).status;
}

function semuaKunci(nilai: unknown, kumpulan = new Set<string>()): Set<string> {
  if (Array.isArray(nilai)) for (const n of nilai) semuaKunci(n, kumpulan);
  else if (nilai && typeof nilai === 'object') {
    for (const [kunci, isi] of Object.entries(nilai)) {
      kumpulan.add(kunci);
      semuaKunci(isi, kumpulan);
    }
  }
  return kumpulan;
}

function peserta(id: number): { status: string; cara_kumpul: string | null; perpanjangan_ms: number } {
  return a.db.prepare('SELECT status, cara_kumpul, perpanjangan_ms FROM peserta WHERE id = ?').get(id) as {
    status: string;
    cara_kumpul: string | null;
    perpanjangan_ms: number;
  };
}

beforeEach(async () => {
  a = await mulaiAplikasiUji();
  await isiDataAwal(a.db, 'menunggu');
  a.db
    .prepare(
      `INSERT INTO soal (id, ujian_id, urutan, judul, teks, bobot, rubrik_json, jawaban_acuan, dibuat_at, diubah_at)
       VALUES (11, 1, 1, 'Inflasi', 'TEKS-SOAL-RAHASIA', 1, ?, 'ACUAN-RAHASIA', ?, ?)`,
    )
    .run(RUBRIK, T0, T0);
  guru = await masukGuru();
});
afterEach(() => a.berhenti());

describe('laporan aktivitas dari siswa', () => {
  test('mulai → selesai disatukan (UPSERT); jenis naik peringkat & tidak pernah turun; yang selesai tidak dibuka ulang', async () => {
    const budi = await masukSiswa(1);
    assert.equal(await aksi('mulai'), 200);
    a.majukan(60_000);
    const id = randomUUID();
    assert.equal((await lapor(budi, { id_klien: id, jenis: 'keluar_layar_penuh', mulai_klien_at: T0 + 59_000, detail: { sinyal: ['keluar_layar_penuh'] } })).status, 204);
    // Pindah tab di kepergian yang sama → jenis naik ke tab_tersembunyi.
    await lapor(budi, { id_klien: id, jenis: 'tab_tersembunyi', mulai_klien_at: T0 + 59_000, detail: { sinyal: ['keluar_layar_penuh', 'tab_tersembunyi'] } });
    // Laporan lama yang terkirim ulang (jenis lebih lemah) tidak menurunkannya.
    await lapor(budi, { id_klien: id, jenis: 'keluar_layar_penuh', mulai_klien_at: T0 + 59_000 });
    a.majukan(12_000);
    await lapor(budi, { id_klien: id, jenis: 'tab_tersembunyi', tahap: 'selesai', mulai_klien_at: T0 + 59_000, durasi_ms: 12_000, detail: { sinyal: ['keluar_layar_penuh', 'tab_tersembunyi'] } });
    // "Selesai" yang terkirim ulang dengan durasi lain tidak mengubah apa pun.
    await lapor(budi, { id_klien: id, jenis: 'tab_tersembunyi', tahap: 'selesai', mulai_klien_at: T0 + 59_000, durasi_ms: 99_000 });
    const [e, ...lain] = eventSiswa(1);
    assert.equal(lain.length, 0);
    assert.deepEqual(
      [e?.jenis, e?.mulai_at, e?.selesai_at, e?.durasi_ms, JSON.parse(e?.detail_json ?? '{}')],
      ['tab_tersembunyi', T0 + 60_000, T0 + 72_000, 12_000, { sinyal: ['keluar_layar_penuh', 'tab_tersembunyi'] }],
    );
  });

  test('diabaikan (204) bila tab bukan tab aktif, sebelum Mulai, atau siswa belum mengerjakan', async () => {
    const budi = await masukSiswa(1);
    assert.equal((await lapor(budi, { mulai_klien_at: T0 })).status, 204, 'ujian belum dimulai');
    assert.equal(await aksi('mulai'), 200);
    a.majukan(1000);
    assert.equal((await lapor(budi, { mulai_klien_at: T0 + 500 }, randomUUID())).status, 204, 'tab lain');
    assert.equal(eventSiswa(1).length, 0);
    // Body tidak sah tetap 400 (bukan diabaikan): jenis buatan server tidak boleh dilaporkan browser.
    assert.equal((await lapor(budi, { jenis: 'koneksi_putus' as LaporanEvent['jenis'] })).status, 400);
    assert.equal((await lapor(budi, { detail: { isi: 'teks clipboard' } as LaporanEvent['detail'] })).status, 400);
  });

  test('dinilai dari waktu KEJADIAN: laporan tertahan yang tiba saat dijeda tetap dicatat; kejadian saat jeda tidak', async () => {
    const budi = await masukSiswa(1);
    await aksi('mulai');
    a.majukan(10 * MENIT);
    assert.equal(await aksi('jeda'), 200);
    a.majukan(MENIT);
    await lapor(budi, { mulai_klien_at: T0 + 9 * MENIT, tahap: 'selesai', durasi_ms: 30_000 });
    await lapor(budi, { mulai_klien_at: T0 + 10 * MENIT + 20_000 });
    const ev = eventSiswa(1);
    assert.equal(ev.length, 1);
    assert.equal(ev[0]?.durasi_ms, 30_000);
  });

  test('durasi dipotong di akhir waktu siswa (kembali ke halaman setelah mengumpulkan)', async () => {
    const budi = await masukSiswa(1);
    await aksi('mulai');
    a.majukan(MENIT);
    const id = randomUUID();
    await lapor(budi, { id_klien: id, mulai_klien_at: T0 + MENIT });
    a.majukan(20_000);
    assert.equal((await budi.k.minta('POST', '/api/peserta/kumpulkan', { headers: { 'x-tab-id': budi.tab }, body: { versi: {} } })).status, 204);
    a.majukan(5 * MENIT);
    await lapor(budi, { id_klien: id, tahap: 'selesai', mulai_klien_at: T0 + MENIT, durasi_ms: 5 * MENIT + 20_000 });
    assert.equal(eventSiswa(1)[0]?.durasi_ms, 20_000);
  });

  test('Akhiri menutup kepergian yang belum dilaporkan selesai', async () => {
    const budi = await masukSiswa(1);
    await aksi('mulai');
    a.majukan(MENIT);
    await lapor(budi, { mulai_klien_at: T0 + MENIT });
    a.majukan(MENIT);
    assert.equal(await aksi('akhiri'), 200);
    const [e] = eventSiswa(1);
    assert.deepEqual([e?.selesai_at, e?.durasi_ms], [T0 + 2 * MENIT, MENIT]);
  });

  test('kepergian terbuka siswa yang sudah dikumpulkan dipotong saat ia dikumpulkan (dasbor & Akhiri); jam = jam kejadian', async () => {
    const budi = await masukSiswa(1);
    await aksi('mulai');
    a.majukanBerdetak(MENIT);
    // Laporan tertahan: kejadian di detik 30, baru tiba di detik 60.
    await lapor(budi, { mulai_klien_at: T0 + 30_000 });
    a.majukanBerdetak(2 * MENIT);
    assert.equal((await budi.k.minta('POST', '/api/peserta/kumpulkan', { headers: { 'x-tab-id': budi.tab }, body: { versi: {} } })).status, 204);
    a.majukanBerdetak(10 * MENIT);
    const p = await pantau();
    assert.equal(p.event[0]?.mulai_at, T0 + 30_000, 'jam kejadian, bukan jam laporan tiba');
    assert.deepEqual(p.peserta.find((x) => x.id === 1)?.aktivitas, { tab_tersembunyi: { kali: 1, total_ms: 3 * MENIT - 30_000 } });
    assert.equal(await aksi('akhiri'), 200);
    assert.equal(eventSiswa(1)[0]?.durasi_ms, 3 * MENIT - 30_000);
  });

  test('banjir laporan palsu dibatasi per siswa', async () => {
    const budi = await masukSiswa(1);
    await aksi('mulai');
    a.majukan(1000);
    a.db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 500)
         INSERT INTO event_integritas (ujian_id, peserta_id, id_klien, jenis, mulai_at) SELECT 1, 1, printf('palsu-%08d', i), 'tempel_dari_luar', ? FROM n`,
      )
      .run(T0);
    assert.equal((await lapor(budi, { mulai_klien_at: T0 + 500 })).status, 204);
    assert.equal(eventSiswa(1).length, 500);
  });
});

describe('dasbor guru & proyektor', () => {
  test('potret guru: tersambung, terjawab, aktivitas, perangkat; event muncul lewat SSE ≤ 1 dtk', async () => {
    const budi = await masukSiswa(1);
    await aksi('mulai');
    const aliranSiswa = await budi.k.aliran(`/api/peserta/stream?tab=${budi.tab}`);
    const aliranGuru = await guru.aliran('/api/ujian/1/pantau/stream');
    assert.equal(aliranGuru.header.get('x-accel-buffering'), 'no');
    const awal = PantauSchema.parse(await aliranGuru.tunggu('pantau'));
    assert.equal(awal.ujian.status, 'berlangsung');

    a.majukan(1000);
    const simpan = await budi.k.minta('PUT', '/api/peserta/jawaban/11', {
      headers: { 'x-tab-id': budi.tab },
      body: { isi: 'jawaban budi', ditandai: false, versi_dasar: 0, id_simpan: randomUUID() },
    });
    assert.equal(simpan.status, 200);
    await lapor(budi, { jenis: 'tempel_dari_luar', tahap: 'selesai', mulai_klien_at: T0 + 900, durasi_ms: 0, detail: { panjang: 230 } });
    const mulai = Date.now();
    let p = PantauSchema.parse(await aliranGuru.tunggu('pantau', 2, 1500));
    for (let i = 3; !p.event.length; i++) p = PantauSchema.parse(await aliranGuru.tunggu('pantau', i, 1500));
    assert.ok(Date.now() - mulai < 2500, 'potret baru tiba jauh di bawah syarat 3 dtk (biasanya ±300 ms)');
    const b = p.peserta.find((x) => x.id === 1);
    assert.equal(b?.tersambung, true);
    assert.equal(b?.terjawab, 1);
    assert.equal(b?.sisa_ms, DURASI_MS - 1000);
    assert.deepEqual(b?.aktivitas, { tempel_dari_luar: { kali: 1, total_ms: 0 } });
    assert.deepEqual(p.event[0]?.detail, { panjang: 230 });
    assert.equal(p.peserta.find((x) => x.id === 2)?.tersambung, false);
    // Tanpa rahasia: hash PIN, id anonim, teks soal, isi jawaban.
    const kunci = semuaKunci(p);
    for (const k of ['pin_hash', 'id_anonim', 'teks', 'isi', 'rubrik', 'jawaban_acuan']) assert.equal(kunci.has(k), false, k);
    aliranGuru.tutup();
    aliranSiswa.tutup();
  });

  test('proyektor: daftar putih, tanpa upaya tempel & event "wajar", mode inisial, kode saat menunggu & berlangsung', async () => {
    const kodeR = await guru.minta('POST', '/api/ujian/1/tautan-proyektor');
    const proyektor = a.klien();
    assert.equal((await proyektor.minta('POST', '/api/proyektor/masuk', { body: { kode: (kodeR.body as { kode: string }).kode } })).status, 204);
    const aliran = await proyektor.aliran('/api/proyektor/stream');
    const menunggu = ProyektorDataSchema.parse(await aliran.tunggu('proyektor'));
    assert.deepEqual([menunggu.kode, menunggu.status, menunggu.total, menunggu.waktu], ['ABC234', 'menunggu', 3, null]);

    const budi = await masukSiswa(1);
    await aksi('mulai');
    a.majukan(MENIT);
    await lapor(budi, { mulai_klien_at: T0 + 30_000, tahap: 'selesai', durasi_ms: 15_000 });
    await lapor(budi, { jenis: 'fokus_hilang', mulai_klien_at: T0 + 40_000, tahap: 'selesai', durasi_ms: 3000 });
    await lapor(budi, { jenis: 'tempel_dari_luar', mulai_klien_at: T0 + 50_000, tahap: 'selesai', durasi_ms: 0, detail: { panjang: 9 } });
    const fokus = a.db.prepare("SELECT id FROM event_integritas WHERE jenis = 'fokus_hilang'").pluck().get() as number;
    assert.equal((await guru.minta('PATCH', `/api/ujian/1/event/${fokus}`, { body: { ditandai_wajar: true, catatan_penguji: 'Notifikasi antivirus' } })).status, 204);
    assert.equal((await guru.minta('PATCH', '/api/ujian/1/tampilan', { body: { mode_tampil: 'inisial' } })).status, 200);
    a.db.prepare("UPDATE peserta SET nama = 'Budi Santoso' WHERE id = 1").run();
    await guru.minta('PATCH', '/api/ujian/1/tampilan', { body: { mode_tampil: 'inisial' } });

    let d = ProyektorDataSchema.parse(await aliran.tunggu('proyektor', 2));
    for (let i = 3; d.status !== 'berlangsung' || d.terbaru.length !== 1 || d.peserta.every((p) => p.label !== 'B. S.'); i++) {
      d = ProyektorDataSchema.parse(await aliran.tunggu('proyektor', i));
    }
    assert.equal(d.kode, 'ABC234', 'kode tetap tampil selama ujian untuk siswa yang terlambat');
    assert.equal(d.hadir, 1);
    const budiP = d.peserta.find((p) => p.label === 'B. S.');
    assert.deepEqual(budiP?.aktivitas, { tab_tersembunyi: { kali: 1, total_ms: 15_000 } });
    assert.deepEqual(d.terbaru.map((e) => [e.label, e.jenis, e.durasi_ms]), [['B. S.', 'tab_tersembunyi', 15_000]]);
    const kunci = semuaKunci(d);
    for (const k of KUNCI_TERLARANG_PROYEKTOR) assert.equal(kunci.has(k), false, k);
    assert.equal(JSON.stringify(d).includes('Notifikasi antivirus'), false);
    assert.equal(JSON.stringify(d).includes('TEKS-SOAL-RAHASIA'), false);

    // Cabut proyektor menutup alirannya.
    assert.equal(await aksi('proyektor/cabut'), 204);
    await aliran.berakhir();
    assert.equal(aliran.event.at(-1)?.event, 'sesi_dicabut');
  });

  test('aliran guru: hanya pemilik; sesi siswa & proyektor ditolak', async () => {
    const budi = await masukSiswa(1);
    assert.equal((await budi.k.minta('GET', '/api/ujian/1/pantau')).status, 401);
    assert.equal((await guru.minta('GET', '/api/ujian/2/pantau')).status, 404);
    const aliran = await guru.aliran('/api/ujian/2/pantau/stream');
    assert.equal(aliran.status, 404);
  });

  test('koneksi siswa putus > 10 dtk saat mengerjakan dicatat untuk guru, lalu ditutup saat tersambung lagi', async () => {
    const budi = await masukSiswa(1);
    await aksi('mulai');
    const a1 = await budi.k.aliran(`/api/peserta/stream?tab=${budi.tab}`);
    await a1.tunggu('status');
    a1.tutup();
    // Beri server waktu menerima penutupan koneksi.
    for (let i = 0; i < 50 && eventSiswa(1).length === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
      a.majukanBerdetak(1000);
    }
    const [e] = eventSiswa(1);
    assert.equal(e?.jenis, 'koneksi_putus');
    assert.equal(e?.selesai_at, null);
    const a2 = await budi.k.aliran(`/api/peserta/stream?tab=${budi.tab}`);
    await a2.tunggu('status');
    a.majukanBerdetak(1000);
    const [e2] = eventSiswa(1);
    assert.ok(e2?.selesai_at !== null && (e2?.durasi_ms ?? 0) >= 10_000);
    a2.tutup();
  });
});

describe('perpanjangan & buka kembali (DESAIN §4)', () => {
  test('perpanjang semua setelah waktu habis: yang dikumpulkan otomatis dibuka lagi; yang mengumpulkan sendiri tidak', async () => {
    const budi = await masukSiswa(1);
    const ani = await masukSiswa(2);
    await aksi('mulai');
    // Jam dimajukan SAMBIL berdetak: tanpa detak, pengecek mengira server sempat mati lalu menjeda ujian.
    a.majukanBerdetak(MENIT);
    assert.equal((await ani.k.minta('POST', '/api/peserta/kumpulkan', { headers: { 'x-tab-id': ani.tab }, body: { versi: {} } })).status, 204);
    a.majukanBerdetak(DURASI_MS + TOLERANSI_MS + 2000);
    assert.deepEqual([peserta(1).status, peserta(1).cara_kumpul], ['dikumpulkan', 'waktu_habis']);
    void budi;
    // Sisa global saat ini −(TOLERANSI + 2 dtk + 1 mnt − 1 mnt)… perpanjangan menambal ke 0 dulu lalu +5 menit.
    assert.equal(await aksi('perpanjang', { menit: 5 }), 200);
    const p = await pantau();
    assert.equal(p.ujian.waktu?.sisa_ms, 5 * MENIT);
    assert.deepEqual([peserta(1).status, peserta(1).cara_kumpul], ['mengerjakan', null]);
    assert.deepEqual([peserta(2).status, peserta(2).cara_kumpul], ['dikumpulkan', 'manual']);
    const log = a.db.prepare("SELECT detail_json FROM log_aksi WHERE aksi = 'perpanjang'").pluck().get() as string;
    assert.deepEqual(JSON.parse(log), { menit: 5, peserta_id: null, dibuka_kembali: [1] });
  });

  test('perpanjang satu siswa & koreksi negatif (dibatasi ≥ 0); validasi menit', async () => {
    await masukSiswa(1);
    await aksi('mulai');
    a.majukanBerdetak(10 * MENIT);
    assert.equal(await aksi('perpanjang', { menit: 3, peserta_id: 1 }), 200);
    assert.equal(peserta(1).perpanjangan_ms, 3 * MENIT);
    assert.equal(await aksi('perpanjang', { menit: -5, peserta_id: 1 }), 200);
    assert.equal(peserta(1).perpanjangan_ms, 0);
    // Koreksi negatif saat sisa sudah negatif tidak menaikkan angka perpanjangan (tidak "menambal" ke 0 dulu).
    assert.equal(await aksi('perpanjang', { menit: 2, peserta_id: 1 }), 200);
    a.majukanBerdetak(DURASI_MS);
    assert.equal(peserta(1).cara_kumpul, 'waktu_habis');
    const sebelum = peserta(1).perpanjangan_ms;
    assert.equal(await aksi('perpanjang', { menit: -1, peserta_id: 1 }), 200);
    assert.equal(peserta(1).perpanjangan_ms, sebelum - MENIT);
    assert.equal(peserta(1).status, 'dikumpulkan', 'koreksi negatif tidak membuka kembali');
    assert.equal(await aksi('perpanjang', { menit: 0 }), 400);
    assert.equal(await aksi('perpanjang', { menit: 121 }), 400);
    assert.equal(await aksi('perpanjang', { menit: 1, peserta_id: 4 }), 404, 'peserta ujian lain');
    assert.equal(await aksi('akhiri'), 200);
    assert.equal(await aksi('perpanjang', { menit: 1 }), 409);
  });

  test('buka kembali siswa yang mengumpulkan sendiri: sisa waktunya menjadi minimal X menit', async () => {
    const ani = await masukSiswa(2);
    await aksi('mulai');
    a.majukanBerdetak(MENIT);
    await ani.k.minta('POST', '/api/peserta/kumpulkan', { headers: { 'x-tab-id': ani.tab }, body: { versi: {} } });
    assert.equal(await aksi('peserta/2/buka-kembali', { menit: 10 }), 200);
    assert.equal(peserta(2).status, 'mengerjakan');
    assert.equal(peserta(2).perpanjangan_ms, 0, 'sisa 89 menit sudah ≥ 10 menit');
    assert.equal(await aksi('peserta/2/buka-kembali', { menit: 10 }), 409, 'sudah mengerjakan');
    a.majukanBerdetak(DURASI_MS);
    assert.equal(peserta(2).cara_kumpul, 'waktu_habis');
    assert.equal(await aksi('peserta/2/buka-kembali', { menit: 10 }), 200);
    const p = (await pantau()).peserta.find((x) => x.id === 2);
    assert.equal(p?.sisa_ms, 10 * MENIT);
  });

  test('buka kunci semua (PIN tetap) & dicatat', async () => {
    a.db.prepare('UPDATE peserta SET pin_gagal = 5, terkunci_at = ? WHERE id IN (1, 2)').run(T0);
    const r = await guru.minta('POST', '/api/ujian/1/peserta/buka-kunci-semua');
    assert.deepEqual(BukaKunciSemuaHasilSchema.parse(r.body), { jumlah: 2 });
    assert.equal(a.db.prepare('SELECT COUNT(*) FROM peserta WHERE terkunci_at IS NOT NULL').pluck().get(), 0);
    assert.equal(a.db.prepare("SELECT COUNT(*) FROM log_aksi WHERE aksi = 'buka_kunci_semua'").pluck().get(), 1);
  });
});

describe('jawaban per siswa (guru)', () => {
  test('jawaban terkini + riwayat + event; hanya setelah Mulai dan hanya pemilik', async () => {
    const budi = await masukSiswa(1);
    assert.equal((await guru.minta('GET', '/api/ujian/1/peserta/1/jawaban')).status, 409, 'belum dimulai');
    await aksi('mulai');
    a.majukan(1000);
    await budi.k.minta('PUT', '/api/peserta/jawaban/11', {
      headers: { 'x-tab-id': budi.tab },
      body: { isi: 'Inflasi adalah kenaikan harga', ditandai: true, versi_dasar: 0, id_simpan: randomUUID() },
    });
    await budi.k.minta('POST', '/api/peserta/kumpulkan', { headers: { 'x-tab-id': budi.tab }, body: { versi: { 11: 1 } } });
    const r = await guru.minta('GET', '/api/ujian/1/peserta/1/jawaban');
    const j = JawabanGuruSchema.parse(r.body);
    assert.deepEqual(j.jawaban.map((x) => [x.soal_id, x.isi, x.versi, x.ditandai]), [[11, 'Inflasi adalah kenaikan harga', 1, true]]);
    // Simpanan pertama langsung tercatat di riwayat; potret "kumpul" untuk versi yang sama tidak ditulis dua kali.
    assert.deepEqual(j.riwayat.map((v) => [v.soal_id, v.versi, v.isi]), [[11, 1, 'Inflasi adalah kenaikan harga']]);
    assert.equal(j.peserta.status, 'dikumpulkan');
    assert.deepEqual(j.soal, [{ id: 11, urutan: 1, judul: 'Inflasi' }]);
    assert.equal((await guru.minta('GET', '/api/ujian/2/peserta/4/jawaban')).status, 404);
    assert.equal((await guru.minta('GET', '/api/ujian/1/peserta/4/jawaban')).status, 404);
  });
});

describe('perangkat dikenal guru', () => {
  test('daftar menandai perangkat ini; melupakannya menghapus cookie; perangkat guru lain tidak bisa dihapus', async () => {
    const r = await guru.minta('GET', '/api/penguji/masuk/perangkat');
    const daftar = DaftarPerangkatGuruSchema.parse(r.body);
    assert.equal(daftar.length, 1);
    assert.equal(daftar[0]?.ini, true);
    const lain = a.klien();
    await lain.minta('POST', '/api/penguji/masuk', { body: { username: 'guru2', password: PASSWORD_GURU } });
    const milikLain = DaftarPerangkatGuruSchema.parse((await lain.minta('GET', '/api/penguji/masuk/perangkat')).body)[0];
    assert.equal((await guru.minta('DELETE', `/api/penguji/masuk/perangkat/${milikLain?.id}`)).status, 404);
    assert.equal((await guru.minta('DELETE', `/api/penguji/masuk/perangkat/${daftar[0]?.id}`)).status, 204);
    assert.equal(guru.cookie.has('perangkat_guru'), false);
    assert.equal(DaftarPerangkatGuruSchema.parse((await guru.minta('GET', '/api/penguji/masuk/perangkat')).body).length, 0);
  });
});
