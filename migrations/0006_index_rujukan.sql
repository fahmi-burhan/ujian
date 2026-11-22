-- 0006_index_rujukan.sql — index untuk memuat rujukan buku per ujian (muatRujukan di server/routes/ujian.ts), yang
-- dipanggil setiap siswa memuat halaman ujian (30 siswa sekaligus saat Mulai) dan setiap guru membuka detail ujian.
-- Tanpa index ini, `WHERE ujian_id = ?` memindai seluruh tabel soal_rujukan yang terus bertambah dari ujian ke ujian.
-- (Dibuat terpisah karena 0005 sudah dijalankan; berkas migrasi yang sudah jalan tidak boleh diubah.)
CREATE INDEX soal_rujukan_ujian ON soal_rujukan (ujian_id, soal_id, urutan);
