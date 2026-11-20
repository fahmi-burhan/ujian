# migrations/

Berkas SQL yang mengubah struktur database, dijalankan otomatis oleh `server/db/migrate.ts` setiap server start (atau manual lewat `npm run migrate`).

Aturan:
- Nama berkas: `NNNN_nama_huruf_kecil.sql`, nomor 4 digit berurutan dan unik (`0001_skema_awal.sql`, `0002_...`). Nama yang tidak sesuai pola atau nomor ganda membuat server menolak start.
- Satu berkas dijalankan di dalam satu transaksi; bila gagal, seluruh isinya dibatalkan.
- **Jangan menulis** `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, atau `PRAGMA foreign_keys` di dalam berkas. Runner yang mengatur transaksi dan foreign key. Pengecualian: `BEGIN ... END` di dalam `CREATE TRIGGER` boleh.
- Foreign key dimatikan selama migrasi, lalu diperiksa sebelum commit. Pola "bangun ulang tabel" SQLite (buat tabel baru, salin, `DROP` tabel lama, `ALTER TABLE ... RENAME`) aman dan tidak ikut menghapus baris anak.
- **Jangan pernah mengubah berkas yang sudah dijalankan** di database mana pun (laptop atau VPS). Runner mencatat sidik jari isi berkas dan menolak start bila isinya berubah. Buat berkas baru untuk perubahan berikutnya.
- Waktu disimpan sebagai `INTEGER` epoch milidetik UTC.

Skema awal dibuat di Fase 1 setelah desain disetujui.
