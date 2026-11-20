-- migrations/0001_skema_awal.sql — skema awal aplikasi ujian (desain: docs/DESAIN.md §7).
-- Dijalankan oleh: server/db/migrate.ts (otomatis saat server start).
-- Aturan: semua tabel STRICT (SQLite menolak tipe data yang salah); semua waktu = INTEGER epoch ms UTC.
-- Aturan bisnis penting ditegakkan juga di sini lewat CHECK dan foreign key, sebagai pengaman terakhir
-- bila ada bug di kode. Contoh: jawaban tidak bisa menunjuk soal dari ujian lain (FK komposit).
-- Tabel penilaian (Fase 6) dibuat di migrasi terpisah.

-- Akun guru. Dibuat lewat perintah CLI, tidak ada pendaftaran publik.
CREATE TABLE penguji (
  id INTEGER PRIMARY KEY,
  -- COLLATE NOCASE: "Guru1" dan "guru1" dianggap sama, mencegah akun kembar.
  username TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(username) BETWEEN 3 AND 32),
  nama TEXT NOT NULL CHECK (length(nama) BETWEEN 1 AND 100),
  -- Format: scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>. Password asli tidak pernah disimpan.
  password_hash TEXT NOT NULL CHECK (password_hash LIKE 'scrypt$%'),
  dibuat_at INTEGER NOT NULL
) STRICT;

-- Satu baris per ujian. Kolom *_at menyimpan kapan transisi terjadi; waktu ujian dihitung dari sini.
CREATE TABLE ujian (
  id INTEGER PRIMARY KEY,
  penguji_id INTEGER NOT NULL REFERENCES penguji(id) ON DELETE RESTRICT,
  judul TEXT NOT NULL CHECK (length(judul) BETWEEN 1 AND 200),
  -- Petunjuk umum; TERLIHAT peserta di ruang tunggu (sebelum mulai), jadi jangan berisi soal.
  petunjuk TEXT NOT NULL DEFAULT '' CHECK (length(petunjuk) <= 5000),
  -- Kode login yang ditampilkan di proyektor: 6 karakter dari alfabet tanpa huruf/angka mirip.
  kode TEXT NOT NULL UNIQUE
    CHECK (length(kode) = 6 AND kode NOT GLOB '*[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]*'),
  durasi_menit INTEGER NOT NULL CHECK (durasi_menit BETWEEN 1 AND 600),
  status TEXT NOT NULL DEFAULT 'draf'
    CHECK (status IN ('draf', 'menunggu', 'berlangsung', 'dijeda', 'selesai', 'penilaian', 'dirilis')),
  -- Cara nama peserta tampil di proyektor.
  mode_tampil TEXT NOT NULL DEFAULT 'nama' CHECK (mode_tampil IN ('nama', 'inisial')),
  dibuka_at INTEGER,
  dimulai_at INTEGER,
  -- Terisi hanya selama jeda berlangsung (awal jeda saat ini).
  dijeda_at INTEGER,
  -- Total lama semua jeda yang sudah selesai.
  total_jeda_ms INTEGER NOT NULL DEFAULT 0 CHECK (total_jeda_ms >= 0),
  -- Perpanjangan untuk semua peserta.
  perpanjangan_ms INTEGER NOT NULL DEFAULT 0 CHECK (perpanjangan_ms >= 0),
  -- Detak server: diperbarui tiap 5 detik selama ujian berlangsung. Bila server mati, detak berhenti;
  -- saat hidup kembali, ujian otomatis DIJEDA sejak detak terakhir, sehingga waktu siswa tidak
  -- habis selama server mati dan tidak ada pengumpulan otomatis massal.
  detak_at INTEGER,
  diakhiri_at INTEGER,
  dirilis_at INTEGER,
  dibuat_at INTEGER NOT NULL,
  diubah_at INTEGER NOT NULL,
  CHECK (status = 'draf' OR dibuka_at IS NOT NULL),
  CHECK ((status IN ('draf', 'menunggu')) = (dimulai_at IS NULL)),
  CHECK (dimulai_at IS NULL OR dimulai_at >= dibuka_at),
  CHECK ((status = 'dijeda') = (dijeda_at IS NOT NULL)),
  CHECK (dijeda_at IS NULL OR dijeda_at >= dimulai_at),
  CHECK ((status IN ('selesai', 'penilaian', 'dirilis')) = (diakhiri_at IS NOT NULL)),
  CHECK (diakhiri_at IS NULL OR diakhiri_at >= dimulai_at),
  CHECK ((status = 'dirilis') = (dirilis_at IS NOT NULL)),
  -- Detak wajib ada sejak ujian dimulai: tanpa detak, jeda otomatis setelah server mati tidak jalan.
  CHECK ((status IN ('draf', 'menunggu')) = (detak_at IS NULL)),
  CHECK (detak_at IS NULL OR detak_at >= dimulai_at),
  -- Sebelum dimulai belum ada jeda maupun perpanjangan.
  CHECK (status NOT IN ('draf', 'menunggu') OR (total_jeda_ms = 0 AND perpanjangan_ms = 0))
) STRICT;

CREATE INDEX ujian_penguji ON ujian (penguji_id);

-- Berkas PDF buku. Berkasnya ada di folder uploads/ dengan nama acak; di sini hanya metadata.
-- nama_tampil TERLIHAT peserta di ruang tunggu, jadi jangan berisi petunjuk soal.
CREATE TABLE pdf (
  id INTEGER PRIMARY KEY,
  ujian_id INTEGER NOT NULL REFERENCES ujian(id) ON DELETE CASCADE,
  nama_tampil TEXT NOT NULL CHECK (length(nama_tampil) BETWEEN 1 AND 200),
  -- Nama acak buatan server (bukan nama asli dari pengunggah) untuk mencegah path traversal.
  nama_berkas TEXT NOT NULL UNIQUE,
  ukuran_byte INTEGER NOT NULL CHECK (ukuran_byte > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  diunggah_at INTEGER NOT NULL,
  -- Target FK komposit dari soal: memastikan soal hanya menunjuk PDF dari ujian yang sama.
  UNIQUE (id, ujian_id)
) STRICT;

-- Soal esai beserta rubrik (JSON tervalidasi Zod, lihat docs/DESAIN.md §9) dan jawaban acuan.
-- Rubrik & jawaban acuan TIDAK PERNAH dikirim ke peserta atau proyektor.
CREATE TABLE soal (
  id INTEGER PRIMARY KEY,
  ujian_id INTEGER NOT NULL REFERENCES ujian(id) ON DELETE CASCADE,
  -- Tidak UNIQUE agar urutan bisa ditukar tanpa nilai sementara; seri diurutkan dengan id.
  urutan INTEGER NOT NULL CHECK (urutan >= 1),
  judul TEXT NOT NULL CHECK (length(judul) BETWEEN 1 AND 200),
  teks TEXT NOT NULL CHECK (length(teks) <= 50000),
  bobot INTEGER NOT NULL DEFAULT 1 CHECK (bobot BETWEEN 1 AND 100),
  rubrik_json TEXT NOT NULL DEFAULT '{"kriteria":[],"poin_wajib":[]}' CHECK (json_valid(rubrik_json)),
  jawaban_acuan TEXT NOT NULL DEFAULT '' CHECK (length(jawaban_acuan) <= 50000),
  -- Referensi buku untuk soal ini (opsional); baru dikirim ke peserta setelah ujian dimulai.
  -- Menghapus PDF yang masih dirujuk ditolak; kode mengosongkan rujukan dulu.
  pdf_id INTEGER,
  pdf_halaman INTEGER CHECK (pdf_halaman IS NULL OR pdf_halaman >= 1),
  dibuat_at INTEGER NOT NULL,
  diubah_at INTEGER NOT NULL,
  CHECK (pdf_halaman IS NULL OR pdf_id IS NOT NULL),
  UNIQUE (id, ujian_id),
  FOREIGN KEY (pdf_id, ujian_id) REFERENCES pdf (id, ujian_id)
) STRICT;

CREATE INDEX soal_ujian_urutan ON soal (ujian_id, urutan);
CREATE INDEX soal_pdf ON soal (pdf_id, ujian_id);

-- Daftar peserta per ujian. Satu orang yang ikut dua ujian = dua baris (PIN dibuat ulang per ujian).
-- Cara masuk: kode ujian → pilih nama dari daftar → PIN 4 angka yang DIBUAT SISWA SENDIRI saat
-- pertama kali masuk. Bila nama "diklaim" orang lain, guru menekan Reset PIN.
CREATE TABLE peserta (
  id INTEGER PRIMARY KEY,
  ujian_id INTEGER NOT NULL REFERENCES ujian(id) ON DELETE CASCADE,
  -- NOCASE: "Budi" dan "budi" dengan nomor yang sama dianggap orang yang sama (cegah dobel impor).
  nama TEXT NOT NULL COLLATE NOCASE CHECK (length(nama) BETWEEN 1 AND 100),
  -- Nomor absen/kursi (opsional); membedakan dua siswa bernama sama di daftar pilihan nama.
  nomor TEXT NOT NULL DEFAULT '' CHECK (length(nomor) <= 20),
  -- Hash scrypt dari PIN (format scrypt$...). NULL = siswa belum membuat PIN / PIN direset guru.
  pin_hash TEXT CHECK (pin_hash IS NULL OR pin_hash LIKE 'scrypt$%'),
  pin_dibuat_at INTEGER,
  -- Jumlah PIN salah berturut-turut. Pada 5 kali salah, nama ini terkunci sampai guru membukanya,
  -- sehingga PIN 4 angka tidak bisa ditebak teman.
  pin_gagal INTEGER NOT NULL DEFAULT 0 CHECK (pin_gagal BETWEEN 0 AND 5),
  terkunci_at INTEGER,
  -- Pengganti nama saat jawaban dikirim ke penyedia AI.
  id_anonim TEXT NOT NULL UNIQUE,
  -- belum_masuk yang tersisa setelah ujian diakhiri = tidak hadir.
  status TEXT NOT NULL DEFAULT 'belum_masuk'
    CHECK (status IN ('belum_masuk', 'menunggu', 'mengerjakan', 'dikumpulkan')),
  cara_kumpul TEXT CHECK (cara_kumpul IN ('manual', 'waktu_habis', 'diakhiri_penguji')),
  -- Perpanjangan khusus peserta ini, ditambahkan di atas perpanjangan ujian.
  perpanjangan_ms INTEGER NOT NULL DEFAULT 0 CHECK (perpanjangan_ms >= 0),
  masuk_pertama_at INTEGER,
  dikumpulkan_at INTEGER,
  dibuat_at INTEGER NOT NULL,
  UNIQUE (ujian_id, nama, nomor),
  -- Target FK komposit dari jawaban & event.
  UNIQUE (id, ujian_id),
  CHECK ((pin_hash IS NULL) = (pin_dibuat_at IS NULL)),
  CHECK ((terkunci_at IS NOT NULL) = (pin_gagal = 5)),
  CHECK ((status = 'dikumpulkan') = (cara_kumpul IS NOT NULL)),
  CHECK ((status = 'dikumpulkan') = (dikumpulkan_at IS NOT NULL)),
  CHECK (status = 'belum_masuk' OR masuk_pertama_at IS NOT NULL),
  CHECK (dikumpulkan_at IS NULL OR dikumpulkan_at >= masuk_pertama_at)
) STRICT;

-- Sesi login. Cookie berisi token acak; yang disimpan hanya SHA-256-nya, jadi bocornya isi DB
-- tidak membuat orang bisa menyamar.
-- lingkup 'proyektor' = sesi KHUSUS layar proyektor untuk satu ujian: hanya boleh memakai endpoint
-- proyektor, sehingga layar kelas tidak pernah memegang akses guru (soal, rubrik, token).
CREATE TABLE sesi (
  id_hash TEXT PRIMARY KEY CHECK (length(id_hash) = 64),
  lingkup TEXT NOT NULL CHECK (lingkup IN ('penguji', 'peserta', 'proyektor')),
  penguji_id INTEGER REFERENCES penguji(id) ON DELETE CASCADE,
  peserta_id INTEGER REFERENCES peserta(id) ON DELETE CASCADE,
  ujian_id INTEGER REFERENCES ujian(id) ON DELETE CASCADE,
  -- Peserta: ID tab browser yang sedang boleh menyimpan jawaban (aturan satu tab aktif).
  tab_aktif TEXT CHECK (tab_aktif IS NULL OR length(tab_aktif) BETWEEN 8 AND 64),
  dibuat_at INTEGER NOT NULL,
  terakhir_aktif_at INTEGER NOT NULL,
  kedaluwarsa_at INTEGER NOT NULL,
  dicabut_at INTEGER,
  -- dicabut_penguji = guru menutup layar proyektor dari dasbor.
  alasan_cabut TEXT CHECK (alasan_cabut IN ('keluar', 'diambil_alih', 'direset_penguji', 'dicabut_penguji')),
  -- Ringkasan browser/OS untuk membantu guru mengenali perangkat (bukan untuk pelacakan).
  info_perangkat TEXT NOT NULL DEFAULT '' CHECK (length(info_perangkat) <= 200),
  CHECK (CASE lingkup
    WHEN 'penguji' THEN penguji_id IS NOT NULL AND peserta_id IS NULL AND ujian_id IS NULL
    WHEN 'peserta' THEN peserta_id IS NOT NULL AND penguji_id IS NULL AND ujian_id IS NULL
    WHEN 'proyektor' THEN ujian_id IS NOT NULL AND penguji_id IS NULL AND peserta_id IS NULL
  END),
  CHECK (tab_aktif IS NULL OR lingkup = 'peserta'),
  CHECK ((dicabut_at IS NULL) = (alasan_cabut IS NULL)),
  CHECK (kedaluwarsa_at > dibuat_at)
) STRICT;

CREATE INDEX sesi_penguji ON sesi (penguji_id);
CREATE INDEX sesi_peserta ON sesi (peserta_id);
CREATE INDEX sesi_ujian ON sesi (ujian_id);
CREATE INDEX sesi_kedaluwarsa ON sesi (kedaluwarsa_at);

-- Kode sekali pakai (berlaku 10 menit) untuk membuka layar proyektor, termasuk di PC kelas,
-- tanpa login guru di perangkat itu. Hanya hash yang disimpan.
CREATE TABLE tautan_proyektor (
  kode_hash TEXT PRIMARY KEY CHECK (length(kode_hash) = 64),
  ujian_id INTEGER NOT NULL REFERENCES ujian(id) ON DELETE CASCADE,
  dibuat_at INTEGER NOT NULL,
  kedaluwarsa_at INTEGER NOT NULL CHECK (kedaluwarsa_at > dibuat_at),
  dipakai_at INTEGER CHECK (dipakai_at IS NULL OR dipakai_at >= dibuat_at)
) STRICT;

CREATE INDEX tautan_proyektor_ujian ON tautan_proyektor (ujian_id);

-- Jawaban terkini per (peserta, soal). versi naik setiap simpan; klien mengirim versi_dasar
-- dan server menolak bila tidak cocok, sehingga jawaban lama tidak menimpa yang baru.
-- ujian_id + dua FK komposit: jawaban tidak mungkin menunjuk soal dari ujian lain.
CREATE TABLE jawaban (
  ujian_id INTEGER NOT NULL,
  peserta_id INTEGER NOT NULL,
  soal_id INTEGER NOT NULL,
  isi TEXT NOT NULL DEFAULT '' CHECK (length(isi) <= 50000),
  versi INTEGER NOT NULL DEFAULT 0 CHECK (versi >= 0),
  -- Tanda "ragu, cek lagi" dari peserta; disimpan di server agar tidak hilang saat laptop restart.
  ditandai INTEGER NOT NULL DEFAULT 0 CHECK (ditandai IN (0, 1)),
  -- UUID kiriman terakhir yang diterima. Kiriman ulang dengan UUID yang sama (balasan pertama hilang
  -- di jalan) dijawab sukses tanpa menyimpan dua kali.
  id_simpan_terakhir TEXT CHECK (id_simpan_terakhir IS NULL OR length(id_simpan_terakhir) BETWEEN 8 AND 64),
  diubah_at INTEGER NOT NULL,
  PRIMARY KEY (peserta_id, soal_id),
  FOREIGN KEY (peserta_id, ujian_id) REFERENCES peserta (id, ujian_id) ON DELETE CASCADE,
  FOREIGN KEY (soal_id, ujian_id) REFERENCES soal (id, ujian_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX jawaban_soal ON jawaban (soal_id, ujian_id);
CREATE INDEX jawaban_ujian ON jawaban (ujian_id);

-- Riwayat jawaban: maks 1 baris per 30 detik per soal ('berkala'), saat/sesudah dikumpulkan ('kumpul'),
-- saat guru memulihkan versi lama ('pulih'), menerima jawaban terlambat ('terlambat'), atau siswa
-- memilih salah satu teks saat bentrok ('konflik').
-- Ditulis dengan ON CONFLICT (peserta_id, soal_id, versi) DO NOTHING — BUKAN "INSERT OR IGNORE",
-- karena yang terakhir juga diam-diam menelan pelanggaran CHECK (bug jadi tak terlihat).
CREATE TABLE jawaban_versi (
  id INTEGER PRIMARY KEY,
  peserta_id INTEGER NOT NULL,
  soal_id INTEGER NOT NULL,
  versi INTEGER NOT NULL CHECK (versi >= 1),
  isi TEXT NOT NULL CHECK (length(isi) <= 50000),
  alasan TEXT NOT NULL CHECK (alasan IN ('berkala', 'kumpul', 'pulih', 'terlambat', 'konflik')),
  disimpan_at INTEGER NOT NULL,
  FOREIGN KEY (peserta_id, soal_id) REFERENCES jawaban (peserta_id, soal_id) ON DELETE CASCADE,
  UNIQUE (peserta_id, soal_id, versi)
) STRICT;

-- Kiriman jawaban yang tiba setelah batas (mis. laptop baru tersambung setelah waktu habis).
-- Tidak mengubah jawaban resmi; guru yang memutuskan diterima atau tidak. Teks siswa tidak hilang.
CREATE TABLE jawaban_terlambat (
  id INTEGER PRIMARY KEY,
  ujian_id INTEGER NOT NULL,
  peserta_id INTEGER NOT NULL,
  soal_id INTEGER NOT NULL,
  isi TEXT NOT NULL CHECK (length(isi) <= 50000),
  versi_dasar INTEGER NOT NULL CHECK (versi_dasar >= 0),
  -- UUID kiriman: kiriman ulang yang sama tidak menambah baris (idempoten).
  id_simpan TEXT NOT NULL CHECK (length(id_simpan) BETWEEN 8 AND 64),
  diterima_at INTEGER NOT NULL,
  alasan TEXT NOT NULL CHECK (alasan IN ('waktu_habis', 'diakhiri', 'sudah_dikumpulkan')),
  keputusan TEXT NOT NULL DEFAULT 'menunggu' CHECK (keputusan IN ('menunggu', 'diterima', 'ditolak')),
  diputuskan_at INTEGER,
  CHECK ((keputusan = 'menunggu') = (diputuskan_at IS NULL)),
  UNIQUE (peserta_id, id_simpan),
  FOREIGN KEY (peserta_id, ujian_id) REFERENCES peserta (id, ujian_id) ON DELETE CASCADE,
  FOREIGN KEY (soal_id, ujian_id) REFERENCES soal (id, ujian_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX jawaban_terlambat_ujian ON jawaban_terlambat (ujian_id, keputusan);
CREATE INDEX jawaban_terlambat_peserta ON jawaban_terlambat (peserta_id, ujian_id);
CREATE INDEX jawaban_terlambat_soal ON jawaban_terlambat (soal_id, ujian_id);

-- Log aktivitas di luar halaman & kejadian sesi/koneksi. Ini CATATAN, bukan vonis.
-- Satu kepergian (pindah tab / jendela tidak aktif / keluar layar penuh yang terjadi bersamaan)
-- = SATU baris; jenis = sinyal terkuat, semua sinyal dicatat di detail_json.sinyal.
CREATE TABLE event_integritas (
  id INTEGER PRIMARY KEY,
  ujian_id INTEGER NOT NULL,
  peserta_id INTEGER NOT NULL,
  -- UUID dari browser untuk menyatukan laporan "mulai" dan "selesai" (UPSERT), dan mengabaikan
  -- laporan yang terkirim dua kali. NULL untuk event yang dicatat server.
  id_klien TEXT CHECK (id_klien IS NULL OR length(id_klien) BETWEEN 8 AND 64),
  jenis TEXT NOT NULL CHECK (jenis IN (
    'tab_tersembunyi', 'fokus_hilang', 'keluar_layar_penuh', 'tempel_dari_luar',
    'masuk_ulang', 'koneksi_putus', 'akses_sebelum_mulai'
  )),
  -- Jam SERVER saat laporan pertama diterima.
  mulai_at INTEGER NOT NULL,
  -- Jam kejadian menurut browser, sudah dikoreksi selisih jam; penting bila laporan tertahan offline.
  mulai_klien_at INTEGER,
  selesai_at INTEGER CHECK (selesai_at IS NULL OR selesai_at >= mulai_at),
  -- Durasi menurut browser (dibatasi wajar oleh server); NULL bila belum selesai/tidak relevan.
  durasi_ms INTEGER CHECK (durasi_ms IS NULL OR durasi_ms >= 0),
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json) AND length(detail_json) <= 2000),
  -- Guru menandai "wajar" (mis. laptop mati yang sudah dikonfirmasi): disembunyikan dari proyektor.
  ditandai_wajar INTEGER NOT NULL DEFAULT 0 CHECK (ditandai_wajar IN (0, 1)),
  catatan_penguji TEXT NOT NULL DEFAULT '' CHECK (length(catatan_penguji) <= 500),
  UNIQUE (peserta_id, id_klien),
  FOREIGN KEY (peserta_id, ujian_id) REFERENCES peserta (id, ujian_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX event_ujian_waktu ON event_integritas (ujian_id, mulai_at);

-- Jejak aksi guru & server (mulai, jeda, perpanjang, reset sesi, buka kembali, jeda otomatis, ...),
-- agar keputusan selama ujian bisa ditelusuri bila ada sengketa.
CREATE TABLE log_aksi (
  id INTEGER PRIMARY KEY,
  ujian_id INTEGER NOT NULL REFERENCES ujian(id) ON DELETE CASCADE,
  aktor TEXT NOT NULL CHECK (aktor IN ('penguji', 'server')),
  penguji_id INTEGER REFERENCES penguji(id),
  aksi TEXT NOT NULL CHECK (length(aksi) BETWEEN 1 AND 50),
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json) AND length(detail_json) <= 2000),
  dibuat_at INTEGER NOT NULL,
  CHECK ((aktor = 'penguji') = (penguji_id IS NOT NULL))
) STRICT;

CREATE INDEX log_aksi_ujian ON log_aksi (ujian_id, dibuat_at);
CREATE INDEX log_aksi_penguji ON log_aksi (penguji_id);
