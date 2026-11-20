// tests/auth.test.ts — login guru, masuk siswa (nama + PIN), proyektor, pemisahan lingkup, dan CSRF.
// Dipanggil oleh: `npm test`. Memanggil: tests/bantuan.ts, server lewat HTTP sungguhan.
// Mengacu pada docs/DESAIN.md §1, §8, §8.1, §12.
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DaftarNamaResponsSchema, PengujiSayaSchema, PesertaSayaSchema, ProyektorSayaSchema } from '../shared/auth.ts';
import { cocokkanRahasia, hashRahasia } from '../server/auth/kata-sandi.ts';
import { buatPenguji } from '../server/auth/penguji.ts';
import { cariPerangkatDikenal, ingatPerangkat, UMUR_PERANGKAT_MS } from '../server/auth/perangkat-dikenal.ts';
import { isiDataAwal, mulaiAplikasiUji, PASSWORD_GURU, T0 } from './bantuan.ts';
import type { AplikasiUji, Klien } from './bantuan.ts';

let a: AplikasiUji;

beforeEach(async () => {
  a = await mulaiAplikasiUji();
  await isiDataAwal(a.db);
});
afterEach(() => a.berhenti());

async function masukGuru(username = 'guru1'): Promise<Klien> {
  const k = a.klien();
  const r = await k.minta('POST', '/api/penguji/masuk', { body: { username, password: PASSWORD_GURU } });
  assert.equal(r.status, 204);
  return k;
}

async function masukSiswa(pesertaId: number, pin: string, pinUlang?: string, k: Klien = a.klien()) {
  const r = await k.minta('POST', '/api/peserta/masuk', {
    body: { kode: 'abc-234', peserta_id: pesertaId, pin, pin_ulang: pinUlang },
  });
  return { k, r };
}

describe('hash rahasia (scrypt)', () => {
  test('cocok untuk rahasia yang benar, tidak untuk yang salah, dan salt membuat hash berbeda', async () => {
    const h1 = await hashRahasia('1234');
    const h2 = await hashRahasia('1234');
    assert.notEqual(h1, h2);
    assert.match(h1, /^scrypt\$/);
    assert.equal(await cocokkanRahasia('1234', h1), true);
    assert.equal(await cocokkanRahasia('1235', h1), false);
  });

  test('format rusak dianggap tidak cocok (bukan galat)', async () => {
    for (const rusak of ['', 'scrypt$x', 'bcrypt$1$2$3$4$5', 'scrypt$16384$8$1$$']) {
      assert.equal(await cocokkanRahasia('1234', rusak), false, rusak);
    }
  });
});

describe('akun guru (CLI)', () => {
  test('membuat akun valid; menolak password pendek dan username kembar', async () => {
    const id = await buatPenguji(a.db, T0, { username: 'guru3', nama: 'Bu Sari', password: 'panjang-sekali-1' });
    assert.ok(id > 0);
    await assert.rejects(buatPenguji(a.db, T0, { username: 'guru4', nama: 'X', password: 'pendek' }), /minimal 10/);
    await assert.rejects(buatPenguji(a.db, T0, { username: 'GURU3', nama: 'X', password: 'panjang-sekali-1' }), /sudah dipakai/);
    await assert.rejects(buatPenguji(a.db, T0, { username: 'ada spasi', nama: 'X', password: 'panjang-sekali-1' }), /Username/);
  });
});

describe('login guru', () => {
  test('berhasil: cookie sesi_guru HttpOnly + SameSite=Lax, lalu /saya sesuai kontrak', async () => {
    const k = a.klien();
    const r = await k.minta('POST', '/api/penguji/masuk', { body: { username: 'guru1', password: PASSWORD_GURU } });
    assert.equal(r.status, 204);
    const setCookie = r.header.getSetCookie().join('\n');
    assert.match(setCookie, /sesi_guru=/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    const saya = await k.minta('GET', '/api/penguji/saya');
    assert.equal(saya.status, 200);
    assert.deepEqual(PengujiSayaSchema.parse(saya.body), { id: 1, username: 'guru1', nama: 'Bu Rina' });
  });

  test('password salah dan username tak dikenal dijawab sama: 401 login_salah', async () => {
    const k = a.klien();
    const salah = await k.minta('POST', '/api/penguji/masuk', { body: { username: 'guru1', password: 'bukan-password-ini' } });
    const tidakAda = await k.minta('POST', '/api/penguji/masuk', { body: { username: 'hantu', password: 'bukan-password-ini' } });
    assert.deepEqual([salah.status, salah.body], [401, { error: 'login_salah' }]);
    assert.deepEqual([tidakAda.status, tidakAda.body], [401, { error: 'login_salah' }]);
  });

  test('login gagal dijawab setelah jeda tetap (memperlambat tebak password)', async () => {
    const lambat = await mulaiAplikasiUji({ jedaGagalLoginMs: 150 });
    try {
      await isiDataAwal(lambat.db);
      const mulai = performance.now();
      const r = await lambat.klien().minta('POST', '/api/penguji/masuk', { body: { username: 'guru1', password: 'salah-salah-salah' } });
      assert.equal(r.status, 401);
      assert.ok(performance.now() - mulai >= 140, 'harus menunggu jeda');
    } finally {
      lambat.berhenti();
    }
  });

  test('banjir login guru (username acak) tidak membuat siswa gagal membuat PIN', async () => {
    const banjir = Array.from({ length: 60 }, (_, i) =>
      a.klien().minta('POST', '/api/penguji/masuk', { body: { username: `acak${i}`, password: 'tebakan-acak-123' } }),
    );
    const siswa = masukSiswa(1, '4821', '4821');
    const hasilBanjir = await Promise.all(banjir);
    assert.ok(hasilBanjir.some((r) => r.status === 503), 'jatah scrypt guru penuh → sebagian 503');
    assert.equal((await siswa).r.status, 204, 'jatah scrypt siswa terpisah');
  });

  test('perangkat dikenal: cookie khusus halaman login (HttpOnly, SameSite=Strict, 90 hari)', async () => {
    const k = a.klien();
    const r = await k.minta('POST', '/api/penguji/masuk', { body: { username: 'guru1', password: PASSWORD_GURU } });
    const cookie = r.header.getSetCookie().find((c) => c.startsWith('perangkat_guru='));
    assert.ok(cookie, 'cookie perangkat dipasang');
    assert.match(cookie, /Path=\/api\/penguji\/masuk/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Max-Age=7776000/);
    const tersimpan = a.db.prepare('SELECT token_hash FROM perangkat_guru WHERE penguji_id = 1').pluck().all() as string[];
    assert.equal(tersimpan.length, 1);
    assert.equal(tersimpan[0]?.includes(k.cookie.get('perangkat_guru') ?? '-'), false, 'yang disimpan hanya sidiknya');
    // Login ulang dari perangkat yang sama memperpanjang, bukan menambah baris.
    await k.minta('POST', '/api/penguji/masuk', { body: { username: 'guru1', password: PASSWORD_GURU } });
    assert.equal(a.db.prepare('SELECT COUNT(*) FROM perangkat_guru').pluck().get(), 1);
  });

  test('perangkat dikenal tetap bisa masuk saat antrean login guru dibanjiri tebakan', async () => {
    const lambat = await mulaiAplikasiUji({ jedaGagalLoginMs: 300 });
    try {
      await isiDataAwal(lambat.db);
      const laptopGuru = lambat.klien();
      const body = { username: 'guru1', password: PASSWORD_GURU };
      assert.equal((await laptopGuru.minta('POST', '/api/penguji/masuk', { body })).status, 204);
      assert.equal((await laptopGuru.minta('POST', '/api/penguji/keluar')).status, 204);

      const banjir = Array.from({ length: 15 }, (_, i) =>
        lambat.klien().minta('POST', '/api/penguji/masuk', { body: { username: 'guru1', password: `tebakan-salah-${i}` } }),
      );
      await new Promise((selesai) => setTimeout(selesai, 50));
      const perangkatBaru = await lambat.klien().minta('POST', '/api/penguji/masuk', { body });
      assert.deepEqual([perangkatBaru.status, perangkatBaru.body], [503, { error: 'server_sibuk' }], 'perangkat baru ikut antre');
      const masuk = await laptopGuru.minta('POST', '/api/penguji/masuk', { body });
      assert.equal(masuk.status, 204, 'laptop guru melewati antrean');
      await Promise.all(banjir);
    } finally {
      lambat.berhenti();
    }
  });

  test('perangkat dikenal: paling banyak 10 per guru (terlama dihapus) dan kedaluwarsa setelah 90 hari', () => {
    for (let i = 0; i < 12; i++) ingatPerangkat(a.db, T0 + i, 1, null, `laptop ${i}`);
    const sisa = a.db.prepare('SELECT info_perangkat FROM perangkat_guru ORDER BY dipakai_at').pluck().all();
    assert.equal(sisa.length, 10);
    assert.equal(sisa[0], 'laptop 2');
    const token = ingatPerangkat(a.db, T0 + 100, 2, null, 'laptop guru2');
    assert.ok(cariPerangkatDikenal(a.db, T0 + 100 + UMUR_PERANGKAT_MS - 1, token));
    assert.equal(cariPerangkatDikenal(a.db, T0 + 100 + UMUR_PERANGKAT_MS, token), null);
  });

  test('perangkat dikenal: salah ketik 2× ditoleransi (reset saat berhasil); 3× berturut-turut → dilupakan', async () => {
    const k = a.klien();
    const benar = { username: 'guru1', password: PASSWORD_GURU };
    const salah = { username: 'guru1', password: 'bukan-password-ini' };
    await k.minta('POST', '/api/penguji/masuk', { body: benar });
    for (let i = 0; i < 2; i++) assert.equal((await k.minta('POST', '/api/penguji/masuk', { body: salah })).status, 401);
    assert.equal(k.cookie.has('perangkat_guru'), true, 'masih dikenal setelah 2× salah');
    assert.equal((await k.minta('POST', '/api/penguji/masuk', { body: benar })).status, 204);
    assert.equal(a.db.prepare('SELECT gagal FROM perangkat_guru').pluck().get(), 0, 'penghitung direset');

    for (let i = 0; i < 3; i++) assert.equal((await k.minta('POST', '/api/penguji/masuk', { body: salah })).status, 401);
    assert.equal(k.cookie.has('perangkat_guru'), false, 'cookie dihapus');
    assert.equal(a.db.prepare('SELECT COUNT(*) FROM perangkat_guru').pluck().get(), 0);
  });

  test('perangkat dikenal: tebakan serentak dengan satu cookie tidak melewati antrean bersama-sama', async () => {
    const lambat = await mulaiAplikasiUji({ jedaGagalLoginMs: 200 });
    try {
      await isiDataAwal(lambat.db);
      const pc = lambat.klien();
      assert.equal((await pc.minta('POST', '/api/penguji/masuk', { body: { username: 'guru1', password: PASSWORD_GURU } })).status, 204);
      const cookie = pc.cookie.get('perangkat_guru') ?? '';
      // 25 tebakan serentak membawa cookie yang sama (mis. dari DevTools di PC kelas).
      const hasil = await Promise.all(
        Array.from({ length: 25 }, (_, i) => {
          const k = lambat.klien();
          k.cookie.set('perangkat_guru', cookie);
          return k.minta('POST', '/api/penguji/masuk', { body: { username: 'guru1', password: `tebakan-salah-${i}` } });
        }),
      );
      const status = hasil.map((r) => r.status);
      // Hanya 1 lewat jalur perangkat; sisanya masuk antrean per username (1 jalan + 10 menunggu), lebihnya 503.
      assert.ok(status.filter((s) => s === 503).length >= 13, `seharusnya banyak 503: ${status.join(',')}`);
      assert.ok(status.filter((s) => s === 401).length <= 12);
    } finally {
      lambat.berhenti();
    }
  });

  test('tebakan paralel untuk satu username diproses berurutan: tiap tebakan menunggu jeda', async () => {
    const lambat = await mulaiAplikasiUji({ jedaGagalLoginMs: 150 });
    try {
      await isiDataAwal(lambat.db);
      const mulai = performance.now();
      const hasil = await Promise.all(
        [1, 2, 3].map((i) =>
          lambat.klien().minta('POST', '/api/penguji/masuk', {
            body: { username: i === 2 ? 'GURU1' : 'guru1', password: `salah-salah-${i}` },
          }),
        ),
      );
      assert.deepEqual(hasil.map((r) => r.status), [401, 401, 401]);
      // Paralel tanpa antrean ≈ 150 ms; berurutan ≥ 3 × 150 ms (huruf besar/kecil dianggap username sama).
      assert.ok(performance.now() - mulai >= 3 * 140, 'tebakan harus antre per username');
    } finally {
      lambat.berhenti();
    }
  });

  test('keluar mencabut sesi: cookie lama tidak bisa dipakai lagi', async () => {
    const k = await masukGuru();
    const cookieLama = k.cookie.get('sesi_guru');
    assert.equal((await k.minta('POST', '/api/penguji/keluar')).status, 204);
    k.cookie.set('sesi_guru', cookieLama ?? '');
    assert.equal((await k.minta('GET', '/api/penguji/saya')).status, 401);
  });

  test('sesi kedaluwarsa setelah 12 jam', async () => {
    const k = await masukGuru();
    a.majukan(12 * 60 * 60 * 1000 + 1);
    assert.equal((await k.minta('GET', '/api/penguji/saya')).status, 401);
  });
});

describe('CSRF: header Origin wajib untuk permintaan pengubah data', () => {
  test('tanpa Origin atau Origin situs lain ditolak 403; GET tidak perlu Origin', async () => {
    const k = a.klien();
    const body = { username: 'guru1', password: PASSWORD_GURU };
    const tanpa = await k.minta('POST', '/api/penguji/masuk', { body, origin: null });
    const asing = await k.minta('POST', '/api/penguji/masuk', { body, origin: 'https://situs-jahat.example' });
    assert.deepEqual([tanpa.status, tanpa.body], [403, { error: 'asal_tidak_sah' }]);
    assert.deepEqual([asing.status, asing.body], [403, { error: 'asal_tidak_sah' }]);
    assert.equal((await k.minta('GET', '/api/health', { origin: null })).status, 200);
  });
});

describe('ORIGIN_PUBLIK (di VPS): cek Origin & cookie Secure tidak bergantung pada header nginx', () => {
  test('Origin harus sama dengan ORIGIN_PUBLIK; cookie diberi Secure walau tanpa X-Forwarded-Proto', async () => {
    const vps = await mulaiAplikasiUji({}, { ORIGIN_PUBLIK: 'https://ujian.contoh.id', TRUST_PROXY: 'true' });
    try {
      await isiDataAwal(vps.db);
      const body = { username: 'guru1', password: PASSWORD_GURU };
      // Origin alamat lokal (seperti Host dari $proxy_host) ditolak.
      const lokal = await vps.klien().minta('POST', '/api/penguji/masuk', { body });
      assert.deepEqual([lokal.status, lokal.body], [403, { error: 'asal_tidak_sah' }]);
      const r = await vps.klien().minta('POST', '/api/penguji/masuk', { body, origin: 'https://ujian.contoh.id' });
      assert.equal(r.status, 204);
      assert.match(r.header.get('set-cookie') ?? '', /; Secure/);
    } finally {
      vps.berhenti();
    }
  });
});

describe('daftar nama siswa', () => {
  test('kode benar (huruf kecil/tanda hubung dirapikan) → judul + daftar nama tanpa data rahasia', async () => {
    a.db.prepare("UPDATE peserta SET pin_hash = 'scrypt$x', pin_dibuat_at = ? WHERE id = 2").run(T0);
    const r = await a.klien().minta('POST', '/api/peserta/daftar-nama', { body: { kode: ' abc-234 ' } });
    assert.equal(r.status, 200);
    // .strict(): field tambahan (pin_hash, id_anonim, status) akan membuat parse gagal.
    const isi = DaftarNamaResponsSchema.parse(r.body);
    assert.equal(isi.judul, 'Latihan Ekonomi');
    assert.deepEqual(
      isi.peserta.map((p) => [p.nama, p.punya_pin]),
      [['Ani', true], ['Budi', false], ['Cici', false]],
    );
    assert.doesNotMatch(JSON.stringify(r.body), /scrypt|anon-/);
  });

  test('kode salah dan ujian draf sama-sama dijawab kode_salah', async () => {
    a.db.prepare("UPDATE ujian SET status = 'draf', dibuka_at = NULL WHERE id = 1").run();
    const draf = await a.klien().minta('POST', '/api/peserta/daftar-nama', { body: { kode: 'ABC234' } });
    const salah = await a.klien().minta('POST', '/api/peserta/daftar-nama', { body: { kode: 'QQQQQQ' } });
    assert.deepEqual([draf.status, draf.body], [404, { error: 'kode_salah' }]);
    assert.deepEqual([salah.status, salah.body], [404, { error: 'kode_salah' }]);
  });

  test('kode salah dijawab setelah jeda; banjir kode salah dari IP yang sama tidak menghalangi kode benar', async () => {
    const lambat = await mulaiAplikasiUji({ jedaKodeSalahMs: 150 });
    try {
      await isiDataAwal(lambat.db);
      const k = lambat.klien();
      const mulai = performance.now();
      const banjir = await Promise.all(
        Array.from({ length: 50 }, () => k.minta('POST', '/api/peserta/daftar-nama', { body: { kode: 'QQQQQQ' } })),
      );
      assert.ok(banjir.every((r) => r.status === 404));
      assert.ok(performance.now() - mulai >= 140, 'kode salah harus menunggu jeda');
      const benar = await lambat.klien().minta('POST', '/api/peserta/daftar-nama', { body: { kode: 'ABC234' } });
      assert.equal(benar.status, 200);
    } finally {
      lambat.berhenti();
    }
  });
});

describe('masuk siswa dengan PIN buatan sendiri', () => {
  test('pertama kali: PIN wajib diketik dua kali dan sama', async () => {
    const { r } = await masukSiswa(1, '4821', '4822');
    assert.deepEqual([r.status, r.body], [400, { error: 'pin_tidak_sama' }]);
    const tanpaUlang = await masukSiswa(1, '4821');
    assert.equal(tanpaUlang.r.status, 400);
  });

  test('membuat PIN → masuk; status jadi menunggu; PIN tersimpan sebagai hash', async () => {
    const { k, r } = await masukSiswa(1, '4821', '4821');
    assert.equal(r.status, 204);
    const saya = await k.minta('GET', '/api/peserta/saya');
    assert.deepEqual(PesertaSayaSchema.parse(saya.body), {
      nama: 'Budi', nomor: '01', status: 'menunggu', ujian: { judul: 'Latihan Ekonomi', status: 'menunggu' },
    });
    const hash = a.db.prepare('SELECT pin_hash FROM peserta WHERE id = 1').pluck().get() as string;
    assert.match(hash, /^scrypt\$/);
    assert.equal(hash.includes('4821'), false);
  });

  test('masuk berikutnya cukup PIN; PIN salah memberi sisa percobaan', async () => {
    await masukSiswa(1, '4821', '4821');
    const salah = await masukSiswa(1, '0000');
    assert.deepEqual([salah.r.status, salah.r.body], [401, { error: 'pin_salah', sisa: 4 }]);
    const benar = await masukSiswa(1, '4821');
    assert.equal(benar.r.status, 204);
    assert.equal(a.db.prepare('SELECT pin_gagal FROM peserta WHERE id = 1').pluck().get(), 0, 'gagal direset setelah berhasil');
  });

  test('5 kali PIN salah → terkunci, PIN benar pun ditolak; guru membuka kunci → bisa masuk', async () => {
    await masukSiswa(1, '4821', '4821');
    for (let i = 0; i < 4; i++) assert.equal((await masukSiswa(1, '0000')).r.status, 401);
    const kelima = await masukSiswa(1, '0000');
    assert.deepEqual([kelima.r.status, kelima.r.body], [423, { error: 'terkunci' }]);
    assert.equal((await masukSiswa(1, '4821')).r.status, 423);
    const log = a.db.prepare('SELECT aktor, aksi, detail_json FROM log_aksi WHERE ujian_id = 1').all() as {
      aktor: string;
      aksi: string;
      detail_json: string;
    }[];
    assert.equal(log.length, 1, 'penguncian tercatat sekali');
    assert.deepEqual([log[0]?.aktor, log[0]?.aksi], ['server', 'pin_terkunci']);
    assert.equal(JSON.parse(log[0]?.detail_json ?? '{}').peserta_id, 1);

    const guru = await masukGuru();
    assert.equal((await guru.minta('POST', '/api/ujian/1/peserta/1/buka-kunci')).status, 204);
    assert.equal((await masukSiswa(1, '4821')).r.status, 204);
  });

  test('PIN benar pada percobaan ke-5 tetap masuk dan penghitung kembali 0', async () => {
    await masukSiswa(1, '4821', '4821');
    for (let i = 0; i < 4; i++) assert.equal((await masukSiswa(1, '0000')).r.status, 401);
    assert.equal((await masukSiswa(1, '4821')).r.status, 204);
    assert.deepEqual({ ...(a.db.prepare('SELECT pin_gagal, terkunci_at FROM peserta WHERE id = 1').get() as object) }, {
      pin_gagal: 0,
      terkunci_at: null,
    });
    assert.equal(a.db.prepare("SELECT COUNT(*) FROM log_aksi WHERE aksi = 'pin_terkunci'").pluck().get(), 0);
  });

  test('tebakan PIN serentak: paling banyak 5 yang dicek, tidak pernah 500, kunci tercatat sekali', async () => {
    await masukSiswa(1, '4821', '4821');
    const tebakan = Array.from({ length: 30 }, (_, i) => String(1000 + i));
    const hasil = await Promise.all(tebakan.map((pin) => masukSiswa(1, pin)));
    const status = hasil.map((h) => h.r.status);
    assert.equal(status.filter((s) => s === 401).length, 4, 'tepat 4 jawaban "PIN salah", sisanya terkunci');
    assert.equal(status.filter((s) => s === 423).length, 26);
    assert.equal(a.db.prepare("SELECT COUNT(*) FROM log_aksi WHERE aksi = 'pin_terkunci'").pluck().get(), 1);
  });

  test('PIN benar di tengah tebakan serentak: dijawab 204 atau 423, bukan 500 yang membocorkan PIN', async () => {
    await masukSiswa(1, '4821', '4821');
    const tebakan = Array.from({ length: 30 }, (_, i) => (i === 15 ? '4821' : String(2000 + i)));
    const hasil = await Promise.all(tebakan.map((pin) => masukSiswa(1, pin)));
    const status = hasil.map((h) => h.r.status);
    assert.ok(status.every((s) => s === 401 || s === 423 || s === 204), `status tak terduga: ${status.join(',')}`);
    assert.ok(status.filter((s) => s === 401).length <= 4);
    assert.ok([204, 423].includes(status[15] ?? 0));
  });

  test('login baru mengambil alih: sesi lama dicabut dan event masuk_ulang tercatat', async () => {
    const pertama = await masukSiswa(1, '4821', '4821');
    const kedua = await masukSiswa(1, '4821');
    assert.equal(kedua.r.status, 204);
    assert.equal((await pertama.k.minta('GET', '/api/peserta/saya')).status, 401);
    assert.equal((await kedua.k.minta('GET', '/api/peserta/saya')).status, 200);
    const event = a.db.prepare("SELECT jenis, ujian_id, detail_json FROM event_integritas WHERE peserta_id = 1").all();
    assert.equal(event.length, 1);
    assert.equal((event[0] as { jenis: string }).jenis, 'masuk_ulang');
  });

  test('siswa terlambat saat ujian berlangsung langsung berstatus mengerjakan', async () => {
    a.db.prepare("UPDATE ujian SET status = 'berlangsung', dimulai_at = ?, detak_at = ? WHERE id = 1").run(T0, T0);
    const { k } = await masukSiswa(2, '1111', '1111');
    const saya = PesertaSayaSchema.parse((await k.minta('GET', '/api/peserta/saya')).body);
    assert.equal(saya.status, 'mengerjakan');
  });

  test('peserta dari ujian lain tidak bisa dipakai dengan kode ujian ini', async () => {
    const { r } = await masukSiswa(4, '1111', '1111');
    assert.deepEqual([r.status, r.body], [404, { error: 'tidak_ditemukan' }]);
  });

  test('PIN harus tepat 4 angka', async () => {
    for (const pin of ['123', '12345', 'abcd']) {
      assert.equal((await masukSiswa(1, pin, pin)).r.status, 400, pin);
    }
  });
});

describe('reset PIN oleh guru', () => {
  test('guru pemilik: PIN dihapus, sesi siswa dicabut, aksi tercatat; siswa membuat PIN baru', async () => {
    const siswa = await masukSiswa(1, '4821', '4821');
    const guru = await masukGuru();
    assert.equal((await guru.minta('POST', '/api/ujian/1/peserta/1/reset-pin')).status, 204);
    assert.equal((await siswa.k.minta('GET', '/api/peserta/saya')).status, 401);
    assert.equal(a.db.prepare('SELECT pin_hash FROM peserta WHERE id = 1').pluck().get(), null);
    assert.equal(a.db.prepare("SELECT aksi FROM log_aksi WHERE ujian_id = 1").pluck().get(), 'reset_pin');
    assert.equal((await masukSiswa(1, '7777', '7777')).r.status, 204);
  });

  test('reset PIN bersamaan dengan login: tidak pernah tersisa sesi dari PIN yang sudah dihapus', async () => {
    for (let ulang = 0; ulang < 5; ulang++) {
      a.db.prepare('UPDATE peserta SET pin_hash = NULL, pin_dibuat_at = NULL WHERE id = 1').run();
      await masukSiswa(1, '4821', '4821');
      const guru = await masukGuru();
      const [login, reset] = await Promise.all([
        masukSiswa(1, '4821'),
        guru.minta('POST', '/api/ujian/1/peserta/1/reset-pin'),
      ]);
      assert.equal(reset.status, 204);
      // 400 = reset selesai sebelum login dimulai, jadi nama ini dianggap belum punya PIN (pin_ulang wajib).
      assert.ok([204, 400, 409].includes(login.r.status), `status login: ${login.r.status}`);
      if (login.r.status === 409) assert.deepEqual(login.r.body, { error: 'pin_berubah' });
      // Bila login selesai lebih dulu, reset mencabut sesinya; bila kalah, tidak ada sesi sama sekali.
      assert.equal((await login.k.minta('GET', '/api/peserta/saya')).status, 401);
    }
  });

  test('ujian masih draf → 409 status_tidak_sesuai', async () => {
    a.db.prepare("UPDATE ujian SET status = 'draf', dibuka_at = NULL WHERE id = 1").run();
    const guru = await masukGuru();
    for (const aksi of ['reset-pin', 'buka-kunci']) {
      const r = await guru.minta('POST', `/api/ujian/1/peserta/1/${aksi}`);
      assert.deepEqual([r.status, r.body], [409, { error: 'status_tidak_sesuai' }], aksi);
    }
  });

  test('guru lain atau peserta dari ujian lain → 404 (keberadaan tidak dibocorkan)', async () => {
    const guru2 = await masukGuru('guru2');
    assert.equal((await guru2.minta('POST', '/api/ujian/1/peserta/1/reset-pin')).status, 404);
    const guru1 = await masukGuru();
    assert.equal((await guru1.minta('POST', '/api/ujian/1/peserta/4/reset-pin')).status, 404);
  });
});

describe('pemisahan lingkup sesi', () => {
  test('cookie siswa tidak membuka endpoint guru, dan sebaliknya', async () => {
    const { k: siswa } = await masukSiswa(1, '4821', '4821');
    assert.equal((await siswa.minta('GET', '/api/penguji/saya')).status, 401);
    assert.equal((await siswa.minta('POST', '/api/ujian/1/tautan-proyektor')).status, 401);
    const guru = await masukGuru();
    assert.equal((await guru.minta('GET', '/api/peserta/saya')).status, 401);
    assert.equal((await guru.minta('GET', '/api/proyektor/saya')).status, 401);
  });

  test('login siswa di browser guru tidak mengeluarkan guru (cookie terpisah)', async () => {
    const guru = await masukGuru();
    await masukSiswa(1, '4821', '4821', guru);
    assert.equal((await guru.minta('GET', '/api/penguji/saya')).status, 200);
    assert.equal((await guru.minta('GET', '/api/peserta/saya')).status, 200);
  });
});

describe('layar proyektor', () => {
  async function buatKode(guru: Klien): Promise<string> {
    const r = await guru.minta('POST', '/api/ujian/1/tautan-proyektor');
    assert.equal(r.status, 200);
    const { kode, kedaluwarsa_at } = r.body as { kode: string; kedaluwarsa_at: number };
    assert.match(kode, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    assert.equal(kedaluwarsa_at, T0 + 10 * 60_000);
    return kode;
  }

  test('kode sekali pakai → sesi proyektor (cookie Path=/api/proyektor) yang hanya melihat ujian itu', async () => {
    const guru = await masukGuru();
    const kode = await buatKode(guru);
    const layar = a.klien();
    const r = await layar.minta('POST', '/api/proyektor/masuk', { body: { kode: kode.toLowerCase() } });
    assert.equal(r.status, 204);
    assert.match(r.header.getSetCookie().join('\n'), /sesi_proyektor=.*Path=\/api\/proyektor/);
    const saya = await layar.minta('GET', '/api/proyektor/saya');
    assert.deepEqual(ProyektorSayaSchema.parse(saya.body), { ujian: { judul: 'Latihan Ekonomi', status: 'menunggu' } });
    // Kode yang sama tidak bisa dipakai lagi.
    assert.equal((await a.klien().minta('POST', '/api/proyektor/masuk', { body: { kode } })).status, 404);
    // Sesi proyektor tidak punya identitas guru.
    const baris = a.db.prepare("SELECT penguji_id FROM sesi WHERE lingkup = 'proyektor'").get() as { penguji_id: number | null };
    assert.equal(baris.penguji_id, null);
  });

  test('kode kedaluwarsa setelah 10 menit', async () => {
    const guru = await masukGuru();
    const kode = await buatKode(guru);
    a.majukan(10 * 60_000);
    assert.equal((await a.klien().minta('POST', '/api/proyektor/masuk', { body: { kode } })).status, 404);
  });

  test('guru mencabut proyektor → layar kehilangan akses', async () => {
    const guru = await masukGuru();
    const layar = a.klien();
    await layar.minta('POST', '/api/proyektor/masuk', { body: { kode: await buatKode(guru) } });
    assert.equal((await guru.minta('POST', '/api/ujian/1/proyektor/cabut')).status, 204);
    assert.equal((await layar.minta('GET', '/api/proyektor/saya')).status, 401);
  });

  test('guru lain tidak bisa membuat kode untuk ujian ini; tebakan kode salah dijawab kode_salah', async () => {
    const guru2 = await masukGuru('guru2');
    assert.equal((await guru2.minta('POST', '/api/ujian/1/tautan-proyektor')).status, 404);
    const r = await a.klien().minta('POST', '/api/proyektor/masuk', { body: { kode: 'AAAAAAAA' } });
    assert.deepEqual([r.status, r.body], [404, { error: 'kode_salah' }]);
  });
});
