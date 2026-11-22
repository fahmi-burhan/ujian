-- 0005_rujukan_soal.sql — satu soal boleh merujuk BEBERAPA buku (maks. 5), masing-masing dengan halaman opsional
-- (permintaan pemilik 22 Nov 2026). Sebelumnya soal hanya punya satu rujukan (kolom soal.pdf_id & soal.pdf_halaman).
-- Dipakai oleh: server/routes/soal.ts, ujian.ts (muatSoalGuru), peserta-ujian.ts, ujian-duplikat.ts, pdf.ts.
-- Langkah:
-- 1. Tabel baru soal_rujukan, diisi dari rujukan lama (urutan 1).
-- 2. Tabel soal dibangun ulang TANPA kolom pdf_id/pdf_halaman (kolom yang ikut FK & CHECK tidak bisa di-DROP
--    langsung di SQLite). Runner mematikan FK selama migrasi lalu memeriksanya sebelum commit, jadi tabel anak
--    (jawaban, penilaian, ai_tugas, soal_rujukan, ...) tetap merujuk "soal" yang baru.
-- Aturan: rujukan (termasuk nama buku & halaman) baru dikirim ke peserta setelah ujian dimulai (aturan keras #1).
-- Menghapus PDF ikut menghapus rujukannya (CASCADE), soalnya tetap ada.
CREATE TABLE soal_rujukan (
  soal_id INTEGER NOT NULL,
  ujian_id INTEGER NOT NULL,
  urutan INTEGER NOT NULL CHECK (urutan BETWEEN 1 AND 5),
  pdf_id INTEGER NOT NULL,
  halaman INTEGER CHECK (halaman IS NULL OR halaman BETWEEN 1 AND 100000),
  PRIMARY KEY (soal_id, urutan),
  FOREIGN KEY (soal_id, ujian_id) REFERENCES soal (id, ujian_id) ON DELETE CASCADE,
  FOREIGN KEY (pdf_id, ujian_id) REFERENCES pdf (id, ujian_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX soal_rujukan_pdf ON soal_rujukan (pdf_id, ujian_id);

INSERT INTO soal_rujukan (soal_id, ujian_id, urutan, pdf_id, halaman)
SELECT id, ujian_id, 1, pdf_id, pdf_halaman FROM soal WHERE pdf_id IS NOT NULL;

CREATE TABLE soal_baru (
  id INTEGER PRIMARY KEY,
  ujian_id INTEGER NOT NULL REFERENCES ujian(id) ON DELETE CASCADE,
  -- Tidak UNIQUE agar urutan bisa ditukar tanpa nilai sementara; seri diurutkan dengan id.
  urutan INTEGER NOT NULL CHECK (urutan >= 1),
  judul TEXT NOT NULL CHECK (length(judul) BETWEEN 1 AND 200),
  teks TEXT NOT NULL CHECK (length(teks) <= 50000),
  bobot INTEGER NOT NULL DEFAULT 1 CHECK (bobot BETWEEN 1 AND 100),
  rubrik_json TEXT NOT NULL DEFAULT '{"kriteria":[],"poin_wajib":[]}' CHECK (json_valid(rubrik_json)),
  jawaban_acuan TEXT NOT NULL DEFAULT '' CHECK (length(jawaban_acuan) <= 50000),
  dibuat_at INTEGER NOT NULL,
  diubah_at INTEGER NOT NULL,
  UNIQUE (id, ujian_id)
) STRICT;

INSERT INTO soal_baru (id, ujian_id, urutan, judul, teks, bobot, rubrik_json, jawaban_acuan, dibuat_at, diubah_at)
SELECT id, ujian_id, urutan, judul, teks, bobot, rubrik_json, jawaban_acuan, dibuat_at, diubah_at FROM soal;

DROP TABLE soal;
ALTER TABLE soal_baru RENAME TO soal;

CREATE INDEX soal_ujian_urutan ON soal (ujian_id, urutan);
