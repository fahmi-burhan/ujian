-- 0002_perangkat_guru.sql — "perangkat dikenal" untuk login guru (keputusan pemilik 20 Nov 2026).
-- Setelah login guru berhasil, browser guru diberi cookie acak berumur 90 hari. Login dari browser itu
-- melewati antrean login per username, sehingga siswa yang membanjiri login dengan tebakan password
-- tidak bisa membuat guru gagal masuk. Yang disimpan hanya sidik (SHA-256) token, bukan tokennya.
-- Dipakai oleh: server/auth/perangkat-dikenal.ts.
CREATE TABLE perangkat_guru (
  id INTEGER PRIMARY KEY,
  penguji_id INTEGER NOT NULL REFERENCES penguji(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  -- Ringkasan browser/OS, agar guru bisa mengenali perangkatnya (bukan untuk pelacakan).
  info_perangkat TEXT NOT NULL DEFAULT '' CHECK (length(info_perangkat) <= 200),
  -- Password salah berturut-turut dari perangkat ini. Pada batasnya (3) baris dihapus = perangkat dilupakan.
  gagal INTEGER NOT NULL DEFAULT 0 CHECK (gagal BETWEEN 0 AND 2),
  dibuat_at INTEGER NOT NULL,
  dipakai_at INTEGER NOT NULL,
  kedaluwarsa_at INTEGER NOT NULL,
  CHECK (dipakai_at >= dibuat_at),
  CHECK (kedaluwarsa_at > dibuat_at)
) STRICT;

CREATE INDEX perangkat_guru_penguji ON perangkat_guru (penguji_id, dipakai_at);
