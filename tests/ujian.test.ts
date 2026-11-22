// tests/ujian.test.ts — penyusunan ujian oleh guru (Fase 3): ujian, soal & rubrik, PDF, peserta, buka/kembali.
// Dipanggil oleh: `npm test`. Memanggil: tests/bantuan.ts, server lewat HTTP sungguhan.
// Mengacu pada docs/DESAIN.md §3 (transisi), §8 (endpoint), §9 (rubrik).
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { POLA_KODE_UJIAN } from '../shared/alfabet.ts';
import {
  DaftarPesertaGuruSchema,
  DaftarUjianSchema,
  ImporHasilSchema,
  PdfInfoSchema,
  SoalGuruSchema,
  UjianDetailSchema,
} from '../shared/ujian.ts';
import type { SoalInput, UjianDetail } from '../shared/ujian.ts';
import { isiDataAwal, mulaiAplikasiUji, PASSWORD_GURU } from './bantuan.ts';
import type { AplikasiUji, Klien } from './bantuan.ts';

let a: AplikasiUji;
let guru: Klien;

const RUBRIK = {
  kriteria: [
    {
      id: 'k1',
      nama: 'Analisis',
      bobot: 40,
      level: [
        { skor: 0, deskriptor: 'Tidak ada analisis' },
        { skor: 2, deskriptor: 'Sebagian' },
        { skor: 4, deskriptor: 'Lengkap dan tepat' },
      ],
    },
  ],
  poin_wajib: ['Menyebut definisi inflasi'],
};
const SOAL: SoalInput = {
  judul: 'Inflasi',
  teks: 'Jelaskan penyebab inflasi.',
  bobot: 2,
  rubrik: RUBRIK,
  jawaban_acuan: 'Inflasi disebabkan oleh ...',
};
const PDF_PALSU = new TextEncoder().encode('%PDF-1.4\n% isi tiruan untuk tes\n%%EOF\n');

async function masuk(username = 'guru1'): Promise<Klien> {
  const k = a.klien();
  const r = await k.minta('POST', '/api/penguji/masuk', { body: { username, password: PASSWORD_GURU } });
  assert.equal(r.status, 204);
  return k;
}

async function ujianBaru(judul = 'Latihan Inflasi'): Promise<UjianDetail> {
  const r = await guru.minta('POST', '/api/ujian', { body: { judul, durasi_menit: 90 } });
  assert.equal(r.status, 201);
  return UjianDetailSchema.parse(r.body);
}

async function siapkanLengkap(id: number): Promise<void> {
  assert.equal((await guru.minta('POST', `/api/ujian/${id}/soal`, { body: SOAL })).status, 201);
  assert.equal((await guru.minta('POST', `/api/ujian/${id}/peserta`, { body: { nama: 'Budi' } })).status, 201);
}

beforeEach(async () => {
  a = await mulaiAplikasiUji();
  await isiDataAwal(a.db, 'draf');
  guru = await masuk();
});
afterEach(() => a.berhenti());

describe('ujian', () => {
  test('membuat ujian: kode 6 karakter unik dibuat server, status draf, muncul di daftar', async () => {
    const u = await ujianBaru();
    assert.match(u.kode, POLA_KODE_UJIAN);
    assert.deepEqual([u.status, u.durasi_menit, u.soal, u.pdf, u.jumlah_peserta], ['draf', 90, [], [], 0]);
    const daftar = DaftarUjianSchema.parse((await guru.minta('GET', '/api/ujian')).body);
    assert.equal(daftar[0]?.id, u.id, 'yang terbaru di atas');
    assert.ok(daftar.every((d) => d.id !== 2), 'ujian guru lain tidak ikut');
  });

  test('judul kosong / durasi di luar 1–600 ditolak', async () => {
    for (const body of [{ judul: '  ', durasi_menit: 60 }, { judul: 'X', durasi_menit: 0 }, { judul: 'X', durasi_menit: 601 }]) {
      assert.equal((await guru.minta('POST', '/api/ujian', { body })).status, 400, JSON.stringify(body));
    }
  });

  test('ujian guru lain → 404; tanpa sesi guru (mis. sesi siswa) → 401', async () => {
    assert.equal((await guru.minta('GET', '/api/ujian/2')).status, 404);
    assert.equal((await guru.minta('PATCH', '/api/ujian/2', { body: { judul: 'Ambil alih' } })).status, 404);
    assert.equal((await guru.minta('DELETE', '/api/ujian/2')).status, 404);
    assert.equal((await a.klien().minta('GET', '/api/ujian')).status, 401);
  });

  test('ubah info hanya saat draf; mode tampil boleh kapan saja', async () => {
    const u = await ujianBaru();
    const r = await guru.minta('PATCH', `/api/ujian/${u.id}`, { body: { petunjuk: 'Boleh membuka buku.', durasi_menit: 60 } });
    assert.deepEqual(
      [UjianDetailSchema.parse(r.body).petunjuk, UjianDetailSchema.parse(r.body).durasi_menit],
      ['Boleh membuka buku.', 60],
    );
    assert.equal((await guru.minta('PATCH', `/api/ujian/${u.id}`, { body: {} })).status, 400);
    await siapkanLengkap(u.id);
    assert.equal((await guru.minta('POST', `/api/ujian/${u.id}/buka`)).status, 200);
    const terkunci = await guru.minta('PATCH', `/api/ujian/${u.id}`, { body: { judul: 'Baru' } });
    assert.deepEqual([terkunci.status, terkunci.body], [409, { error: 'status_tidak_sesuai' }]);
    const tampil = await guru.minta('PATCH', `/api/ujian/${u.id}/tampilan`, { body: { mode_tampil: 'inisial' } });
    assert.equal(UjianDetailSchema.parse(tampil.body).mode_tampil, 'inisial');
  });
});

describe('soal & rubrik', () => {
  test('tambah, ubah, atur urutan, hapus (urutan dirapikan)', async () => {
    const u = await ujianBaru();
    const s1 = SoalGuruSchema.parse((await guru.minta('POST', `/api/ujian/${u.id}/soal`, { body: SOAL })).body);
    const s2 = SoalGuruSchema.parse((await guru.minta('POST', `/api/ujian/${u.id}/soal`, { body: { ...SOAL, judul: 'Deflasi' } })).body);
    const s3 = SoalGuruSchema.parse((await guru.minta('POST', `/api/ujian/${u.id}/soal`, { body: { ...SOAL, judul: 'Moneter' } })).body);
    assert.deepEqual([s1.urutan, s2.urutan, s3.urutan], [1, 2, 3]);
    assert.deepEqual(s1.rubrik, RUBRIK);

    const ubah = await guru.minta('PATCH', `/api/ujian/${u.id}/soal/${s2.id}`, { body: { ...SOAL, judul: 'Deflasi (ubah)', bobot: 5 } });
    assert.deepEqual([SoalGuruSchema.parse(ubah.body).judul, SoalGuruSchema.parse(ubah.body).bobot], ['Deflasi (ubah)', 5]);

    assert.equal((await guru.minta('PUT', `/api/ujian/${u.id}/soal/urutan`, { body: { ids: [s3.id, s1.id, s2.id] } })).status, 204);
    const urut = async (): Promise<string[]> =>
      UjianDetailSchema.parse((await guru.minta('GET', `/api/ujian/${u.id}`)).body).soal.map((s) => `${s.urutan}:${s.judul}`);
    assert.deepEqual(await urut(), ['1:Moneter', '2:Inflasi', '3:Deflasi (ubah)']);
    for (const ids of [[s3.id, s1.id], [s3.id, s1.id, s2.id, s2.id], [s3.id, s1.id, 9999]]) {
      assert.equal((await guru.minta('PUT', `/api/ujian/${u.id}/soal/urutan`, { body: { ids } })).status, 400, 'harus persis semua soal');
    }

    assert.equal((await guru.minta('DELETE', `/api/ujian/${u.id}/soal/${s3.id}`)).status, 204);
    assert.deepEqual(await urut(), ['1:Inflasi', '2:Deflasi (ubah)']);
  });

  test('rubrik setengah jadi boleh disimpan; bentuk yang salah ditolak', async () => {
    const u = await ujianBaru();
    const setengah = { ...SOAL, teks: '', jawaban_acuan: '', rubrik: { kriteria: [{ id: 'k1', nama: '', bobot: 10, level: [] }], poin_wajib: [] } };
    assert.equal((await guru.minta('POST', `/api/ujian/${u.id}/soal`, { body: setengah })).status, 201);
    const salah = [
      { ...SOAL, rubrik: { ...RUBRIK, rahasia: 1 } },
      { ...SOAL, rubrik: { kriteria: Array.from({ length: 11 }, (_, i) => ({ ...RUBRIK.kriteria[0], id: `k${i}` })), poin_wajib: [] } },
      { ...SOAL, rubrik: { kriteria: [{ ...RUBRIK.kriteria[0], level: [{ skor: 11, deskriptor: 'x' }] }], poin_wajib: [] } },
      { ...SOAL, rujukan: [{ pdf_id: 1 }] },
      { ...SOAL, rujukan: Array.from({ length: 6 }, (_, i) => ({ pdf_id: 1, halaman: i + 1 })) },
      { ...SOAL, rujukan: [{ pdf_id: 1, halaman: 3 }, { pdf_id: 1, halaman: 3 }] },
      { ...SOAL, rujukan: [{ pdf_id: 1, halaman: 0 }] },
      { ...SOAL, judul: '' },
    ];
    for (const body of salah) assert.equal((await guru.minta('POST', `/api/ujian/${u.id}/soal`, { body })).status, 400);
  });

  test('poin wajib yang kosong dibuang saat disimpan', async () => {
    const u = await ujianBaru();
    const r = await guru.minta('POST', `/api/ujian/${u.id}/soal`, {
      body: { ...SOAL, rubrik: { ...RUBRIK, poin_wajib: ['', 'Definisi', '   '] } },
    });
    assert.deepEqual(SoalGuruSchema.parse(r.body).rubrik.poin_wajib, ['Definisi']);
  });

  test('PDF rujukan harus milik ujian yang sama', async () => {
    const u = await ujianBaru();
    a.db
      .prepare("INSERT INTO pdf (id, ujian_id, nama_tampil, nama_berkas, ukuran_byte, sha256, diunggah_at) VALUES (77, 2, 'x', 'y', 1, ?, 0)")
      .run('a'.repeat(64));
    const r = await guru.minta('POST', `/api/ujian/${u.id}/soal`, { body: { ...SOAL, rujukan: [{ pdf_id: 77, halaman: 3 }] } });
    assert.equal(r.status, 404);
  });
});

describe('buka ujian & kembali ke draf', () => {
  test('belum lengkap → 409 belum_lengkap + daftar masalah yang sama dengan daftar periksa', async () => {
    const u = await ujianBaru();
    const kosong = await guru.minta('POST', `/api/ujian/${u.id}/buka`);
    assert.deepEqual(kosong.body, { error: 'belum_lengkap', masalah: ['Belum ada soal', 'Belum ada peserta'] });

    const setengah = { ...SOAL, jawaban_acuan: ' ', rubrik: { kriteria: [{ ...RUBRIK.kriteria[0], level: [{ skor: 2, deskriptor: 'x' }] }], poin_wajib: [] } };
    await guru.minta('POST', `/api/ujian/${u.id}/soal`, { body: setengah });
    await guru.minta('POST', `/api/ujian/${u.id}/peserta`, { body: { nama: 'Budi' } });
    const r = await guru.minta('POST', `/api/ujian/${u.id}/buka`);
    assert.equal(r.status, 409);
    assert.deepEqual((r.body as { masalah: string[] }).masalah, [
      'Soal 1 "Inflasi": jawaban acuan masih kosong',
      'Soal 1 "Inflasi": kriteria 1 "Analisis": butuh minimal 2 level',
      'Soal 1 "Inflasi": kriteria 1 "Analisis": wajib ada level berskor 0',
    ]);
    assert.equal(UjianDetailSchema.parse((await guru.minta('GET', `/api/ujian/${u.id}`)).body).status, 'draf');
  });

  test('lengkap → menunggu; siswa bisa melihat daftar nama; soal terkunci; kembali ke draf membuka kunci', async () => {
    const u = await ujianBaru();
    await siapkanLengkap(u.id);
    const buka = await guru.minta('POST', `/api/ujian/${u.id}/buka`);
    const detail = UjianDetailSchema.parse(buka.body);
    assert.equal(detail.status, 'menunggu');
    assert.ok(detail.dibuka_at);
    assert.equal((await a.klien().minta('POST', '/api/peserta/daftar-nama', { body: { kode: u.kode } })).status, 200);

    const soalId = detail.soal[0]?.id;
    assert.equal((await guru.minta('PATCH', `/api/ujian/${u.id}/soal/${soalId}`, { body: SOAL })).status, 409);
    assert.equal((await guru.minta('POST', `/api/ujian/${u.id}/soal`, { body: SOAL })).status, 409);
    assert.equal((await guru.minta('DELETE', `/api/ujian/${u.id}`)).status, 409);
    assert.deepEqual((await guru.minta('POST', `/api/ujian/${u.id}/buka`)).body, { error: 'transisi_tidak_sah' });

    const kembali = await guru.minta('POST', `/api/ujian/${u.id}/kembali-draf`);
    assert.deepEqual([UjianDetailSchema.parse(kembali.body).status, UjianDetailSchema.parse(kembali.body).dibuka_at], ['draf', null]);
    assert.equal((await a.klien().minta('POST', '/api/peserta/daftar-nama', { body: { kode: u.kode } })).status, 404);
    assert.equal((await guru.minta('PATCH', `/api/ujian/${u.id}/soal/${soalId}`, { body: SOAL })).status, 200);
    assert.deepEqual((await guru.minta('POST', `/api/ujian/${u.id}/kembali-draf`)).body, { error: 'transisi_tidak_sah' });

    const aksi = a.db.prepare('SELECT aksi FROM log_aksi WHERE ujian_id = ? ORDER BY id').pluck().all(u.id);
    assert.deepEqual(aksi.filter((x) => x === 'buka' || x === 'kembali_draf'), ['buka', 'kembali_draf']);
  });

  test('siswa yang sudah di ruang tunggu tetap bersesi saat kembali ke draf, dan melihat status draf', async () => {
    const u = await ujianBaru();
    await siapkanLengkap(u.id);
    await guru.minta('POST', `/api/ujian/${u.id}/buka`);
    const pid = (DaftarPesertaGuruSchema.parse((await guru.minta('GET', `/api/ujian/${u.id}/peserta`)).body)[0]?.id);
    const siswa = a.klien();
    const masukSiswa = await siswa.minta('POST', '/api/peserta/masuk', { body: { kode: u.kode, peserta_id: pid, pin: '1234', pin_ulang: '1234' } });
    assert.equal(masukSiswa.status, 204);
    await guru.minta('POST', `/api/ujian/${u.id}/kembali-draf`);
    const saya = await siswa.minta('GET', '/api/peserta/saya');
    assert.equal(saya.status, 200);
    assert.equal((saya.body as { ujian: { status: string } }).ujian.status, 'draf');
  });
});

describe('peserta', () => {
  test('tambah satu; nama + nomor kembar (tanpa beda huruf besar/kecil) → 409', async () => {
    const u = await ujianBaru();
    assert.equal((await guru.minta('POST', `/api/ujian/${u.id}/peserta`, { body: { nama: 'Budi', nomor: '01' } })).status, 201);
    const kembar = await guru.minta('POST', `/api/ujian/${u.id}/peserta`, { body: { nama: 'budi', nomor: '01' } });
    assert.deepEqual([kembar.status, kembar.body], [409, { error: 'nama_sudah_ada' }]);
    assert.equal((await guru.minta('POST', `/api/ujian/${u.id}/peserta`, { body: { nama: 'Budi', nomor: '02' } })).status, 201);
  });

  test('impor CSV: BOM, pemisah ";", kutip, baris judul & kosong; duplikat dan baris rusak dilaporkan per baris', async () => {
    const u = await ujianBaru();
    await guru.minta('POST', `/api/ujian/${u.id}/peserta`, { body: { nama: 'Ani', nomor: '02' } });
    const csv = `﻿Nama;Nomor\r\nBudi;01\r\nani;02\r\n\r\n"Siti; Aisyah";03\r\n;04\r\n${'X'.repeat(101)};05\r\nBudi;01\r\n`;
    const r = await guru.minta('POST', `/api/ujian/${u.id}/peserta/impor`, { body: { csv } });
    const hasil = ImporHasilSchema.parse(r.body);
    assert.deepEqual(hasil.ditambah.map((p) => `${p.nama}|${p.nomor}`), ['Budi|01', 'Siti; Aisyah|03']);
    assert.deepEqual(
      hasil.dilewati.map((d) => `${d.baris}:${d.alasan}`),
      ['3:duplikat', '6:tidak_valid', '7:tidak_valid', '8:duplikat'],
    );
    const daftar = DaftarPesertaGuruSchema.parse((await guru.minta('GET', `/api/ujian/${u.id}/peserta`)).body);
    assert.equal(daftar.length, 3);
    assert.doesNotMatch(JSON.stringify(daftar), /anon_|scrypt/);
  });

  test('impor ditolak bila kosong atau lebih dari 200 baris', async () => {
    const u = await ujianBaru();
    const banyak = Array.from({ length: 201 }, (_, i) => `Siswa ${i}`).join('\n');
    assert.deepEqual((await guru.minta('POST', `/api/ujian/${u.id}/peserta/impor`, { body: { csv: banyak } })).body, {
      error: 'csv_terlalu_banyak',
    });
    assert.deepEqual((await guru.minta('POST', `/api/ujian/${u.id}/peserta/impor`, { body: { csv: 'nama\n\n' } })).body, {
      error: 'csv_kosong',
    });
  });

  test('ubah & hapus hanya saat draf; menambah tetap boleh setelah dibuka', async () => {
    const u = await ujianBaru();
    await siapkanLengkap(u.id);
    const [budi] = DaftarPesertaGuruSchema.parse((await guru.minta('GET', `/api/ujian/${u.id}/peserta`)).body);
    const ubah = await guru.minta('PATCH', `/api/ujian/${u.id}/peserta/${budi?.id}`, { body: { nomor: '07' } });
    assert.equal((ubah.body as { nomor: string }).nomor, '07');
    await guru.minta('POST', `/api/ujian/${u.id}/buka`);
    assert.equal((await guru.minta('PATCH', `/api/ujian/${u.id}/peserta/${budi?.id}`, { body: { nama: 'X' } })).status, 409);
    assert.equal((await guru.minta('DELETE', `/api/ujian/${u.id}/peserta/${budi?.id}`)).status, 409);
    assert.equal((await guru.minta('POST', `/api/ujian/${u.id}/peserta`, { body: { nama: 'Terlambat Daftar' } })).status, 201);
    await guru.minta('POST', `/api/ujian/${u.id}/kembali-draf`);
    assert.equal((await guru.minta('DELETE', `/api/ujian/${u.id}/peserta/${budi?.id}`)).status, 204);
  });

  test('peserta ujian lain tidak bisa diubah lewat ujian ini', async () => {
    const u = await ujianBaru();
    assert.equal((await guru.minta('PATCH', `/api/ujian/${u.id}/peserta/1`, { body: { nama: 'X' } })).status, 404);
  });
});

describe('PDF buku', () => {
  async function unggah(id: number, isi = PDF_PALSU, nama = 'Buku Ekonomi.pdf') {
    return guru.minta('POST', `/api/ujian/${id}/pdf`, {
      mentah: { isi, tipe: 'application/pdf' },
      headers: { 'x-nama-berkas': encodeURIComponent(nama) },
    });
  }

  test('unggah: disimpan dengan nama acak, bisa dibaca utuh & sebagian (Range)', async () => {
    const u = await ujianBaru();
    const r = await unggah(u.id);
    assert.equal(r.status, 201);
    const pdf = PdfInfoSchema.parse(r.body);
    assert.deepEqual([pdf.nama_tampil, pdf.ukuran_byte], ['Buku Ekonomi.pdf', PDF_PALSU.length]);
    const berkas = readdirSync(a.uploadDir);
    assert.equal(berkas.length, 1);
    assert.match(berkas[0] ?? '', /^[0-9a-f]{32}\.pdf$/);

    const utuh = await guru.minta('GET', `/api/ujian/${u.id}/pdf/${pdf.id}`);
    assert.equal(utuh.status, 200);
    assert.equal(utuh.header.get('content-type'), 'application/pdf');
    const sebagian = await guru.minta('GET', `/api/ujian/${u.id}/pdf/${pdf.id}`, { headers: { range: 'bytes=0-4' } });
    assert.deepEqual([sebagian.status, sebagian.body], [206, '%PDF-']);

    const guru2 = await masuk('guru2');
    assert.equal((await guru2.minta('GET', `/api/ujian/${u.id}/pdf/${pdf.id}`)).status, 404);
  });

  test('UPLOAD_DIR di bawah folder berawalan titik (mis. /srv/.apps) tetap bisa disajikan', async () => {
    const induk = mkdtempSync(join(tmpdir(), 'ujian-titik-'));
    const lain = await mulaiAplikasiUji({}, { UPLOAD_DIR: join(induk, '.data', 'uploads') });
    try {
      await isiDataAwal(lain.db, 'draf');
      const k = lain.klien();
      await k.minta('POST', '/api/penguji/masuk', { body: { username: 'guru1', password: PASSWORD_GURU } });
      const r = await k.minta('POST', '/api/ujian/1/pdf', { mentah: { isi: PDF_PALSU, tipe: 'application/pdf' } });
      assert.equal(r.status, 201);
      const pdf = PdfInfoSchema.parse(r.body);
      assert.equal((await k.minta('GET', `/api/ujian/1/pdf/${pdf.id}`)).status, 200);
    } finally {
      lain.berhenti();
      rmSync(induk, { recursive: true, force: true });
    }
  });

  test('batas 20 PDF tetap berlaku walau diunggah bersamaan', async () => {
    const u = await ujianBaru();
    for (let i = 0; i < 18; i++) assert.equal((await unggah(u.id)).status, 201);
    const paralel = await Promise.all([1, 2, 3, 4].map(() => unggah(u.id)));
    assert.equal(paralel.filter((r) => r.status === 201).length, 2);
    assert.ok(paralel.filter((r) => r.status !== 201).every((r) => (r.body as { error: string }).error === 'batas_tercapai'));
    assert.equal(UjianDetailSchema.parse((await guru.minta('GET', `/api/ujian/${u.id}`)).body).pdf.length, 20);
    assert.equal(readdirSync(a.uploadDir).length, 20, 'berkas yang ditolak ikut dihapus');
  });

  test('nama tampil PDF dibersihkan dari karakter kendali & pembalik arah teks', async () => {
    const u = await ujianBaru();
    const r = await unggah(u.id, PDF_PALSU, 'Buku‮fdp.exe\u0007 Bab 1.pdf');
    assert.equal(PdfInfoSchema.parse(r.body).nama_tampil, 'Bukufdp.exe Bab 1.pdf');
  });

  test('bukan PDF ditolak; unggah hanya saat draf', async () => {
    const u = await ujianBaru();
    assert.deepEqual((await unggah(u.id, new TextEncoder().encode('<html>bukan pdf</html>'))).body, { error: 'bukan_pdf' });
    const json = await guru.minta('POST', `/api/ujian/${u.id}/pdf`, { body: { isi: '%PDF-' } });
    assert.deepEqual(json.body, { error: 'bukan_pdf' });
    await siapkanLengkap(u.id);
    await guru.minta('POST', `/api/ujian/${u.id}/buka`);
    assert.equal((await unggah(u.id)).status, 409);
    assert.equal(readdirSync(a.uploadDir).length, 0);
  });

  test('satu soal merujuk beberapa buku; hapus PDF menghapus rujukannya & berkasnya; hapus ujian menghapus semua berkasnya', async () => {
    const u = await ujianBaru();
    const pdf = PdfInfoSchema.parse((await unggah(u.id)).body);
    const pdf2 = PdfInfoSchema.parse((await unggah(u.id, PDF_PALSU, 'Buku Kedua.pdf')).body);
    const rujukan = [
      { pdf_id: pdf.id, halaman: 12 },
      { pdf_id: pdf2.id, halaman: null },
    ];
    const soal = SoalGuruSchema.parse((await guru.minta('POST', `/api/ujian/${u.id}/soal`, { body: { ...SOAL, rujukan } })).body);
    assert.deepEqual(soal.rujukan, rujukan);
    // Ubah: urutan rujukan mengikuti kiriman terakhir.
    const diubah = await guru.minta('PATCH', `/api/ujian/${u.id}/soal/${soal.id}`, { body: { ...SOAL, rujukan: [...rujukan].reverse() } });
    assert.deepEqual(SoalGuruSchema.parse(diubah.body).rujukan, [...rujukan].reverse());

    assert.equal((await guru.minta('DELETE', `/api/ujian/${u.id}/pdf/${pdf.id}`)).status, 204);
    const detail = UjianDetailSchema.parse((await guru.minta('GET', `/api/ujian/${u.id}`)).body);
    assert.deepEqual([detail.soal[0]?.rujukan, detail.pdf.length], [[{ pdf_id: pdf2.id, halaman: null }], 1]);
    assert.equal(readdirSync(a.uploadDir).length, 1);

    assert.equal((await guru.minta('DELETE', `/api/ujian/${u.id}`)).status, 204);
    assert.equal(readdirSync(a.uploadDir).length, 0);
    assert.equal((await guru.minta('GET', `/api/ujian/${u.id}`)).status, 404);
    assert.equal(existsSync(join(a.uploadDir, 'tidak-ada.pdf')), false);
  });
});

describe('duplikasi ujian', () => {
  async function unggahPdf(id: number, nama = 'Buku Fikih.pdf') {
    const r = await guru.minta('POST', `/api/ujian/${id}/pdf`, {
      mentah: { isi: PDF_PALSU, tipe: 'application/pdf' },
      headers: { 'x-nama-berkas': encodeURIComponent(nama) },
    });
    return PdfInfoSchema.parse(r.body);
  }

  test('ujian yang sudah dibuka disalin menjadi draf baru: soal, rubrik, acuan, PDF (berkas sendiri); peserta tidak', async () => {
    const u = await ujianBaru('Latihan Fikih');
    await guru.minta('PATCH', `/api/ujian/${u.id}`, { body: { petunjuk: 'Kerjakan dengan jujur.', durasi_menit: 45 } });
    await guru.minta('PATCH', `/api/ujian/${u.id}/tampilan`, { body: { mode_tampil: 'inisial' } });
    const pdf = await unggahPdf(u.id);
    await guru.minta('POST', `/api/ujian/${u.id}/soal`, { body: { ...SOAL, judul: 'Wudhu', rujukan: [{ pdf_id: pdf.id, halaman: 7 }] } });
    await guru.minta('POST', `/api/ujian/${u.id}/soal`, { body: { ...SOAL, judul: 'Shalat', bobot: 5 } });
    await guru.minta('POST', `/api/ujian/${u.id}/peserta`, { body: { nama: 'Budi' } });
    assert.equal((await guru.minta('POST', `/api/ujian/${u.id}/buka`)).status, 200);

    const r = await guru.minta('POST', `/api/ujian/${u.id}/duplikat`, { body: { salin_peserta: false } });
    assert.equal(r.status, 201);
    const s = UjianDetailSchema.parse(r.body);
    assert.notEqual(s.id, u.id);
    assert.notEqual(s.kode, u.kode);
    assert.match(s.kode, POLA_KODE_UJIAN);
    assert.deepEqual(
      [s.judul, s.petunjuk, s.durasi_menit, s.mode_tampil, s.status, s.dibuka_at, s.jumlah_peserta],
      ['Latihan Fikih (salinan)', 'Kerjakan dengan jujur.', 45, 'inisial', 'draf', null, 0],
    );
    assert.deepEqual(s.soal.map((x) => [x.urutan, x.judul, x.bobot]), [[1, 'Wudhu', 2], [2, 'Shalat', 5]]);
    assert.deepEqual(s.soal[0]?.rubrik, RUBRIK);
    assert.equal(s.soal[0]?.jawaban_acuan, SOAL.jawaban_acuan);
    // PDF salinan punya id & berkas sendiri, dan rujukan soal menunjuk ke PDF salinan.
    assert.equal(s.pdf.length, 1);
    assert.notEqual(s.pdf[0]?.id, pdf.id);
    assert.deepEqual([s.pdf[0]?.nama_tampil, s.soal[0]?.rujukan], ['Buku Fikih.pdf', [{ pdf_id: s.pdf[0]?.id, halaman: 7 }]]);
    assert.equal(readdirSync(a.uploadDir).length, 2);
    const isi = await guru.minta('GET', `/api/ujian/${s.id}/pdf/${s.pdf[0]?.id}`, { headers: { range: 'bytes=0-4' } });
    assert.deepEqual([isi.status, isi.body], [206, '%PDF-']);

    // Ujian asal tidak berubah; salinan bisa diedit dan dihapus tanpa mengganggu berkas asal.
    const asal = UjianDetailSchema.parse((await guru.minta('GET', `/api/ujian/${u.id}`)).body);
    assert.deepEqual([asal.status, asal.judul, asal.soal.length, asal.jumlah_peserta], ['menunggu', 'Latihan Fikih', 2, 1]);
    assert.equal((await guru.minta('PATCH', `/api/ujian/${s.id}/soal/${s.soal[1]?.id}`, { body: { ...SOAL, judul: 'Shalat (revisi)' } })).status, 200);
    assert.equal((await guru.minta('DELETE', `/api/ujian/${s.id}`)).status, 204);
    assert.equal(readdirSync(a.uploadDir).length, 1);
    assert.equal((await guru.minta('GET', `/api/ujian/${u.id}/pdf/${pdf.id}`)).status, 200);

    const log = a.db.prepare("SELECT aksi, detail_json FROM log_aksi WHERE ujian_id = ? AND aksi = 'duplikat_dari'").all(s.id);
    assert.equal(log.length, 0, 'log ikut terhapus bersama salinannya');
  });

  test('salin peserta: hanya nama + nomor, tanpa PIN/status; id anonim baru', async () => {
    // Ujian 1 dari data awal (3 peserta); satu peserta dibuat seolah sudah punya PIN & sedang mengerjakan.
    a.db.prepare("UPDATE peserta SET pin_hash = 'scrypt$x', pin_dibuat_at = ?, status = 'mengerjakan', masuk_pertama_at = ? WHERE id = 1").run(Date.now(), Date.now());
    const r = await guru.minta('POST', '/api/ujian/1/duplikat', { body: { salin_peserta: true } });
    assert.equal(r.status, 201);
    const s = UjianDetailSchema.parse(r.body);
    assert.equal(s.jumlah_peserta, 3);
    const baris = a.db
      .prepare('SELECT nama, nomor, pin_hash, status, masuk_pertama_at, id_anonim FROM peserta WHERE ujian_id = ? ORDER BY nomor')
      .all(s.id) as { nama: string; nomor: string; pin_hash: string | null; status: string; masuk_pertama_at: number | null; id_anonim: string }[];
    assert.deepEqual(baris.map((b) => [b.nama, b.nomor, b.pin_hash, b.status, b.masuk_pertama_at]), [
      ['Budi', '01', null, 'belum_masuk', null],
      ['Ani', '02', null, 'belum_masuk', null],
      ['Cici', '03', null, 'belum_masuk', null],
    ]);
    const anonLama = a.db.prepare('SELECT id_anonim FROM peserta WHERE ujian_id = 1').pluck().all() as string[];
    assert.ok(baris.every((b) => /^anon_/.test(b.id_anonim) && !anonLama.includes(b.id_anonim)));
    const log = a.db.prepare("SELECT detail_json FROM log_aksi WHERE ujian_id = ? AND aksi = 'duplikat_dari'").pluck().get(s.id) as string;
    assert.deepEqual(JSON.parse(log), { ujian_id: 1, jumlah_soal: 0, jumlah_pdf: 0, jumlah_peserta: 3 });
  });

  test('judul panjang dipotong agar tetap ≤ 200 karakter; body wajib; ujian guru lain → 404', async () => {
    const u = await ujianBaru('x'.repeat(200));
    const s = UjianDetailSchema.parse((await guru.minta('POST', `/api/ujian/${u.id}/duplikat`, { body: { salin_peserta: false } })).body);
    assert.equal(s.judul.length, 200);
    assert.ok(s.judul.endsWith(' (salinan)'));
    assert.equal((await guru.minta('POST', `/api/ujian/${u.id}/duplikat`, { body: {} })).status, 400);
    assert.equal((await guru.minta('POST', '/api/ujian/2/duplikat', { body: { salin_peserta: true } })).status, 404);
    assert.equal(a.db.prepare('SELECT COUNT(*) FROM ujian WHERE penguji_id = 1').pluck().get(), 3);
  });
});
