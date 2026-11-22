// tests/integritas.test.ts — pencatat kepergian di klien (client/src/integritas.ts) dan himpunan salin untuk
// blokir tempel (client/src/tempel.ts), dengan jam, pengirim, dan penyimpanan tiruan.
// Dipanggil oleh: `npm test`. Memanggil: client/src/integritas.ts, client/src/tempel.ts.
// Mengacu pada docs/DESAIN.md §6 (satu kepergian = satu event, blur ≥ 1 dtk, sinyal terkuat, tempel).
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { buatPencatat } from '../client/src/integritas.ts';
import type { HasilLapor, OpsiPencatat, Pencatat } from '../client/src/integritas.ts';
import { buatHimpunanSalin, normalisasi, sidikTeks } from '../client/src/tempel.ts';
import type { LaporanEvent } from '../shared/pantau.ts';

const AWALAN = 'ujian:1:peserta:7:';
const SELISIH_SERVER = 5_000_000; // jam server = jam monoton + selisih

let gudang: Map<string, string>;
let terkirim: LaporanEvent[];
let hasilKirim: HasilLapor;
let aktif: boolean;
let kembali: { durasi: number; jenis: string }[];
let nomor: number;

function buat(ubah: Partial<OpsiPencatat> = {}): Pencatat {
  return buatPencatat({
    awalan: AWALAN,
    penyimpanan: {
      ambil: (k) => gudang.get(k) ?? null,
      tulis: (k, v) => void gudang.set(k, v),
      hapus: (k) => void gudang.delete(k),
    },
    kirim: async (l) => {
      terkirim.push(structuredClone(l));
      return hasilKirim;
    },
    uuid: () => `00000000-0000-4000-8000-${String(++nomor).padStart(12, '0')}`,
    jamServer: () => Date.now() + SELISIH_SERVER,
    monoton: () => Date.now(),
    aktif: () => aktif,
    saatKembali: (durasi, jenis) => void kembali.push({ durasi, jenis }),
    ...ubah,
  });
}

async function alirkan(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  gudang = new Map();
  terkirim = [];
  hasilKirim = 'ok';
  aktif = true;
  kembali = [];
  nomor = 0;
});
afterEach(() => mock.timers.reset());

describe('kepergian', () => {
  test('pindah tab: "mulai" langsung, "selesai" dengan durasi; peringatan ke siswa', async () => {
    const p = buat();
    p.sinyal('blur');
    p.sinyal('tersembunyi');
    await alirkan();
    assert.equal(terkirim.length, 1);
    assert.deepEqual([terkirim[0]?.jenis, terkirim[0]?.tahap, terkirim[0]?.mulai_klien_at], ['tab_tersembunyi', 'mulai', 1_000_000 + SELISIH_SERVER]);
    mock.timers.tick(12_000);
    p.sinyal('terlihat');
    assert.equal(p.sedangPergi(), true, 'masih belum fokus');
    p.sinyal('fokus');
    await alirkan();
    assert.equal(terkirim.length, 2);
    assert.deepEqual([terkirim[1]?.tahap, terkirim[1]?.durasi_ms, terkirim[1]?.id_klien], ['selesai', 12_000, terkirim[0]?.id_klien]);
    assert.deepEqual(kembali, [{ durasi: 12_000, jenis: 'tab_tersembunyi' }]);
    assert.equal(p.jumlahAntrean(), 0);
  });

  test('jendela tidak aktif < 1 dtk tidak dicatat; ≥ 1 dtk dicatat sejak awal blur', async () => {
    const p = buat();
    p.sinyal('blur');
    mock.timers.tick(800);
    p.sinyal('fokus');
    await alirkan();
    assert.equal(terkirim.length, 0);
    p.sinyal('blur');
    mock.timers.tick(1000);
    await alirkan();
    assert.deepEqual([terkirim[0]?.jenis, terkirim[0]?.mulai_klien_at], ['fokus_hilang', 1_000_800 + SELISIH_SERVER]);
    mock.timers.tick(2000);
    p.sinyal('fokus');
    await alirkan();
    assert.equal(terkirim[1]?.durasi_ms, 3000);
  });

  test('satu kepergian = satu event: keluar layar penuh lalu pindah tab → jenis naik, kembali hanya bila layar penuh lagi', async () => {
    const p = buat();
    p.sinyal('keluar_layar_penuh');
    p.sinyal('blur');
    p.sinyal('tersembunyi');
    await alirkan();
    assert.deepEqual(terkirim.map((l) => [l.jenis, l.tahap]), [['keluar_layar_penuh', 'mulai'], ['tab_tersembunyi', 'mulai']]);
    assert.equal(terkirim[0]?.id_klien, terkirim[1]?.id_klien);
    mock.timers.tick(5000);
    p.sinyal('terlihat');
    p.sinyal('fokus');
    assert.equal(p.sedangPergi(), true, 'belum layar penuh');
    mock.timers.tick(3000);
    p.sinyal('masuk_layar_penuh');
    await alirkan();
    const akhir = terkirim.at(-1);
    assert.deepEqual([akhir?.tahap, akhir?.jenis, akhir?.durasi_ms], ['selesai', 'tab_tersembunyi', 8000]);
    // Jendela juga tidak aktif > 1 dtk selama kepergian itu: ikut tercatat sebagai sinyal, jenis tetap terkuat.
    assert.deepEqual(akhir?.detail?.sinyal, ['keluar_layar_penuh', 'tab_tersembunyi', 'fokus_hilang']);
  });

  test('tidak dimulai saat tidak aktif (ruang tunggu/dijeda); Esc di ruang tunggu tidak tertinggal', async () => {
    aktif = false;
    const p = buat();
    p.sinyal('keluar_layar_penuh');
    p.sinyal('tersembunyi');
    p.sinyal('terlihat');
    aktif = true;
    p.sinyal('blur');
    p.sinyal('fokus');
    await alirkan();
    assert.equal(terkirim.length, 0);
  });

  test('sudah di luar halaman saat menjadi aktif (Lanjutkan/Mulai) → dicatat sejak saat aktif', async () => {
    aktif = false;
    const p = buat();
    p.sinyal('blur');
    p.sinyal('tersembunyi');
    mock.timers.tick(60_000);
    aktif = true;
    p.segarkan({ tersembunyi: true, fokus: false });
    await alirkan();
    assert.deepEqual([terkirim[0]?.jenis, terkirim[0]?.mulai_klien_at], ['tab_tersembunyi', 1_060_000 + SELISIH_SERVER]);
    mock.timers.tick(5000);
    p.sinyal('terlihat');
    p.sinyal('fokus');
    await alirkan();
    assert.equal(terkirim.at(-1)?.durasi_ms, 5000);
  });

  test('sisa blur dari ruang tunggu tidak membuat waktu mulai jatuh sebelum ujian dimulai', async () => {
    aktif = false;
    const p = buat();
    p.sinyal('blur');
    mock.timers.tick(30_000);
    aktif = true;
    p.segarkan({ tersembunyi: false, fokus: false });
    await alirkan();
    mock.timers.tick(1000);
    await alirkan();
    assert.deepEqual([terkirim[0]?.jenis, terkirim[0]?.mulai_klien_at], ['fokus_hilang', 1_030_000 + SELISIH_SERVER]);
  });

  test('browser menolak layar penuh: kepergian keluar layar penuh tetap bisa berakhir', async () => {
    const p = buat();
    p.sinyal('keluar_layar_penuh');
    mock.timers.tick(4000);
    p.abaikanLayarPenuh();
    await alirkan();
    assert.deepEqual(terkirim.map((l) => [l.tahap, l.durasi_ms]), [['mulai', undefined], ['selesai', 4000]]);
  });

  test('Wi-Fi putus: antrean disimpan & dikirim ulang; halaman ditutup saat pergi → diselesaikan saat dimuat lagi', async () => {
    hasilKirim = 'gagal';
    const p = buat();
    p.sinyal('tersembunyi');
    await alirkan();
    assert.equal(p.jumlahAntrean(), 1);
    assert.ok(gudang.has(`${AWALAN}laporan`));
    assert.ok(gudang.has(`${AWALAN}kepergian`));
    p.hentikan();
    // Halaman dimuat ulang 30 dtk kemudian (tab baru).
    mock.timers.tick(30_000);
    hasilKirim = 'ok';
    terkirim = [];
    const p2 = buat();
    await alirkan();
    assert.deepEqual(terkirim.map((l) => [l.tahap, l.durasi_ms]), [['mulai', undefined], ['selesai', 30_000]]);
    assert.equal(p2.jumlahAntrean(), 0);
    assert.equal(gudang.has(`${AWALAN}kepergian`), false);
  });

  test('kirim ulang dengan jeda bertambah sampai berhasil', async () => {
    hasilKirim = 'gagal';
    const p = buat();
    p.tempel(42);
    await alirkan();
    assert.equal(terkirim.length, 1);
    mock.timers.tick(2000);
    await alirkan();
    assert.equal(terkirim.length, 2);
    hasilKirim = 'ok';
    mock.timers.tick(4000);
    await alirkan();
    assert.equal(terkirim.length, 3);
    assert.deepEqual([terkirim[2]?.jenis, terkirim[2]?.detail], ['tempel_dari_luar', { panjang: 42 }]);
    assert.equal(p.jumlahAntrean(), 0);
  });
});

describe('himpunan salin (blokir tempel)', () => {
  test('normalisasi menyamakan akhir baris & spasi; teks dari halaman sendiri boleh, dari luar tidak', () => {
    assert.equal(normalisasi('  Rukun\r\nwudhu  ada   enam  \r\n'), 'Rukun\nwudhu ada enam');
    assert.equal(sidikTeks('a\r\nb'), sidikTeks('a\nb'));
    const gudang2 = new Map<string, string>();
    const h = buatHimpunanSalin('k', { ambil: (k) => gudang2.get(k) ?? null, tulis: (k, v) => void gudang2.set(k, v) });
    h.catat('Sebutkan seluruh rukun wudhu!');
    assert.equal(h.boleh('Sebutkan seluruh rukun wudhu!\r\n'), true);
    assert.equal(h.boleh('Jawaban dari chatbot'), false);
    assert.equal(h.boleh('   '), true, 'kosong tidak perlu diblokir');
    // Tetap ada setelah halaman dimuat ulang.
    const h2 = buatHimpunanSalin('k', { ambil: (k) => gudang2.get(k) ?? null, tulis: (k, v) => void gudang2.set(k, v) });
    assert.equal(h2.boleh('Sebutkan seluruh rukun wudhu!'), true);
    // Isi teks tidak disimpan, hanya sidiknya.
    assert.equal((gudang2.get('k') ?? '').includes('wudhu'), false);
  });

  test('dibatasi jumlahnya (yang tertua dibuang)', () => {
    const g = new Map<string, string>();
    const h = buatHimpunanSalin('k', { ambil: (k) => g.get(k) ?? null, tulis: (k, v) => void g.set(k, v) }, 3);
    for (const t of ['a', 'b', 'c', 'd']) h.catat(t);
    assert.deepEqual([h.boleh('a'), h.boleh('b'), h.boleh('d')], [false, true, true]);
  });
});
