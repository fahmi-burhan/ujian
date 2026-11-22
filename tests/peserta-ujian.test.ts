// tests/peserta-ujian.test.ts — alur siswa (Fase 4): ruang tunggu, Mulai, data ujian & daftar putih, PDF siswa,
// tab aktif, autosave berversi, aturan waktu, jeda (manual & otomatis), kumpul (manual, otomatis, Akhiri),
// dan aliran SSE.
// Dipanggil oleh: `npm test`. Memanggil: tests/bantuan.ts, server lewat HTTP sungguhan.
// Mengacu pada docs/DESAIN.md §3 (transisi), §4 (waktu), §5 (autosave & tab), §8 (endpoint), §8.1 (daftar putih).
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { KUNCI_TERLARANG_PESERTA, TOLERANSI_MS, UjianPesertaSchema } from '../shared/peserta.ts';
import type { UjianPeserta } from '../shared/peserta.ts';
import { UjianDetailSchema } from '../shared/ujian.ts';
import { hashRahasia } from '../server/auth/kata-sandi.ts';
import { isiDataAwal, mulaiAplikasiUji, PASSWORD_GURU, T0 } from './bantuan.ts';
import type { AplikasiUji, Klien } from './bantuan.ts';

let a: AplikasiUji;
let guru: Klien;

const DURASI_MS = 90 * 60_000;
const RUBRIK = JSON.stringify({
  kriteria: [{ id: 'k1', nama: 'Analisis', bobot: 1, level: [{ skor: 0, deskriptor: 'x' }, { skor: 2, deskriptor: 'y' }] }],
  poin_wajib: ['RAHASIA-POIN'],
});
const NAMA_PDF_1 = 'a'.repeat(32) + '.pdf';
const NAMA_PDF_2 = 'b'.repeat(32) + '.pdf';
const ISI_PDF = Buffer.from('%PDF-1.4\n% buku tiruan untuk tes siswa\n%%EOF\n');

function siapkanIsiUjian(): void {
  writeFileSync(join(a.uploadDir, NAMA_PDF_1), ISI_PDF);
  writeFileSync(join(a.uploadDir, NAMA_PDF_2), ISI_PDF);
  const pdf = a.db.prepare(
    'INSERT INTO pdf (id, ujian_id, nama_tampil, nama_berkas, ukuran_byte, sha256, diunggah_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  pdf.run(1, 1, 'Buku Ekonomi.pdf', NAMA_PDF_1, ISI_PDF.length, '0'.repeat(64), T0);
  pdf.run(2, 2, 'Buku Lain.pdf', NAMA_PDF_2, ISI_PDF.length, '0'.repeat(64), T0);
  const soal = a.db.prepare(
    `INSERT INTO soal (id, ujian_id, urutan, judul, teks, bobot, rubrik_json, jawaban_acuan, dibuat_at, diubah_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, 'RAHASIA-ACUAN', ?, ?)`,
  );
  soal.run(11, 1, 1, 'Inflasi', 'TEKS-SOAL-1 Jelaskan inflasi.', RUBRIK, T0, T0);
  soal.run(12, 1, 2, 'Deflasi', 'TEKS-SOAL-2 Jelaskan deflasi.', RUBRIK, T0, T0);
  soal.run(21, 2, 1, 'Soal guru lain', 'Teks lain', RUBRIK, T0, T0);
  a.db.prepare('INSERT INTO soal_rujukan (soal_id, ujian_id, urutan, pdf_id, halaman) VALUES (11, 1, 1, 1, 12)').run();
}

async function masukGuru(): Promise<Klien> {
  const k = a.klien();
  assert.equal((await k.minta('POST', '/api/penguji/masuk', { body: { username: 'guru1', password: PASSWORD_GURU } })).status, 204);
  return k;
}

type Siswa = { k: Klien; tab: string };

// Masuk (membuat PIN 1234 bila belum ada) lalu mengklaim tab, seperti halaman /ujian saat dimuat.
async function masukSiswa(pesertaId: number, k: Klien = a.klien()): Promise<Siswa> {
  const r = await k.minta('POST', '/api/peserta/masuk', {
    body: { kode: 'ABC234', peserta_id: pesertaId, pin: '1234', pin_ulang: '1234' },
  });
  assert.equal(r.status, 204, JSON.stringify(r.body));
  const tab = randomUUID();
  assert.equal((await k.minta('POST', '/api/peserta/tab', { body: { tab_id: tab } })).status, 204);
  return { k, tab };
}

async function ambilUjian(s: Siswa): Promise<UjianPeserta> {
  const r = await s.k.minta('GET', '/api/peserta/ujian');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return UjianPesertaSchema.parse(r.body);
}

type Kiriman = { isi?: string; ditandai?: boolean; versi_dasar?: number; id_simpan?: string; konflik?: boolean };
function simpan(s: Siswa, soalId: number, kiriman: Kiriman = {}, tab = s.tab) {
  return s.k.minta('PUT', `/api/peserta/jawaban/${soalId}`, {
    headers: { 'x-tab-id': tab },
    body: { isi: 'jawaban', ditandai: false, versi_dasar: 0, id_simpan: randomUUID(), ...kiriman },
  });
}

async function aksiGuru(aksi: string, ujianId = 1): Promise<number> {
  return (await guru.minta('POST', `/api/ujian/${ujianId}/${aksi}`)).status;
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

function statusPeserta(id: number): { status: string; cara_kumpul: string | null } {
  return a.db.prepare('SELECT status, cara_kumpul FROM peserta WHERE id = ?').get(id) as {
    status: string;
    cara_kumpul: string | null;
  };
}

beforeEach(async () => {
  a = await mulaiAplikasiUji();
  await isiDataAwal(a.db, 'menunggu');
  siapkanIsiUjian();
  guru = await masukGuru();
});
afterEach(() => a.berhenti());

describe('ruang tunggu & Mulai', () => {
  test('ruang tunggu: info umum + PDF, tanpa soal/rujukan soal/jawaban, tanpa kunci terlarang', async () => {
    const s = await masukSiswa(1);
    const u = await ambilUjian(s);
    assert.equal(u.status, 'menunggu');
    assert.equal(u.jumlah_soal, 2);
    assert.deepEqual(u.pdf, [{ id: 1, nama_tampil: 'Buku Ekonomi.pdf' }]);
    assert.equal(u.soal, undefined);
    assert.equal(u.jawaban, undefined);
    assert.deepEqual(u.waktu, { sisa_ms: DURASI_MS, jam_server: T0, dijeda: false });
    assert.deepEqual(u.saya, { id: 1, nama: 'Budi', status: 'menunggu', cara_kumpul: null });
    const teks = JSON.stringify(u);
    assert.doesNotMatch(teks, /TEKS-SOAL|RAHASIA|Inflasi|rujukan|halaman/);
  });

  test('Mulai: siswa di ruang tunggu mengerjakan; soal terkirim tanpa rubrik/acuan; yang belum masuk tetap belum masuk', async () => {
    const s = await masukSiswa(1);
    assert.equal(await aksiGuru('mulai'), 200);
    assert.equal(statusPeserta(1).status, 'mengerjakan');
    assert.equal(statusPeserta(2).status, 'belum_masuk');
    const u = await ambilUjian(s);
    assert.equal(u.status, 'berlangsung');
    assert.deepEqual(
      u.soal?.map((x) => [x.id, x.rujukan]),
      [
        [11, [{ pdf_id: 1, halaman: 12 }]],
        [12, []],
      ],
    );
    assert.deepEqual(u.jawaban, []);
    for (const kunci of KUNCI_TERLARANG_PESERTA) assert.ok(!semuaKunci(u).has(kunci), kunci);
    assert.doesNotMatch(JSON.stringify(u), /RAHASIA/);
    // Detail guru membawa sisa waktu global.
    const detail = UjianDetailSchema.parse((await guru.minta('GET', '/api/ujian/1')).body);
    assert.deepEqual(detail.waktu, { sisa_ms: DURASI_MS, jam_server: T0, dijeda: false });
  });

  test('siswa yang masuk terlambat langsung mengerjakan dengan SISA waktu global', async () => {
    assert.equal(await aksiGuru('mulai'), 200);
    a.majukanBerdetak(30 * 60_000);
    const s = await masukSiswa(2);
    assert.equal(statusPeserta(2).status, 'mengerjakan');
    assert.equal((await ambilUjian(s)).waktu.sisa_ms, DURASI_MS - 30 * 60_000);
  });

  test('Mulai ditekan saat PIN siswa masih dicek (antre scrypt) → siswa tetap mengerjakan, tidak terjebak menunggu', async () => {
    // Dua hash "penghalang" memenuhi jatah scrypt, sehingga login siswa antre di belakangnya.
    const penghalang = [hashRahasia('penghalang-1'), hashRahasia('penghalang-2')];
    const login = a.klien().minta('POST', '/api/peserta/masuk', {
      body: { kode: 'ABC234', peserta_id: 2, pin: '1234', pin_ulang: '1234' },
    });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(await aksiGuru('mulai'), 200);
    assert.equal((await login).status, 204);
    await Promise.all(penghalang);
    assert.equal(statusPeserta(2).status, 'mengerjakan');
  });

  test('transisi dijaga: Mulai dua kali / Jeda dari ruang tunggu → 409; ujian guru lain → 404; sesi siswa → 401', async () => {
    assert.equal(await aksiGuru('jeda'), 409);
    assert.equal(await aksiGuru('lanjutkan'), 409);
    assert.equal(await aksiGuru('akhiri'), 409);
    const [r1, r2] = await Promise.all([guru.minta('POST', '/api/ujian/1/mulai'), guru.minta('POST', '/api/ujian/1/mulai')]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
    assert.equal(await aksiGuru('mulai', 2), 404);
    const s = await masukSiswa(1);
    assert.equal((await s.k.minta('POST', '/api/ujian/1/jeda')).status, 401);
  });

  test('ujian ditutup kembali (draf): data ujian ditolak, tapi tab & aliran tetap jalan dengan status saja', async () => {
    const s = await masukSiswa(1);
    assert.equal(await aksiGuru('kembali-draf'), 200);
    assert.equal((await s.k.minta('GET', '/api/peserta/ujian')).status, 409);
    assert.equal((await s.k.minta('POST', '/api/peserta/tab', { body: { tab_id: s.tab } })).status, 204);
    const aliran = await s.k.aliran(`/api/peserta/stream?tab=${s.tab}`);
    assert.equal(aliran.status, 200);
    assert.deepEqual(await aliran.tunggu('status'), { status: 'draf' });
    // Guru membuka lagi → siswa diberi tahu tanpa masuk ulang.
    assert.equal(await aksiGuru('buka'), 200);
    assert.deepEqual(await aliran.tunggu('status', 2), { status: 'menunggu' });
    assert.ok(!aliran.event.slice(0, 1).some((e) => e.event === 'waktu'), 'saat draf tidak ada event waktu');
    aliran.tutup();
  });

  test('guru menghapus nama siswa saat draf → aliran siswa diberi tahu lalu ditutup', async () => {
    const s = await masukSiswa(1);
    assert.equal(await aksiGuru('kembali-draf'), 200);
    const aliran = await s.k.aliran(`/api/peserta/stream?tab=${s.tab}`);
    await aliran.tunggu('status');
    assert.equal((await guru.minta('DELETE', '/api/ujian/1/peserta/1')).status, 204);
    assert.deepEqual(await aliran.tunggu('sesi_dicabut'), { alasan: 'dihapus_penguji' });
    await aliran.berakhir();
  });
});

describe('PDF untuk siswa', () => {
  test('boleh sejak ruang tunggu, mendukung Range; PDF ujian lain 404; setelah selesai 409', async () => {
    const s = await masukSiswa(1);
    const utuh = await fetch(`${a.baseUrl}/api/peserta/pdf/1`, { headers: { cookie: s.k.headerCookie('/') ?? '' } });
    assert.equal(utuh.status, 200);
    assert.equal(utuh.headers.get('content-type'), 'application/pdf');
    assert.deepEqual(Buffer.from(await utuh.arrayBuffer()), ISI_PDF);
    const sebagian = await fetch(`${a.baseUrl}/api/peserta/pdf/1`, {
      headers: { cookie: s.k.headerCookie('/') ?? '', range: 'bytes=0-4' },
    });
    assert.equal(sebagian.status, 206);
    assert.equal(await sebagian.text(), '%PDF-');
    assert.equal((await s.k.minta('GET', '/api/peserta/pdf/2')).status, 404);
    assert.equal((await a.klien().minta('GET', '/api/peserta/pdf/1')).status, 401);
    assert.equal((await guru.minta('GET', '/api/peserta/pdf/1')).status, 401);
    await aksiGuru('mulai');
    assert.equal((await s.k.minta('GET', '/api/peserta/pdf/1')).status, 200);
    await aksiGuru('akhiri');
    assert.equal((await s.k.minta('GET', '/api/peserta/pdf/1')).status, 409);
  });
});

describe('simpan jawaban', () => {
  test('sebelum Mulai → 409 belum_mulai + satu event per menit untuk guru (soal tidak dicek dulu)', async () => {
    const s = await masukSiswa(1);
    assert.equal((await simpan(s, 11)).status, 409);
    assert.equal((await simpan(s, 999)).status, 409);
    const jumlah = () =>
      a.db.prepare("SELECT COUNT(*) FROM event_integritas WHERE jenis = 'akses_sebelum_mulai'").pluck().get() as number;
    assert.equal(jumlah(), 1);
    a.majukan(61_000);
    assert.deepEqual((await simpan(s, 11)).body, { error: 'belum_mulai' });
    assert.deepEqual((await simpan(s, 11)).body, { error: 'belum_mulai' });
    assert.equal(jumlah(), 2);
  });

  test('soal ujian lain → 404; tab bukan tab aktif → 409 tab_tidak_aktif', async () => {
    const s = await masukSiswa(1);
    await aksiGuru('mulai');
    assert.equal((await simpan(s, 21)).status, 404);
    const r = await simpan(s, 11, {}, randomUUID());
    assert.equal(r.status, 409);
    assert.deepEqual(r.body, { error: 'tab_tidak_aktif' });
  });

  test('versi naik; kiriman ulang (id sama) & isi sama tidak menyimpan dua kali; versi basi → versi_bentrok + teks server', async () => {
    const s = await masukSiswa(1);
    await aksiGuru('mulai');
    const id1 = randomUUID();
    const r1 = await simpan(s, 11, { isi: 'satu', id_simpan: id1 });
    assert.deepEqual(r1.body, { versi: 1, disimpan_at: T0 });
    assert.deepEqual((await simpan(s, 11, { isi: 'satu', id_simpan: id1 })).body, { versi: 1, disimpan_at: T0 });
    a.majukan(1000);
    assert.equal(((await simpan(s, 11, { isi: 'dua', versi_dasar: 1 })).body as { versi: number }).versi, 2);
    // Isi + tanda sama persis dengan yang tersimpan → sukses dengan versi saat ini, walau versi_dasar basi.
    assert.equal(((await simpan(s, 11, { isi: 'dua', versi_dasar: 0 })).body as { versi: number }).versi, 2);
    const bentrok = await simpan(s, 11, { isi: 'tiga', versi_dasar: 1 });
    assert.equal(bentrok.status, 409);
    assert.deepEqual(bentrok.body, { error: 'versi_bentrok', versi: 2, isi: 'dua', ditandai: false });
    // Tanda "ragu" ikut tersimpan sebagai perubahan.
    assert.equal(((await simpan(s, 11, { isi: 'dua', ditandai: true, versi_dasar: 2 })).body as { versi: number }).versi, 3);
    const u = await ambilUjian(s);
    assert.deepEqual(u.jawaban, [{ soal_id: 11, isi: 'dua', versi: 3, ditandai: true }]);
  });

  test('riwayat: maks 1 per 30 dtk per soal; pilihan saat bentrok dicatat "konflik"', async () => {
    const s = await masukSiswa(1);
    await aksiGuru('mulai');
    const riwayat = () =>
      a.db.prepare('SELECT versi, alasan FROM jawaban_versi WHERE peserta_id = 1 AND soal_id = 11 ORDER BY versi').all();
    await simpan(s, 11, { isi: 'a' });
    a.majukan(10_000);
    await simpan(s, 11, { isi: 'ab', versi_dasar: 1 });
    a.majukan(25_000);
    await simpan(s, 11, { isi: 'abc', versi_dasar: 2 });
    a.majukan(1000);
    await simpan(s, 11, { isi: 'pilihan', versi_dasar: 3, konflik: true });
    assert.deepEqual(riwayat(), [
      { versi: 1, alasan: 'berkala' },
      { versi: 3, alasan: 'berkala' },
      { versi: 4, alasan: 'konflik' },
    ]);
  });

  test('waktu habis: diterima sampai +10 dtk; sesudahnya disimpan sebagai jawaban terlambat (idempoten)', async () => {
    const s = await masukSiswa(1);
    await aksiGuru('mulai');
    // Jam dimajukan tanpa pengecek: siswa masih "mengerjakan", jadi yang diuji murni aturan waktu.
    a.majukan(DURASI_MS + TOLERANSI_MS);
    assert.equal((await simpan(s, 11, { isi: 'tepat waktu' })).status, 200);
    a.majukan(1);
    const id = randomUUID();
    const r = await simpan(s, 11, { isi: 'telat', versi_dasar: 1, id_simpan: id });
    assert.equal(r.status, 202);
    assert.deepEqual(r.body, { terlambat: true });
    assert.equal((await simpan(s, 11, { isi: 'telat', versi_dasar: 1, id_simpan: id })).status, 202);
    const terlambat = a.db.prepare('SELECT isi, alasan, keputusan FROM jawaban_terlambat').all();
    assert.deepEqual(terlambat, [{ isi: 'telat', alasan: 'waktu_habis', keputusan: 'menunggu' }]);
    // Jawaban resmi tidak berubah.
    assert.equal(a.db.prepare('SELECT isi FROM jawaban WHERE soal_id = 11').pluck().get(), 'tepat waktu');
  });
});

describe('jeda', () => {
  test('jeda guru: waktu membeku, simpanan diterima 10 dtk lalu 409 dijeda; lanjutkan → waktu jalan lagi', async () => {
    const s = await masukSiswa(1);
    await aksiGuru('mulai');
    a.majukanBerdetak(60_000);
    assert.equal(await aksiGuru('jeda'), 200);
    a.majukanBerdetak(TOLERANSI_MS);
    assert.equal((await simpan(s, 11, { isi: 'masih masuk' })).status, 200);
    a.majukanBerdetak(5 * 60_000);
    const r = await simpan(s, 11, { isi: 'saat jeda', versi_dasar: 1 });
    assert.equal(r.status, 409);
    assert.deepEqual(r.body, { error: 'dijeda' });
    const u = await ambilUjian(s);
    assert.equal(u.waktu.dijeda, true);
    assert.equal(u.waktu.sisa_ms, DURASI_MS - 60_000);
    assert.ok(u.soal && u.soal.length === 2, 'soal tetap terlihat saat dijeda');
    assert.equal(await aksiGuru('lanjutkan'), 200);
    assert.equal((await simpan(s, 11, { isi: 'saat jeda', versi_dasar: 1 })).status, 200);
    a.majukanBerdetak(60_000);
    assert.equal((await ambilUjian(s)).waktu.sisa_ms, DURASI_MS - 2 * 60_000);
  });

  test('server sempat mati > 15 dtk → dijeda otomatis sejak detak terakhir, tanpa kumpul massal; tercatat di log', async () => {
    await masukSiswa(1);
    await aksiGuru('mulai');
    a.majukanBerdetak(10 * 60_000);
    const detakTerakhir = a.db.prepare('SELECT detak_at FROM ujian WHERE id = 1').pluck().get() as number;
    // "Server mati" 3 jam (lebih lama dari durasi 90 menit), lalu pengecek pertama setelah hidup.
    a.majukan(3 * 60 * 60_000);
    a.pengecek();
    const u = a.db.prepare('SELECT status, dijeda_at FROM ujian WHERE id = 1').get();
    assert.deepEqual(u, { status: 'dijeda', dijeda_at: detakTerakhir });
    assert.equal(statusPeserta(1).status, 'mengerjakan');
    const log = a.db.prepare("SELECT aktor, aksi FROM log_aksi WHERE aksi = 'jeda_otomatis'").all();
    assert.deepEqual(log, [{ aktor: 'server', aksi: 'jeda_otomatis' }]);
    // Sisa waktu siswa tidak termakan selama server mati.
    const detail = UjianDetailSchema.parse((await guru.minta('GET', '/api/ujian/1')).body);
    assert.ok((detail.waktu?.sisa_ms ?? 0) > DURASI_MS - 11 * 60_000);
  });
});

describe('kumpul', () => {
  test('Kumpulkan: versi harus cocok; berhasil → dikumpulkan (manual) + riwayat "kumpul"; ulang → 204; simpan sesudahnya terlambat', async () => {
    const s = await masukSiswa(1);
    await aksiGuru('mulai');
    await simpan(s, 11, { isi: 'final' });
    const kumpul = (versi: Record<string, number>, tab = s.tab) =>
      s.k.minta('POST', '/api/peserta/kumpulkan', { headers: { 'x-tab-id': tab }, body: { versi } });
    assert.deepEqual((await kumpul({})).body, { error: 'belum_tersimpan' });
    assert.deepEqual((await kumpul({ 11: 1 }, randomUUID())).body, { error: 'tab_tidak_aktif' });
    assert.equal((await kumpul({ 11: 1 })).status, 204);
    assert.deepEqual(statusPeserta(1), { status: 'dikumpulkan', cara_kumpul: 'manual' });
    assert.deepEqual(
      a.db.prepare('SELECT versi, alasan FROM jawaban_versi WHERE peserta_id = 1 ORDER BY id').all(),
      [
        { versi: 1, alasan: 'berkala' },
      ],
      'versi 1 sudah ada di riwayat (berkala), jadi potret kumpul tidak menggandakannya',
    );
    assert.equal((await kumpul({ 11: 1 })).status, 204);
    const r = await simpan(s, 11, { isi: 'ubah lagi', versi_dasar: 1 });
    assert.equal(r.status, 202);
    assert.equal(a.db.prepare('SELECT alasan FROM jawaban_terlambat').pluck().get(), 'sudah_dikumpulkan');
  });

  test('kumpul otomatis: hanya setelah waktu habis + 10 dtk; riwayat "kumpul" berisi jawaban terakhir', async () => {
    const s = await masukSiswa(1);
    await aksiGuru('mulai');
    await simpan(s, 11, { isi: 'awal' });
    a.majukanBerdetak(5000);
    await simpan(s, 11, { isi: 'akhir', versi_dasar: 1 });
    a.majukanBerdetak(DURASI_MS - 5000 + TOLERANSI_MS - 1000);
    assert.equal(statusPeserta(1).status, 'mengerjakan');
    a.majukanBerdetak(1000);
    assert.deepEqual(statusPeserta(1), { status: 'dikumpulkan', cara_kumpul: 'waktu_habis' });
    assert.deepEqual(
      a.db.prepare("SELECT versi, isi FROM jawaban_versi WHERE peserta_id = 1 AND alasan = 'kumpul'").all(),
      [{ versi: 2, isi: 'akhir' }],
    );
    // Ujian tidak pernah diakhiri otomatis (K2).
    assert.equal(a.db.prepare('SELECT status FROM ujian WHERE id = 1').pluck().get(), 'berlangsung');
  });

  test('Akhiri: yang mengerjakan dikumpulkan; simpanan dalam 10 dtk masih masuk; sesudahnya terlambat; jawaban tetap terlihat tanpa soal', async () => {
    const s = await masukSiswa(1);
    await masukSiswa(2);
    await aksiGuru('mulai');
    await simpan(s, 11, { isi: 'hampir' });
    a.majukanBerdetak(60_000);
    assert.equal(await aksiGuru('akhiri'), 200);
    assert.deepEqual(statusPeserta(1), { status: 'dikumpulkan', cara_kumpul: 'diakhiri_penguji' });
    assert.equal(statusPeserta(3).status, 'belum_masuk');
    a.majukan(5000);
    assert.equal((await simpan(s, 11, { isi: 'hampir selesai', versi_dasar: 1 })).status, 200);
    assert.equal(
      a.db.prepare("SELECT alasan FROM jawaban_versi WHERE peserta_id = 1 AND versi = 2").pluck().get(),
      'kumpul',
    );
    a.majukan(TOLERANSI_MS);
    assert.equal((await simpan(s, 11, { isi: 'telat', versi_dasar: 2 })).status, 202);
    assert.equal(a.db.prepare('SELECT alasan FROM jawaban_terlambat').pluck().get(), 'diakhiri');
    const u = await ambilUjian(s);
    assert.equal(u.status, 'selesai');
    assert.equal(u.soal, undefined);
    assert.deepEqual(u.jawaban, [{ soal_id: 11, isi: 'hampir selesai', versi: 2, ditandai: false }]);
  });
});

describe('tab aktif & aliran SSE', () => {
  test('aliran: header anti-buffer nginx, status + waktu saat tersambung, status saat guru Mulai', async () => {
    const s = await masukSiswa(1);
    const aliran = await s.k.aliran(`/api/peserta/stream?tab=${s.tab}`);
    assert.equal(aliran.status, 200);
    assert.equal(aliran.header.get('x-accel-buffering'), 'no');
    assert.match(aliran.header.get('content-type') ?? '', /^text\/event-stream/);
    assert.deepEqual(await aliran.tunggu('status'), { status: 'menunggu' });
    assert.deepEqual(await aliran.tunggu('waktu'), { sisa_ms: DURASI_MS, jam_server: T0, dijeda: false });
    await aksiGuru('mulai');
    assert.deepEqual(await aliran.tunggu('status', 2), { status: 'berlangsung' });
    aliran.tutup();
  });

  test('tab baru mengklaim → tab lama diberi tahu & ditutup, simpanannya ditolak; aliran tab lama → tab_lain_aktif', async () => {
    const s = await masukSiswa(1);
    await aksiGuru('mulai');
    const lama = await s.k.aliran(`/api/peserta/stream?tab=${s.tab}`);
    await lama.tunggu('status');
    const tabBaru = randomUUID();
    assert.equal((await s.k.minta('POST', '/api/peserta/tab', { body: { tab_id: tabBaru } })).status, 204);
    assert.deepEqual(await lama.tunggu('tab_lain_aktif'), {});
    await lama.berakhir();
    assert.equal((await simpan(s, 11)).status, 409);
    assert.equal((await simpan(s, 11, {}, tabBaru)).status, 200);
    const ulang = await s.k.aliran(`/api/peserta/stream?tab=${s.tab}`);
    assert.deepEqual(await ulang.tunggu('tab_lain_aktif'), {});
    await ulang.berakhir();
  });

  test('masuk dari laptop lain / Reset PIN → aliran lama menerima sesi_dicabut lalu ditutup', async () => {
    const s = await masukSiswa(1);
    const a1 = await s.k.aliran(`/api/peserta/stream?tab=${s.tab}`);
    await a1.tunggu('status');
    const lain = await masukSiswa(1);
    assert.deepEqual(await a1.tunggu('sesi_dicabut'), { alasan: 'diambil_alih' });
    await a1.berakhir();
    const a2 = await lain.k.aliran(`/api/peserta/stream?tab=${lain.tab}`);
    await a2.tunggu('status');
    assert.equal((await guru.minta('POST', '/api/ujian/1/peserta/1/reset-pin')).status, 204);
    assert.deepEqual(await a2.tunggu('sesi_dicabut'), { alasan: 'direset_penguji' });
    await a2.berakhir();
    // Sesi yang dicabut tidak bisa membuka aliran lagi.
    assert.equal((await lain.k.minta('GET', `/api/peserta/stream?tab=${lain.tab}`)).status, 401);
  });

  test('kumpul otomatis memberi tahu siswa lewat event status', async () => {
    const s = await masukSiswa(1);
    await aksiGuru('mulai');
    const aliran = await s.k.aliran(`/api/peserta/stream?tab=${s.tab}`);
    await aliran.tunggu('status');
    a.majukanBerdetak(DURASI_MS + TOLERANSI_MS);
    await aliran.tunggu('status', 2);
    assert.equal((await ambilUjian(s)).saya.status, 'dikumpulkan');
    aliran.tutup();
  });
});
