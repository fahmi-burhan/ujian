// tests/autosave.test.ts — mesin autosave klien (client/src/autosave.ts) dengan server, penyimpanan, dan jam
// tiruan: jeda mengetik, satu kiriman per soal, kirim ulang saat jaringan gagal (id sama), bentrok, jeda,
// terlambat, tab lain, dan pencocokan penyangga saat halaman dimuat ulang (docs/DESAIN.md §5).
// Dipanggil oleh: `npm test`. Memanggil: client/src/autosave.ts.
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { buatAutosave } from '../client/src/autosave.ts';
import type { Autosave, Bentrok, HasilKirim, Kiriman, OpsiAutosave, Penyimpanan } from '../client/src/autosave.ts';

const AWALAN = 'ujian:1:peserta:7:';

type Panggilan = { soalId: number; kiriman: Kiriman; jawab: (h: HasilKirim) => void };

let panggilan: Panggilan[];
let gudang: Map<string, string>;
let bentrok: Bentrok[];
let tabTidakAktif: number;
let nomorUuid: number;

const penyimpanan = (): Penyimpanan => ({
  ambil: (k) => gudang.get(k) ?? null,
  tulis: (k, v) => void gudang.set(k, v),
  hapus: (k) => void gudang.delete(k),
  semuaKunci: () => [...gudang.keys()],
});

function buat(ubah: Partial<OpsiAutosave> = {}): Autosave {
  return buatAutosave({
    awalan: AWALAN,
    kirim: (soalId, kiriman) =>
      new Promise<HasilKirim>((jawab) => {
        panggilan.push({ soalId, kiriman, jawab });
      }),
    penyimpanan: penyimpanan(),
    uuid: () => `id-${++nomorUuid}`,
    jam: () => Date.now(),
    saatBerubah: () => {},
    saatBentrok: (b) => void bentrok.push(b),
    saatTabTidakAktif: () => void (tabTidakAktif += 1),
    saatDitolak: () => {},
    ...ubah,
  });
}

// Membiarkan Promise yang sudah selesai menjalankan lanjutannya.
async function alirkan(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function penyangga(soalId: number): Record<string, unknown> | null {
  const t = gudang.get(`${AWALAN}soal:${soalId}`);
  return t ? (JSON.parse(t) as Record<string, unknown>) : null;
}

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  panggilan = [];
  gudang = new Map();
  bentrok = [];
  tabTidakAktif = 0;
  nomorUuid = 0;
});
afterEach(() => mock.timers.reset());

describe('autosave klien', () => {
  test('penyangga ditulis SEBELUM dikirim; dikirim setelah jeda mengetik 1,5 dtk; dihapus setelah tersimpan', async () => {
    const s = buat();
    s.muat([], true);
    s.ubah(5, 'halo', false);
    assert.equal(penyangga(5)?.isi, 'halo');
    mock.timers.tick(1400);
    assert.equal(panggilan.length, 0);
    s.ubah(5, 'halo dunia', false);
    mock.timers.tick(1499);
    assert.equal(panggilan.length, 0);
    mock.timers.tick(1);
    assert.equal(panggilan.length, 1);
    assert.deepEqual(panggilan[0]?.kiriman, { isi: 'halo dunia', ditandai: false, versi_dasar: 0, id_simpan: 'id-2' });
    assert.equal(s.keadaan(5), 'mengirim');
    panggilan[0]?.jawab({ jenis: 'ok', versi: 1 });
    await alirkan();
    assert.equal(s.keadaan(5), 'tersimpan');
    assert.equal(penyangga(5), null);
    assert.equal(s.jumlahTertunda(), 0);
    assert.deepEqual(s.versiServer(), { 5: 1 });
  });

  test('mengetik terus-menerus tetap terkirim paling lambat tiap 15 dtk', () => {
    const s = buat();
    s.muat([], true);
    for (let i = 0; i < 20; i++) {
      s.ubah(5, `teks ${i}`, false);
      mock.timers.tick(1000);
    }
    assert.equal(panggilan.length, 1, 'kiriman pertama tidak menunggu siswa berhenti mengetik');
  });

  test('satu kiriman di jalan per soal; ketikan selama itu dikirim sesudahnya dengan versi_dasar baru', async () => {
    const s = buat();
    s.muat([], true);
    s.ubah(5, 'a', false);
    mock.timers.tick(1500);
    s.ubah(5, 'ab', false);
    mock.timers.tick(5000);
    assert.equal(panggilan.length, 1);
    panggilan[0]?.jawab({ jenis: 'ok', versi: 1 });
    await alirkan();
    // Isi baru mengikuti jeda mengetik biasa (tidak langsung dikirim beruntun).
    mock.timers.tick(1499);
    assert.equal(panggilan.length, 1);
    mock.timers.tick(1);
    assert.equal(panggilan.length, 2);
    assert.deepEqual(panggilan[1]?.kiriman, { isi: 'ab', ditandai: false, versi_dasar: 1, id_simpan: 'id-2' });
    panggilan[1]?.jawab({ jenis: 'ok', versi: 2 });
    await alirkan();
    assert.equal(penyangga(5), null);
  });

  test('jaringan gagal → kiriman SAMA PERSIS dikirim ulang dengan jeda 2, 4, 8 dtk; penyangga tetap ada', async () => {
    const s = buat();
    s.muat([], true);
    s.ubah(5, 'penting', false);
    mock.timers.tick(1500);
    const pertama = panggilan[0]?.kiriman;
    panggilan[0]?.jawab({ jenis: 'jaringan' });
    await alirkan();
    assert.equal(s.keadaan(5), 'gagal');
    mock.timers.tick(1999);
    assert.equal(panggilan.length, 1);
    mock.timers.tick(1);
    assert.deepEqual(panggilan[1]?.kiriman, pertama);
    panggilan[1]?.jawab({ jenis: 'jaringan' });
    await alirkan();
    mock.timers.tick(3999);
    assert.equal(panggilan.length, 2);
    mock.timers.tick(1);
    assert.deepEqual(panggilan[2]?.kiriman, pertama);
    assert.equal(penyangga(5)?.isi, 'penting');
    panggilan[2]?.jawab({ jenis: 'ok', versi: 1 });
    await alirkan();
    assert.equal(penyangga(5), null);
  });

  test('bentrok: kedua teks ditunjukkan; pilih teks laptop → dikirim sebagai versi baru bertanda konflik', async () => {
    const s = buat();
    s.muat([{ soal_id: 5, isi: 'lama', ditandai: false, versi: 1 }], true);
    s.ubah(5, 'versi laptop', false);
    mock.timers.tick(1500);
    panggilan[0]?.jawab({ jenis: 'bentrok', versi: 3, isi: 'versi lain', ditandai: true });
    await alirkan();
    assert.equal(s.keadaan(5), 'bentrok');
    assert.deepEqual(bentrok, [
      { soalId: 5, server: { isi: 'versi lain', ditandai: true, versi: 3 }, laptop: { isi: 'versi laptop', ditandai: false } },
    ]);
    // Selama bentrok belum dipilih, ketikan tidak menimpa apa pun.
    s.ubah(5, 'x', false);
    assert.equal(penyangga(5)?.isi, 'versi laptop');
    s.pilihBentrok(5, 'laptop');
    mock.timers.tick(0);
    assert.deepEqual(panggilan[1]?.kiriman, {
      isi: 'versi laptop',
      ditandai: false,
      versi_dasar: 3,
      id_simpan: 'id-2',
      konflik: true,
    });
  });

  test('bentrok: pilih teks server → penyangga dibuang atas pilihan siswa', async () => {
    const s = buat();
    s.muat([], true);
    s.ubah(5, 'laptop', false);
    mock.timers.tick(1500);
    panggilan[0]?.jawab({ jenis: 'bentrok', versi: 2, isi: 'server', ditandai: false });
    await alirkan();
    s.pilihBentrok(5, 'server');
    assert.equal(penyangga(5), null);
    assert.equal(s.isi(5), 'server');
  });

  test('dijeda → disimpan, dikirim lagi setelah dilanjutkan; terlambat → ditandai dan tidak dikirim ulang', async () => {
    const s = buat();
    s.muat([], true);
    s.ubah(5, 'saat jeda', false);
    s.ubah(6, 'telat', false);
    mock.timers.tick(1500);
    panggilan[0]?.jawab({ jenis: 'dijeda' });
    panggilan[1]?.jawab({ jenis: 'terlambat' });
    await alirkan();
    assert.equal(s.keadaan(5), 'dijeda');
    assert.equal(s.keadaan(6), 'terlambat');
    assert.equal(penyangga(6)?.terkirim_terlambat, true);
    assert.equal(s.jumlahTertunda(), 1);
    assert.equal(s.jumlahTerlambat(), 1);
    mock.timers.tick(60_000);
    assert.equal(panggilan.length, 2);
    s.lanjutkan();
    mock.timers.tick(0);
    assert.equal(panggilan.length, 3);
    assert.equal(panggilan[2]?.soalId, 5);
    // Dibuka kembali oleh guru: teks terlambat dikirim lagi dengan id baru.
    s.bukaKembali();
    mock.timers.tick(0);
    assert.equal(panggilan[3]?.soalId, 6);
    assert.notEqual(panggilan[3]?.kiriman.id_simpan, panggilan[1]?.kiriman.id_simpan);
  });

  test('tab lain aktif → pengiriman & tulisan localStorage berhenti sampai tab ini diklaim ulang', async () => {
    const s = buat();
    s.muat([], true);
    s.ubah(5, 'a', false);
    mock.timers.tick(1500);
    panggilan[0]?.jawab({ jenis: 'tab_tidak_aktif' });
    await alirkan();
    assert.equal(tabTidakAktif, 1);
    s.ubah(6, 'b', false);
    mock.timers.tick(20_000);
    assert.equal(panggilan.length, 1);
    // Tab lama tidak menulis localStorage lagi (penyangga di sana kini milik tab baru).
    assert.equal(penyangga(6), null);
    s.aktifkan();
    mock.timers.tick(0);
    // Ketikan setelah diambil alih diabaikan (di halaman, editor juga terkunci).
    assert.deepEqual(panggilan.slice(1).map((p) => p.soalId), [5]);
  });

  test('belum aktif (tab belum diklaim) → tidak mengirim apa pun sampai aktifkan()', () => {
    gudang.set(`${AWALAN}soal:5`, JSON.stringify({ isi: 'tertunda', ditandai: false, versi_dasar: 0, id_simpan: 'x', terkirim_terlambat: false, diubah_at: 0 }));
    const s = buat({ aktif: false });
    s.muat([], true);
    s.ubah(6, 'baru', false);
    mock.timers.tick(20_000);
    assert.equal(panggilan.length, 0);
    s.aktifkan();
    mock.timers.tick(0);
    assert.deepEqual(panggilan.map((p) => p.soalId).sort(), [5, 6]);
  });

  test('teks yang tertahan "dijeda" ikut dikirim saat koneksi pulih / ujian terlihat berlangsung lagi', async () => {
    const s = buat();
    s.muat([], true);
    s.ubah(5, 'saat jeda', false);
    mock.timers.tick(1500);
    panggilan[0]?.jawab({ jenis: 'dijeda' });
    await alirkan();
    s.kirimSemuaSekarang();
    mock.timers.tick(0);
    assert.equal(panggilan.length, 2);
    panggilan[1]?.jawab({ jenis: 'ok', versi: 1 });
    await alirkan();
    assert.equal(s.jumlahTertunda(), 0);
  });

  test('localStorage gagal ditulis → pemanggil diberi tahu, teks tetap di memori & tetap dikirim', () => {
    let gagal = 0;
    const s = buat({
      penyimpanan: { ...penyimpanan(), tulis: () => { throw new Error('QuotaExceededError'); } },
      saatPenyimpananGagal: () => void (gagal += 1),
    });
    s.muat([], true);
    s.ubah(5, 'tetap aman', false);
    assert.ok(gagal > 0);
    assert.equal(s.isi(5), 'tetap aman');
    mock.timers.tick(1500);
    assert.equal(panggilan[0]?.kiriman.isi, 'tetap aman');
  });

  test('dimuat ulang: isi sama → dibuang; kelanjutan → dikirim; simpanan sendiri yang tak terbalas → bukan bentrok; beda → bentrok', () => {
    const tulis = (soalId: number, p: Record<string, unknown>) =>
      gudang.set(
        `${AWALAN}soal:${soalId}`,
        JSON.stringify({ ditandai: false, id_simpan: 'lama', terkirim_terlambat: false, diubah_at: 0, terbang: null, ...p }),
      );
    tulis(1, { isi: 'sama', versi_dasar: 1 });
    tulis(2, { isi: 'lanjutan', versi_dasar: 2 });
    tulis(3, { isi: 'lebih baru', versi_dasar: 4, terbang: { isi: 'terkirim', ditandai: false } });
    tulis(4, { isi: 'laptop', versi_dasar: 1 });
    // Kunci ujian lain tidak disentuh.
    gudang.set('ujian:2:peserta:7:soal:1', '{"isi":"lain"}');
    const s = buat();
    s.muat(
      [
        { soal_id: 1, isi: 'sama', ditandai: false, versi: 3 },
        { soal_id: 2, isi: 'x', ditandai: false, versi: 2 },
        { soal_id: 3, isi: 'terkirim', ditandai: false, versi: 5 },
        { soal_id: 4, isi: 'server', ditandai: false, versi: 6 },
      ],
      true,
    );
    assert.equal(penyangga(1), null);
    mock.timers.tick(0);
    assert.deepEqual(
      panggilan.map((p) => [p.soalId, p.kiriman.versi_dasar]),
      [
        [2, 2],
        [3, 5],
      ],
    );
    assert.deepEqual(
      bentrok.map((b) => b.soalId),
      [4],
    );
    assert.equal(penyangga(4)?.isi, 'laptop', 'penyangga yang bentrok tidak pernah dibuang otomatis');
    assert.equal(gudang.get('ujian:2:peserta:7:soal:1'), '{"isi":"lain"}');
  });

  test('bersihkan hanya bila tidak ada yang tertunda', async () => {
    const s = buat();
    s.muat([], true);
    gudang.set(`${AWALAN}tempel`, '[]');
    s.ubah(5, 'a', false);
    assert.equal(s.bersihkan(), false);
    mock.timers.tick(1500);
    panggilan[0]?.jawab({ jenis: 'ok', versi: 1 });
    await alirkan();
    assert.equal(s.bersihkan(), true);
    assert.equal(gudang.size, 0);
  });
});
