-- 0004_penilaian_ai.sql — antrean draf nilai AI (Fase 6 bagian AI) dan catatan biaya pemakaian API.
-- Dipakai oleh: server/ai/antrean.ts, server/routes/penilaian-ai.ts, server/routes/penilaian.ts (saran AI untuk guru).
-- Aturan (CLAUDE.md "Penilaian AI", aturan keras #5–#8; docs/DESAIN.md §9a):
-- - Job disimpan di DB, jadi antrean tetap utuh bila server di-restart (tugas 'berjalan' dikembalikan ke 'menunggu').
-- - Hasil AI yang lolos validasi ditulis ke tabel `penilaian` sebagai sumber 'ai', status 'draf'. Rincian (alasan &
--   kutipan per kriteria) hanya untuk guru, disimpan di sini dan TIDAK pernah dikirim ke siswa.
-- - Setiap permintaan ke penyedia dicatat biayanya (juga yang gagal divalidasi), untuk batas biaya bulanan aplikasi.

-- Satu kali guru menekan "Nilai dengan AI".
CREATE TABLE ai_run (
  id INTEGER PRIMARY KEY,
  ujian_id INTEGER NOT NULL REFERENCES ujian(id) ON DELETE CASCADE,
  penguji_id INTEGER NOT NULL REFERENCES penguji(id),
  model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 100),
  versi_prompt TEXT NOT NULL CHECK (length(versi_prompt) BETWEEN 1 AND 50),
  status TEXT NOT NULL CHECK (status IN ('berjalan', 'selesai', 'dihentikan')),
  -- Diisi bila dihentikan: 'guru', 'batas_biaya', atau galat penyedia (mis. 'kunci_api', 'saldo_atau_batas').
  alasan_berhenti TEXT CHECK (alasan_berhenti IS NULL OR length(alasan_berhenti) <= 300),
  dibuat_at INTEGER NOT NULL,
  selesai_at INTEGER,
  CHECK ((status = 'berjalan') = (selesai_at IS NULL))
) STRICT;

CREATE INDEX ai_run_ujian ON ai_run (ujian_id, id);
-- Paling banyak satu run berjalan per ujian.
CREATE UNIQUE INDEX ai_run_satu_berjalan ON ai_run (ujian_id) WHERE status = 'berjalan';

-- Satu jawaban (siswa × soal) yang dinilai AI dalam satu run.
CREATE TABLE ai_tugas (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES ai_run(id) ON DELETE CASCADE,
  ujian_id INTEGER NOT NULL,
  peserta_id INTEGER NOT NULL,
  soal_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('menunggu', 'berjalan', 'selesai', 'perlu_manual', 'dibatalkan')),
  percobaan INTEGER NOT NULL DEFAULT 0 CHECK (percobaan >= 0),
  -- Pesan singkat untuk guru bila percobaan terakhir gagal (tanpa kunci API, tanpa isi jawaban).
  galat TEXT CHECK (galat IS NULL OR length(galat) <= 500),
  -- Hasil yang lolos validasi: {skor, kriteria{id: {alasan, kutipan[]}}, catatan_siswa, indikasi_instruksi}.
  hasil_json TEXT CHECK (hasil_json IS NULL OR (json_valid(hasil_json) AND length(hasil_json) <= 50000)),
  -- Versi jawaban yang dikirim ke AI (jejak).
  versi_jawaban INTEGER,
  diubah_at INTEGER NOT NULL,
  CHECK ((status = 'selesai') = (hasil_json IS NOT NULL)),
  UNIQUE (run_id, peserta_id, soal_id),
  FOREIGN KEY (peserta_id, ujian_id) REFERENCES peserta (id, ujian_id) ON DELETE CASCADE,
  FOREIGN KEY (soal_id, ujian_id) REFERENCES soal (id, ujian_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX ai_tugas_antre ON ai_tugas (status, run_id);
CREATE INDEX ai_tugas_jawaban ON ai_tugas (ujian_id, peserta_id, soal_id);

-- Satu baris per permintaan yang dijawab penyedia (berhasil atau gagal divalidasi). Biaya dalam mikro-USD
-- (1 USD = 1.000.000) agar penjumlahan tidak terkena galat pecahan. ujian_id boleh NULL setelah ujian dihapus,
-- supaya biaya bulan ini tetap terhitung.
CREATE TABLE ai_pemakaian (
  id INTEGER PRIMARY KEY,
  ujian_id INTEGER REFERENCES ujian(id) ON DELETE SET NULL,
  run_id INTEGER REFERENCES ai_run(id) ON DELETE SET NULL,
  model TEXT NOT NULL,
  token_masuk INTEGER NOT NULL CHECK (token_masuk >= 0),
  token_tulis_cache INTEGER NOT NULL CHECK (token_tulis_cache >= 0),
  token_baca_cache INTEGER NOT NULL CHECK (token_baca_cache >= 0),
  token_keluar INTEGER NOT NULL CHECK (token_keluar >= 0),
  biaya_mikro_usd INTEGER NOT NULL CHECK (biaya_mikro_usd >= 0),
  dibuat_at INTEGER NOT NULL
) STRICT;

CREATE INDEX ai_pemakaian_waktu ON ai_pemakaian (dibuat_at);
CREATE INDEX ai_pemakaian_run ON ai_pemakaian (run_id);
