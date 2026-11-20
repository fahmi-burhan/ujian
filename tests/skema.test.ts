// tests/skema.test.ts — memastikan skema awal (migrations/0001) menegakkan aturan bisnis penting.
// Dipanggil oleh: `npm test`. Memanggil: migrasi sungguhan dari folder migrations/ ke database di RAM.
// Tujuannya: bug di kode server nanti tidak bisa menyimpan keadaan yang mustahil (mis. ujian dijeda
// tanpa waktu jeda, jawaban untuk soal ujian lain), karena database sendiri menolaknya.
// Beberapa tes juga menjadi CONTOH POLA QUERY yang wajib ditiru kode server (ditandai "Pola server").
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db/connection.ts';
import type { Db } from '../server/db/connection.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { MIGRATIONS_DIR } from '../server/paths.ts';

let db: Db;
const T = 1_795_000_000_000;
const DITOLAK = /CHECK constraint failed|UNIQUE constraint failed|cannot store|NOT NULL constraint failed|FOREIGN KEY constraint failed/;

function run(sql: string, ...params: unknown[]): number {
  return db.prepare(sql).run(...params).changes;
}

function count(table: string): number {
  return db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() as number;
}

// Mengubah ujian 1 menjadi 'berlangsung' secara sah (semua kolom wajib terisi).
function mulaiUjian1(): void {
  run("UPDATE ujian SET status = 'menunggu', dibuka_at = ? WHERE id = 1", T);
  run("UPDATE ujian SET status = 'berlangsung', dimulai_at = ?, detak_at = ? WHERE id = 1", T, T);
}

// Dua ujian milik satu guru: ujian 1 (soal 1, PDF 1, peserta 1) dan ujian 2 (soal 2, PDF 2, peserta 2).
beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  run("INSERT INTO penguji (id, username, nama, password_hash, dibuat_at) VALUES (1, 'guru1', 'Bu Guru', 'scrypt$x', ?)", T);
  for (const [id, kode] of [[1, 'ABC234'], [2, 'XYZ789']] as const) {
    run(
      'INSERT INTO ujian (id, penguji_id, judul, kode, durasi_menit, dibuat_at, diubah_at) VALUES (?, 1, ?, ?, 90, ?, ?)',
      id, `Latihan ${id}`, kode, T, T,
    );
    run(
      "INSERT INTO pdf (id, ujian_id, nama_tampil, nama_berkas, ukuran_byte, sha256, diunggah_at) VALUES (?, ?, 'Buku', ?, 10, ?, ?)",
      id, id, `acak-${id}.pdf`, 'a'.repeat(64), T,
    );
    run(
      "INSERT INTO soal (id, ujian_id, urutan, judul, teks, pdf_id, dibuat_at, diubah_at) VALUES (?, ?, 1, 'Studi kasus', 'Teks', ?, ?, ?)",
      id, id, id, T, T,
    );
    run("INSERT INTO peserta (id, ujian_id, nama, id_anonim, dibuat_at) VALUES (?, ?, 'Budi', ?, ?)", id, id, `anon-${id}`, T);
  }
});

afterEach(() => db.close());

describe('struktur', () => {
  test('semua tabel dibuat sebagai STRICT', () => {
    const tables = db
      .prepare("SELECT name, strict FROM pragma_table_list WHERE schema = 'main' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'")
      .all() as { name: string; strict: number }[];
    assert.deepEqual(tables.map((t) => t.name).sort(), [
      'event_integritas', 'jawaban', 'jawaban_terlambat', 'jawaban_versi', 'log_aksi', 'pdf',
      'penguji', 'peserta', 'sesi', 'soal', 'tautan_proyektor', 'ujian',
    ]);
    for (const t of tables) assert.equal(t.strict, 1, `${t.name} harus STRICT`);
  });

  test('STRICT menolak teks di kolom angka', () => {
    assert.throws(() => run("UPDATE ujian SET durasi_menit = 'sembilan puluh' WHERE id = 1"), DITOLAK);
  });

  test('foreign key valid untuk seluruh data awal', () => {
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  });
});

describe('ujian: status konsisten dengan kolom waktu', () => {
  test('status hanya boleh salah satu dari 7 fase', () => {
    assert.throws(() => run("UPDATE ujian SET status = 'mulai' WHERE id = 1"), DITOLAK);
  });

  test('kode ujian hanya dari alfabet tanpa huruf mirip', () => {
    for (const kode of ['abc234', 'ABC10O', 'AB-234', 'ABC23']) {
      assert.throws(() => run('UPDATE ujian SET kode = ? WHERE id = 1', kode), DITOLAK, kode);
    }
  });

  test('menunggu wajib punya dibuka_at, tanpa dimulai_at/detak/jeda/perpanjangan', () => {
    assert.throws(() => run("UPDATE ujian SET status = 'menunggu' WHERE id = 1"), DITOLAK);
    run("UPDATE ujian SET status = 'menunggu', dibuka_at = ? WHERE id = 1", T);
    assert.throws(() => run('UPDATE ujian SET dimulai_at = ? WHERE id = 1', T), DITOLAK);
    assert.throws(() => run('UPDATE ujian SET detak_at = ? WHERE id = 1', T), DITOLAK);
    assert.throws(() => run('UPDATE ujian SET perpanjangan_ms = 60000 WHERE id = 1'), DITOLAK);
  });

  test('berlangsung wajib punya dibuka_at, dimulai_at, dan detak_at; tanpa diakhiri_at', () => {
    run("UPDATE ujian SET status = 'menunggu', dibuka_at = ? WHERE id = 1", T);
    // Lupa detak_at = celah K2 (jeda otomatis tidak jalan) → ditolak.
    assert.throws(() => run("UPDATE ujian SET status = 'berlangsung', dimulai_at = ? WHERE id = 1", T), DITOLAK);
    run("UPDATE ujian SET status = 'berlangsung', dimulai_at = ?, detak_at = ? WHERE id = 1", T, T);
    assert.throws(() => run('UPDATE ujian SET diakhiri_at = ? WHERE id = 1', T + 1), DITOLAK);
    assert.throws(() => run('UPDATE ujian SET detak_at = ? WHERE id = 1', T - 1), DITOLAK);
  });

  test('dimulai_at tidak boleh sebelum dibuka_at', () => {
    run("UPDATE ujian SET status = 'menunggu', dibuka_at = ? WHERE id = 1", T);
    assert.throws(
      () => run("UPDATE ujian SET status = 'berlangsung', dimulai_at = ?, detak_at = ? WHERE id = 1", T - 1, T),
      DITOLAK,
    );
  });

  test('dijeda_at terisi jika dan hanya jika dijeda, dan tidak sebelum dimulai', () => {
    mulaiUjian1();
    assert.throws(() => run("UPDATE ujian SET status = 'dijeda' WHERE id = 1"), DITOLAK);
    assert.throws(() => run('UPDATE ujian SET dijeda_at = ? WHERE id = 1', T), DITOLAK);
    assert.throws(() => run("UPDATE ujian SET status = 'dijeda', dijeda_at = ? WHERE id = 1", T - 1), DITOLAK);
    run("UPDATE ujian SET status = 'dijeda', dijeda_at = ? WHERE id = 1", T + 1000);
  });

  test('Pola server: jeda otomatis setelah server mati memakai dijeda_at = detak_at', () => {
    mulaiUjian1();
    run('UPDATE ujian SET detak_at = ? WHERE id = 1', T + 60_000);
    const changed = run(
      "UPDATE ujian SET status = 'dijeda', dijeda_at = detak_at WHERE status = 'berlangsung' AND ? - detak_at > 15000",
      T + 200_000,
    );
    assert.equal(changed, 1);
    assert.equal(db.prepare('SELECT dijeda_at FROM ujian WHERE id = 1').pluck().get(), T + 60_000);
  });

  test('akhiri dari dijeda wajib mengosongkan dijeda_at (efek di DESAIN §3)', () => {
    mulaiUjian1();
    run("UPDATE ujian SET status = 'dijeda', dijeda_at = ? WHERE id = 1", T + 5);
    assert.throws(() => run("UPDATE ujian SET status = 'selesai', diakhiri_at = ? WHERE id = 1", T + 9), DITOLAK);
    run(
      "UPDATE ujian SET status = 'selesai', diakhiri_at = ?, total_jeda_ms = total_jeda_ms + 4, dijeda_at = NULL WHERE id = 1",
      T + 9,
    );
  });

  test('dirilis wajib punya dirilis_at, dan tarik rilis mengosongkannya', () => {
    mulaiUjian1();
    run("UPDATE ujian SET status = 'penilaian', diakhiri_at = ? WHERE id = 1", T + 1);
    assert.throws(() => run("UPDATE ujian SET status = 'dirilis' WHERE id = 1"), DITOLAK);
    run("UPDATE ujian SET status = 'dirilis', dirilis_at = ? WHERE id = 1", T + 2);
    assert.throws(() => run("UPDATE ujian SET status = 'penilaian' WHERE id = 1"), DITOLAK);
    run("UPDATE ujian SET status = 'penilaian', dirilis_at = NULL WHERE id = 1");
  });
});

describe('peserta & PIN', () => {
  test('nama + nomor unik per ujian tanpa membedakan huruf besar/kecil', () => {
    assert.throws(
      () => run("INSERT INTO peserta (ujian_id, nama, id_anonim, dibuat_at) VALUES (1, 'BUDI', 'anon-9', ?)", T),
      DITOLAK,
    );
    // Nama sama tapi nomor absen berbeda = dua siswa berbeda.
    run("INSERT INTO peserta (ujian_id, nama, nomor, id_anonim, dibuat_at) VALUES (1, 'Budi', '12', 'anon-9', ?)", T);
  });

  test('PIN hanya disimpan sebagai hash scrypt, dengan waktu pembuatannya', () => {
    assert.throws(() => run("UPDATE peserta SET pin_hash = '1234', pin_dibuat_at = ? WHERE id = 1", T), DITOLAK);
    assert.throws(() => run("UPDATE peserta SET pin_hash = 'scrypt$x' WHERE id = 1"), DITOLAK);
    run("UPDATE peserta SET pin_hash = 'scrypt$x', pin_dibuat_at = ? WHERE id = 1", T);
  });

  test('terkunci tepat saat 5 kali PIN salah, tidak lebih', () => {
    run('UPDATE peserta SET pin_gagal = 4 WHERE id = 1');
    assert.throws(() => run('UPDATE peserta SET pin_gagal = 5 WHERE id = 1'), DITOLAK);
    run('UPDATE peserta SET pin_gagal = 5, terkunci_at = ? WHERE id = 1', T);
    assert.throws(() => run('UPDATE peserta SET pin_gagal = 6 WHERE id = 1'), DITOLAK);
    // Buka kunci oleh guru.
    run('UPDATE peserta SET pin_gagal = 0, terkunci_at = NULL WHERE id = 1');
  });

  test('dikumpulkan wajib disertai cara & waktu kumpul; buka kembali mengosongkan keduanya', () => {
    run("UPDATE peserta SET status = 'mengerjakan', masuk_pertama_at = ? WHERE id = 1", T);
    assert.throws(() => run("UPDATE peserta SET status = 'dikumpulkan' WHERE id = 1"), DITOLAK);
    assert.throws(
      () => run("UPDATE peserta SET status = 'dikumpulkan', cara_kumpul = 'manual', dikumpulkan_at = ? WHERE id = 1", T - 1),
      DITOLAK,
    );
    run("UPDATE peserta SET status = 'dikumpulkan', cara_kumpul = 'manual', dikumpulkan_at = ? WHERE id = 1", T);
    run("UPDATE peserta SET status = 'mengerjakan', cara_kumpul = NULL, dikumpulkan_at = NULL WHERE id = 1");
  });

  test('Pola server: akhiri ujian hanya mengumpulkan yang mengerjakan; belum_masuk tetap (tidak hadir)', () => {
    run(
      "INSERT INTO peserta (id, ujian_id, nama, id_anonim, status, masuk_pertama_at, dibuat_at) VALUES (3, 1, 'Cici', 'anon-3', 'mengerjakan', ?, ?)",
      T, T,
    );
    mulaiUjian1();
    db.transaction(() => {
      run("UPDATE ujian SET status = 'selesai', diakhiri_at = ? WHERE id = 1", T + 10);
      run(
        "UPDATE peserta SET status = 'dikumpulkan', cara_kumpul = 'diakhiri_penguji', dikumpulkan_at = ? WHERE ujian_id = 1 AND status = 'mengerjakan'",
        T + 10,
      );
    })();
    const rows = db.prepare('SELECT id, status FROM peserta WHERE ujian_id = 1 ORDER BY id').all();
    assert.deepEqual(rows, [{ id: 1, status: 'belum_masuk' }, { id: 3, status: 'dikumpulkan' }]);
    // Mengumpulkan peserta yang belum pernah masuk ditolak database.
    assert.throws(
      () => run("UPDATE peserta SET status = 'dikumpulkan', cara_kumpul = 'diakhiri_penguji', dikumpulkan_at = ? WHERE id = 1", T),
      DITOLAK,
    );
  });
});

describe('isolasi antar-ujian (FK komposit)', () => {
  test('jawaban tidak bisa menunjuk soal dari ujian lain', () => {
    assert.throws(
      () => run("INSERT INTO jawaban (ujian_id, peserta_id, soal_id, isi, diubah_at) VALUES (1, 1, 2, 'x', ?)", T),
      DITOLAK,
    );
    assert.throws(
      () => run("INSERT INTO jawaban (ujian_id, peserta_id, soal_id, isi, diubah_at) VALUES (2, 1, 2, 'x', ?)", T),
      DITOLAK,
    );
    run("INSERT INTO jawaban (ujian_id, peserta_id, soal_id, isi, diubah_at) VALUES (1, 1, 1, 'x', ?)", T);
  });

  test('soal tidak bisa menunjuk PDF dari ujian lain', () => {
    assert.throws(() => run('UPDATE soal SET pdf_id = 2 WHERE id = 1'), DITOLAK);
  });

  test('event tidak bisa memakai ujian_id yang bukan ujian peserta', () => {
    assert.throws(
      () => run("INSERT INTO event_integritas (ujian_id, peserta_id, jenis, mulai_at) VALUES (2, 1, 'koneksi_putus', ?)", T),
      DITOLAK,
    );
  });

  test('jawaban terlambat juga terikat ke ujian yang sama', () => {
    const insert = "INSERT INTO jawaban_terlambat (ujian_id, peserta_id, soal_id, isi, versi_dasar, id_simpan, diterima_at, alasan) VALUES (1, 1, ?, 'x', 0, ?, ?, 'waktu_habis')";
    assert.throws(() => run(insert, 2, 'simpan-0001', T), DITOLAK);
    run(insert, 1, 'simpan-0001', T);
  });

  test('PDF yang masih dirujuk soal tidak bisa dihapus; setelah rujukan dikosongkan bisa', () => {
    assert.throws(() => run('DELETE FROM pdf WHERE id = 1'), DITOLAK);
    run('UPDATE soal SET pdf_id = NULL, pdf_halaman = NULL WHERE pdf_id = 1');
    run('DELETE FROM pdf WHERE id = 1');
  });
});

describe('sesi & proyektor', () => {
  const insert = (lingkup: string, penguji: number | null, peserta: number | null, ujian: number | null, hash: string) =>
    run(
      'INSERT INTO sesi (id_hash, lingkup, penguji_id, peserta_id, ujian_id, dibuat_at, terakhir_aktif_at, kedaluwarsa_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      hash.repeat(64), lingkup, penguji, peserta, ujian, T, T, T + 1,
    );

  test('setiap lingkup punya tepat pemilik yang sesuai', () => {
    insert('penguji', 1, null, null, 'a');
    insert('peserta', null, 1, null, 'b');
    insert('proyektor', null, null, 1, 'c');
    assert.throws(() => insert('penguji', 1, 1, null, 'd'), DITOLAK);
    assert.throws(() => insert('peserta', null, null, null, 'e'), DITOLAK);
    // Sesi proyektor TIDAK boleh membawa identitas guru.
    assert.throws(() => insert('proyektor', 1, null, 1, 'f'), DITOLAK);
    assert.throws(() => insert('admin', 1, null, null, '0'), DITOLAK);
  });

  test('tab_aktif hanya untuk sesi peserta', () => {
    insert('penguji', 1, null, null, 'a');
    assert.throws(() => run("UPDATE sesi SET tab_aktif = 'tab-12345678' WHERE lingkup = 'penguji'"), DITOLAK);
  });

  test('guru bisa mencabut sesi proyektor', () => {
    insert('proyektor', null, null, 1, 'c');
    run("UPDATE sesi SET dicabut_at = ?, alasan_cabut = 'dicabut_penguji' WHERE lingkup = 'proyektor' AND ujian_id = 1", T);
  });

  test('sesi & kode proyektor tidak boleh kedaluwarsa sebelum dibuat', () => {
    assert.throws(
      () => run("INSERT INTO sesi (id_hash, lingkup, penguji_id, dibuat_at, terakhir_aktif_at, kedaluwarsa_at) VALUES (?, 'penguji', 1, ?, ?, ?)", 'z'.repeat(64), T, T, T),
      DITOLAK,
    );
    assert.throws(
      () => run('INSERT INTO tautan_proyektor (kode_hash, ujian_id, dibuat_at, kedaluwarsa_at, dipakai_at) VALUES (?, 1, ?, ?, ?)', 'y'.repeat(64), T, T + 10, T - 1),
      DITOLAK,
    );
  });
});

describe('jawaban, riwayat, event (pola query server)', () => {
  test('rubrik_json harus JSON yang valid', () => {
    assert.throws(() => run("UPDATE soal SET rubrik_json = '{rusak' WHERE id = 1"), DITOLAK);
  });

  test('Pola server: riwayat ditulis dengan ON CONFLICT DO NOTHING, yang tetap menolak pelanggaran CHECK', () => {
    run("INSERT INTO jawaban (ujian_id, peserta_id, soal_id, isi, versi, diubah_at) VALUES (1, 1, 1, 'isi', 3, ?)", T);
    const tulisRiwayat = `INSERT INTO jawaban_versi (peserta_id, soal_id, versi, isi, alasan, disimpan_at)
      VALUES (1, 1, 3, 'isi', ?, ?) ON CONFLICT (peserta_id, soal_id, versi) DO NOTHING`;
    assert.equal(run(tulisRiwayat, 'berkala', T), 1);
    assert.equal(run(tulisRiwayat, 'kumpul', T), 0, 'versi yang sama dilewati tanpa galat');
    // Berbeda dengan INSERT OR IGNORE: alasan salah ketik TETAP melempar galat, jadi bug terlihat.
    run('DELETE FROM jawaban_versi');
    assert.throws(() => run(tulisRiwayat, 'kumpull', T), DITOLAK);
  });

  test('jawaban terlambat idempoten: kiriman ulang dengan id_simpan sama tidak menambah baris', () => {
    const tulis = `INSERT INTO jawaban_terlambat (ujian_id, peserta_id, soal_id, isi, versi_dasar, id_simpan, diterima_at, alasan)
      VALUES (1, 1, 1, 'x', 0, 'simpan-0001', ?, 'waktu_habis') ON CONFLICT (peserta_id, id_simpan) DO NOTHING`;
    run(tulis, T);
    run(tulis, T + 1);
    run(tulis, T + 2);
    assert.equal(count('jawaban_terlambat'), 1);
  });

  test('Pola server: UPSERT event tidak membuka ulang event yang sudah selesai (urutan laporan terbalik aman)', () => {
    const upsert = `INSERT INTO event_integritas (ujian_id, peserta_id, id_klien, jenis, mulai_at, selesai_at, durasi_ms)
      VALUES (1, 1, 'uuid-0001', 'tab_tersembunyi', ?, ?, ?)
      ON CONFLICT (peserta_id, id_klien) DO UPDATE SET
        selesai_at = COALESCE(event_integritas.selesai_at, excluded.selesai_at),
        durasi_ms = COALESCE(event_integritas.durasi_ms, excluded.durasi_ms)`;
    // Laporan "selesai" tiba lebih dulu, lalu laporan "mulai" yang tertahan.
    run(upsert, T, T + 12_000, 12_000);
    run(upsert, T + 13_000, null, null);
    assert.deepEqual(db.prepare('SELECT selesai_at, durasi_ms FROM event_integritas').all(), [{ selesai_at: T + 12_000, durasi_ms: 12_000 }]);
    // Event dari server (id_klien NULL) boleh banyak.
    run("INSERT INTO event_integritas (ujian_id, peserta_id, jenis, mulai_at) VALUES (1, 1, 'koneksi_putus', ?)", T);
    run("INSERT INTO event_integritas (ujian_id, peserta_id, jenis, mulai_at) VALUES (1, 1, 'koneksi_putus', ?)", T);
    assert.equal(count('event_integritas'), 3);
  });

  test('log_aksi: aksi guru wajib punya penguji_id, aksi server tidak', () => {
    run("INSERT INTO log_aksi (ujian_id, aktor, penguji_id, aksi, dibuat_at) VALUES (1, 'penguji', 1, 'mulai', ?)", T);
    run("INSERT INTO log_aksi (ujian_id, aktor, aksi, dibuat_at) VALUES (1, 'server', 'jeda_otomatis', ?)", T);
    assert.throws(() => run("INSERT INTO log_aksi (ujian_id, aktor, aksi, dibuat_at) VALUES (1, 'penguji', 'mulai', ?)", T), DITOLAK);
  });
});

describe('penghapusan', () => {
  test('menghapus ujian ikut menghapus semua datanya (termasuk PDF yang dirujuk soal)', () => {
    run("INSERT INTO jawaban (ujian_id, peserta_id, soal_id, isi, versi, diubah_at) VALUES (1, 1, 1, 'isi', 1, ?)", T);
    run("INSERT INTO jawaban_versi (peserta_id, soal_id, versi, isi, alasan, disimpan_at) VALUES (1, 1, 1, 'isi', 'berkala', ?)", T);
    run(
      "INSERT INTO jawaban_terlambat (ujian_id, peserta_id, soal_id, isi, versi_dasar, id_simpan, diterima_at, alasan) VALUES (1, 1, 1, 'x', 1, 'simpan-0001', ?, 'waktu_habis')",
      T,
    );
    run(
      "INSERT INTO sesi (id_hash, lingkup, peserta_id, dibuat_at, terakhir_aktif_at, kedaluwarsa_at) VALUES (?, 'peserta', 1, ?, ?, ?)",
      'd'.repeat(64), T, T, T + 1,
    );
    run(
      "INSERT INTO sesi (id_hash, lingkup, ujian_id, dibuat_at, terakhir_aktif_at, kedaluwarsa_at) VALUES (?, 'proyektor', 1, ?, ?, ?)",
      'e'.repeat(64), T, T, T + 1,
    );
    run('INSERT INTO tautan_proyektor (kode_hash, ujian_id, dibuat_at, kedaluwarsa_at) VALUES (?, 1, ?, ?)', 'f'.repeat(64), T, T + 1);
    run("INSERT INTO event_integritas (ujian_id, peserta_id, jenis, mulai_at) VALUES (1, 1, 'koneksi_putus', ?)", T);
    run("INSERT INTO log_aksi (ujian_id, aktor, aksi, dibuat_at) VALUES (1, 'server', 'detak', ?)", T);

    run('DELETE FROM ujian WHERE id = 1');
    // Yang tersisa hanya data awal ujian 2 (1 soal, 1 PDF, 1 peserta); data lain milik ujian 1 habis.
    for (const table of ['soal', 'pdf', 'peserta']) assert.equal(count(table), 1, table);
    for (const table of ['jawaban', 'jawaban_versi', 'jawaban_terlambat', 'sesi', 'tautan_proyektor', 'event_integritas', 'log_aksi']) {
      assert.equal(count(table), 0, table);
    }
  });

  test('penguji yang masih punya ujian tidak bisa dihapus', () => {
    assert.throws(() => run('DELETE FROM penguji WHERE id = 1'), DITOLAK);
  });

  test('username guru unik tanpa membedakan huruf besar/kecil', () => {
    assert.throws(
      () => run("INSERT INTO penguji (username, nama, password_hash, dibuat_at) VALUES ('GURU1', 'X', 'scrypt$y', ?)", T),
      DITOLAK,
    );
  });
});
