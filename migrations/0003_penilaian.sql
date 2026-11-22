-- 0003_penilaian.sql — nilai per jawaban (satu siswa × satu soal), Fase 6 (penilaian manual dulu; AI menyusul
-- memakai tabel yang sama dengan sumber 'ai').
-- Dipakai oleh: server/routes/penilaian.ts, server/routes/peserta-nilai.ts.
-- Aturan (docs/DESAIN.md §9 & §12):
-- - skor_json = {id_kriteria: skor}; server memastikan setiap kriteria rubrik ada dan skornya salah satu level.
-- - Angka nilai TIDAK disimpan: selalu dihitung dari skor + rubrik (rumus §9), jadi tidak pernah tidak sinkron.
-- - Jawaban kosong diberi 0 otomatis saat penilaian dimulai (sumber 'otomatis_kosong', langsung disetujui).
-- - Nilai baru terlihat siswa setelah dirilis, dan rilis mensyaratkan semua jawaban siswa yang hadir disetujui.
CREATE TABLE penilaian (
  ujian_id INTEGER NOT NULL,
  peserta_id INTEGER NOT NULL,
  soal_id INTEGER NOT NULL,
  skor_json TEXT NOT NULL CHECK (json_valid(skor_json) AND json_type(skor_json) = 'object'),
  -- Catatan guru untuk siswa (terlihat siswa setelah rilis).
  catatan TEXT NOT NULL DEFAULT '' CHECK (length(catatan) <= 2000),
  sumber TEXT NOT NULL CHECK (sumber IN ('manual', 'otomatis_kosong', 'ai')),
  status TEXT NOT NULL CHECK (status IN ('draf', 'disetujui')),
  -- Versi jawaban yang dinilai (jejak; jawaban tidak berubah lagi setelah penilaian dimulai).
  versi_jawaban INTEGER NOT NULL CHECK (versi_jawaban >= 0),
  dinilai_at INTEGER NOT NULL,
  disetujui_at INTEGER,
  CHECK ((status = 'disetujui') = (disetujui_at IS NOT NULL)),
  PRIMARY KEY (peserta_id, soal_id),
  FOREIGN KEY (peserta_id, ujian_id) REFERENCES peserta (id, ujian_id) ON DELETE CASCADE,
  FOREIGN KEY (soal_id, ujian_id) REFERENCES soal (id, ujian_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX penilaian_ujian ON penilaian (ujian_id, status);
CREATE INDEX penilaian_soal ON penilaian (soal_id, ujian_id);
