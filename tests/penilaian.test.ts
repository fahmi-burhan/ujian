// tests/penilaian.test.ts — penilaian manual (Fase 6): jawaban terlambat, mulai penilaian (jawaban kosong = 0),
// validasi skor terhadap rubrik, setujui per soal, rilis (syarat lengkap), nilai untuk siswa (hanya setelah
// rilis, termasuk kriteria & jawaban acuan), tarik rilis, dan unduhan CSV (BOM, ';', anti CSV injection).
// Dipanggil oleh: `npm test`. Memanggil: tests/bantuan.ts, server lewat HTTP sungguhan.
// Mengacu pada docs/DESAIN.md §3, §9, §12 (keputusan 22 Nov) dan aturan keras #1, #8, #10.
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { NilaiPesertaSchema, nilaiSoal, nilaiUjian, PenilaianGuruSchema, selCsv } from '../shared/nilai.ts';
import { isiDataAwal, mulaiAplikasiUji, PASSWORD_GURU, T0 } from './bantuan.ts';
import type { AplikasiUji, Klien } from './bantuan.ts';

let a: AplikasiUji;
let guru: Klien;

const RUBRIK_1 = {
  kriteria: [
    { id: 'k1', nama: 'Kelengkapan', bobot: 60, level: [{ skor: 0, deskriptor: 'tidak ada' }, { skor: 5, deskriptor: 'sebagian' }, { skor: 10, deskriptor: 'lengkap' }] },
    { id: 'k2', nama: 'Ketepatan', bobot: 40, level: [{ skor: 0, deskriptor: 'salah' }, { skor: 2, deskriptor: 'kurang' }, { skor: 4, deskriptor: 'tepat' }] },
  ],
  poin_wajib: [],
};
const RUBRIK_2 = {
  kriteria: [{ id: 'k1', nama: 'Menyebut rukun', bobot: 50, level: [{ skor: 0, deskriptor: 'tidak' }, { skor: 2, deskriptor: 'satu' }, { skor: 4, deskriptor: 'semua' }] }],
  poin_wajib: [],
};

async function masukGuru(): Promise<Klien> {
  const k = a.klien();
  assert.equal((await k.minta('POST', '/api/penguji/masuk', { body: { username: 'guru1', password: PASSWORD_GURU } })).status, 204);
  return k;
}

async function masukSiswa(id: number): Promise<Klien> {
  const k = a.klien();
  const r = await k.minta('POST', '/api/peserta/masuk', { body: { kode: 'ABC234', peserta_id: id, pin: '1234', pin_ulang: '1234' } });
  assert.equal(r.status, 204, JSON.stringify(r.body));
  return k;
}

const aksi = async (path: string, body?: unknown) => guru.minta('POST', `/api/ujian/1/${path}`, body === undefined ? {} : { body });
const nilaiPut = (pid: number, soal: number, skor: Record<string, number>, setujui = true, catatan = '') =>
  guru.minta('PUT', `/api/ujian/1/penilaian/${pid}/${soal}`, { body: { skor, catatan, setujui } });

beforeEach(async () => {
  a = await mulaiAplikasiUji();
  await isiDataAwal(a.db, 'berlangsung');
  const soal = a.db.prepare(
    `INSERT INTO soal (id, ujian_id, urutan, judul, teks, bobot, rubrik_json, jawaban_acuan, dibuat_at, diubah_at)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  soal.run(11, 1, 'Rukun wudhu', 'Sebutkan rukun wudhu', 3, JSON.stringify(RUBRIK_1), 'ACUAN-WUDHU', T0, T0);
  soal.run(12, 2, 'Rukun mandi', 'Sebutkan rukun mandi', 1, JSON.stringify(RUBRIK_2), 'ACUAN-MANDI', T0, T0);
  // Budi & Ani mengumpulkan; Cici tidak pernah masuk (tidak hadir).
  a.db
    .prepare(
      `UPDATE peserta SET status = 'dikumpulkan', cara_kumpul = 'diakhiri_penguji', masuk_pertama_at = ?, dikumpulkan_at = ?
       WHERE id IN (1, 2)`,
    )
    .run(T0, T0 + 1000);
  const jwb = a.db.prepare('INSERT INTO jawaban (ujian_id, peserta_id, soal_id, isi, versi, diubah_at) VALUES (1, ?, ?, ?, ?, ?)');
  jwb.run(1, 11, 'jawaban budi', 3, T0);
  jwb.run(1, 12, '   ', 1, T0);
  jwb.run(2, 11, 'jawaban ani', 2, T0);
  a.db
    .prepare(
      `INSERT INTO jawaban_terlambat (id, ujian_id, peserta_id, soal_id, isi, versi_dasar, id_simpan, diterima_at, alasan)
       VALUES (1, 1, 2, 12, 'niat dan meratakan air', 0, ?, ?, 'diakhiri')`,
    )
    .run(randomUUID(), T0 + 2000);
  a.db.prepare("UPDATE ujian SET status = 'selesai', diakhiri_at = ? WHERE id = 1").run(T0 + 1000);
  // Lewat toleransi 10 dtk setelah Akhiri (penilaian baru boleh dimulai setelahnya).
  a.majukan(20_000);
  guru = await masukGuru();
});
afterEach(() => a.berhenti());

describe('rumus nilai (DESAIN §9)', () => {
  test('nilai soal, nilai ujian, dan sel CSV aman', () => {
    assert.equal(nilaiSoal(RUBRIK_1, { k1: 5, k2: 4 }), 0.7);
    assert.equal(nilaiSoal(RUBRIK_2, { k1: 2 }), 0.5, 'satu kriteria berbobot 50 = 100% soal');
    assert.equal(nilaiSoal(RUBRIK_1, { k1: 5 }), null, 'skor tidak lengkap');
    assert.equal(nilaiUjian([{ nilai: 0.7, bobot: 3 }, { nilai: 0, bobot: 1 }]), 52.5);
    assert.equal(selCsv('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
    assert.equal(selCsv('-5'), "'-5");
    assert.equal(selCsv('Budi; Santoso'), '"Budi; Santoso"');
  });
});

describe('alur penilaian manual', () => {
  test('belum boleh dimulai selama toleransi 10 dtk setelah Akhiri (ketikan terakhir siswa masih bisa masuk)', async () => {
    await guru.minta('PATCH', '/api/ujian/1/terlambat/1', { body: { keputusan: 'ditolak' } });
    a.db.prepare('UPDATE ujian SET diakhiri_at = ? WHERE id = 1').run(T0 + 15_000);
    const r = await aksi('mulai-penilaian');
    assert.equal(r.status, 409);
    assert.match((r.body as { masalah: string[] }).masalah[0] ?? '', /Tunggu 7 detik/);
    a.majukan(7000);
    assert.equal((await aksi('mulai-penilaian')).status, 200);
    assert.equal((await aksi('mulai-penilaian')).status, 409);
  });

  test('terlambat wajib diputuskan dulu; diterima menjadi versi baru; jawaban kosong otomatis 0', async () => {
    const r = await aksi('mulai-penilaian');
    assert.equal(r.status, 409);
    assert.equal((r.body as { error: string }).error, 'belum_lengkap');
    assert.equal((await guru.minta('PATCH', '/api/ujian/1/terlambat/1', { body: { keputusan: 'diterima' } })).status, 204);
    assert.equal((await guru.minta('PATCH', '/api/ujian/1/terlambat/1', { body: { keputusan: 'ditolak' } })).status, 404, 'sudah diputuskan');
    const ani = a.db.prepare('SELECT isi, versi FROM jawaban WHERE peserta_id = 2 AND soal_id = 12').get() as { isi: string; versi: number };
    assert.deepEqual(ani, { isi: 'niat dan meratakan air', versi: 1 });
    assert.equal(a.db.prepare("SELECT COUNT(*) FROM jawaban_versi WHERE peserta_id = 2 AND alasan = 'terlambat'").pluck().get(), 1);

    const m = await aksi('mulai-penilaian');
    assert.equal(m.status, 200, JSON.stringify(m.body));
    const p = PenilaianGuruSchema.parse(m.body);
    assert.deepEqual(p.peserta.map((x) => x.nama), ['Ani', 'Budi']);
    assert.deepEqual(p.tidak_hadir.map((x) => x.nama), ['Cici']);
    assert.deepEqual(
      p.nilai.map((n) => [n.peserta_id, n.soal_id, n.sumber, n.status, n.skor]),
      [[1, 12, 'otomatis_kosong', 'disetujui', { k1: 0 }]],
    );
    assert.equal((await guru.minta('PATCH', '/api/ujian/1/terlambat/1', { body: { keputusan: 'ditolak' } })).status, 409, 'jawaban tidak berubah lagi saat penilaian');
  });

  test('skor divalidasi; rilis hanya bila lengkap; siswa melihat nilai + kriteria + acuan hanya setelah rilis', async () => {
    await guru.minta('PATCH', '/api/ujian/1/terlambat/1', { body: { keputusan: 'ditolak' } });
    assert.equal((await aksi('mulai-penilaian')).status, 200);
    // Ani tanpa jawaban soal 12 (terlambat ditolak) → 0 otomatis.
    assert.equal((await nilaiPut(1, 11, { k1: 5 })).status, 400, 'kriteria k2 belum diberi skor');
    assert.equal((await nilaiPut(1, 11, { k1: 3, k2: 4 })).status, 400, '3 bukan level');
    assert.equal((await nilaiPut(1, 11, { k1: 5, k2: 4, k9: 1 })).status, 400, 'kriteria tidak dikenal');
    assert.equal((await nilaiPut(3, 11, { k1: 5, k2: 4 })).status, 409, 'Cici tidak hadir');
    assert.equal((await nilaiPut(1, 11, { k1: 5, k2: 4 }, false, 'Sebut juga "hingga siku".')).status, 200);
    assert.equal((await nilaiPut(2, 11, { k1: 10, k2: 4 }, false)).status, 200);

    const budi = await masukSiswa(1);
    assert.equal((await budi.minta('GET', '/api/peserta/nilai')).status, 409, 'belum dirilis');

    const gagal = await aksi('rilis');
    assert.equal(gagal.status, 409);
    assert.deepEqual((gagal.body as { masalah: string[] }).masalah, ['Soal 1 "Rukun wudhu": 2 jawaban belum dinilai/disetujui']);
    const setujui = await aksi('penilaian/setujui/11');
    assert.deepEqual(setujui.body, { jumlah: 2 });
    assert.equal((await aksi('rilis')).status, 200);

    const n = NilaiPesertaSchema.parse((await budi.minta('GET', '/api/peserta/nilai')).body);
    assert.equal(n.nilai_akhir, 52.5);
    assert.deepEqual(n.soal.map((s) => [s.urutan, s.nilai_persen, s.porsi_persen, s.acuan, s.jawaban]), [
      [1, 70, 75, 'ACUAN-WUDHU', 'jawaban budi'],
      [2, 0, 25, 'ACUAN-MANDI', '   '],
    ]);
    assert.deepEqual(n.soal[0]?.kriteria, [
      { nama: 'Kelengkapan', bobot: 60, skor: 5, skor_maks: 10, deskriptor: 'sebagian' },
      { nama: 'Ketepatan', bobot: 40, skor: 4, skor_maks: 4, deskriptor: 'tepat' },
    ]);
    assert.equal(n.soal[0]?.catatan, 'Sebut juga "hingga siku".');
    assert.equal(JSON.stringify(n).includes('rubrik_json'), false);

    const cici = await masukSiswa(3);
    assert.deepEqual(NilaiPesertaSchema.parse((await cici.minta('GET', '/api/peserta/nilai')).body).hadir, false);

    // Tarik rilis: akses siswa tertutup lagi, skor boleh diubah lagi.
    assert.equal((await aksi('tarik-rilis')).status, 200);
    assert.equal((await budi.minta('GET', '/api/peserta/nilai')).status, 409);
    assert.equal((await nilaiPut(1, 11, { k1: 10, k2: 4 })).status, 200);
  });

  test('unduh CSV: BOM, pemisah ";", desimal koma, tidak hadir, belum dinilai, anti CSV injection; hanya pemilik', async () => {
    a.db.prepare("UPDATE peserta SET nama = '=HYPERLINK(\"http://x\")' WHERE id = 2").run();
    await guru.minta('PATCH', '/api/ujian/1/terlambat/1', { body: { keputusan: 'ditolak' } });
    assert.equal((await guru.minta('GET', '/api/ujian/1/nilai.csv')).status, 409, 'belum penilaian');
    await aksi('mulai-penilaian');
    await nilaiPut(1, 11, { k1: 5, k2: 4 });
    const r = await guru.minta('GET', '/api/ujian/1/nilai.csv');
    assert.equal(r.status, 200);
    assert.match(r.header.get('content-type') ?? '', /text\/csv/);
    assert.match(r.header.get('content-disposition') ?? '', /attachment/);
    // Byte mentah: response.text() di klien tes membuang BOM, jadi dicek langsung dari bytes.
    const mentah = new Uint8Array(
      await (await fetch(`${a.baseUrl}/api/ujian/1/nilai.csv`, { headers: { cookie: guru.headerCookie('/api/ujian/1/nilai.csv') ?? '' } })).arrayBuffer(),
    );
    assert.deepEqual([...mentah.slice(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM agar Excel membaca huruf dengan benar');
    const baris = String(r.body).trim().split('\r\n');
    assert.equal(baris[0], 'Nama;Nomor;Soal 1 Rukun wudhu (bobot 3);Soal 2 Rukun mandi (bobot 1);Nilai akhir (0-100)');
    assert.ok(baris.includes('Budi;01;70,0;0,0;52,5'));
    assert.ok(baris.includes('Cici;03;;;tidak hadir'));
    assert.ok(baris.includes(`"'=HYPERLINK(""http://x"")";02;belum dinilai;0,0;belum lengkap`));
    const lain = a.klien();
    await lain.minta('POST', '/api/penguji/masuk', { body: { username: 'guru2', password: PASSWORD_GURU } });
    assert.equal((await lain.minta('GET', '/api/ujian/1/nilai.csv')).status, 404);
  });
});
