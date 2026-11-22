# Deploy ke VPS (aaPanel + nginx + pm2)

Panduan ini untuk pemilik. Detail host, akun SSH, dan domain sengaja **tidak** ditulis di repo publik.
Di bawah ini domain ditulis `ujian.domain-anda.id`; ganti dengan subdomain sebenarnya.

Ringkasnya, aplikasi berjalan sebagai **satu proses Node** di `127.0.0.1:8132` lewat pm2. nginx aaPanel
menerima HTTPS dari luar lalu meneruskannya ke port itu.

## 1. Di aaPanel (sekali)
1. **Website → Add site**: domain `ujian.domain-anda.id`, PHP: *Static* (tidak perlu PHP), tanpa database.
2. **SSL**: Let's Encrypt untuk domain itu, aktifkan **Force HTTPS**.
3. **Reverse proxy**: target `http://127.0.0.1:8132`, nama bebas (mis. `ujian`). **Matikan cache** reverse
   proxy bila ada pilihannya. Respons aplikasi sudah mengatur cache sendiri, dan cache nginx bisa membuat
   siswa melihat data basi. Cara mengecek: `curl -sI https://ujian.domain-anda.id/assets/<berkas>.js` tidak
   boleh memuat `X-Cache:`, dan setiap respons hanya punya **satu** baris `Cache-Control`.
4. **Config** situs (berkas konfigurasi nginx). Tambahkan di dalam blok `server { ... }`:
   ```nginx
   # Unggah PDF buku sampai 30 MB (bawaan nginx hanya 1 MB → 413 Request Entity Too Large).
   client_max_body_size 32m;
   ```
   Pastikan blok `location /` hasil reverse proxy berisi header berikut. Biasanya aaPanel sudah menambahkannya;
   tambahkan yang belum ada:
   ```nginx
   proxy_set_header Host $host;
   proxy_set_header X-Real-IP $remote_addr;
   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   proxy_set_header X-Forwarded-Proto $scheme;
   proxy_http_version 1.1;
   ```
   SSE (notifikasi real-time ke siswa) tidak perlu pengaturan tambahan. Aplikasi mengirim `X-Accel-Buffering: no`
   dan detak tiap 15 dtk, sehingga nginx tidak menahan event dan tidak memutus koneksi.

## 2. Di VPS lewat SSH (sekali)
Folder aplikasi sebaiknya **di luar** folder situs aaPanel (mis. `~/apps/ujian`), supaya berkas `.env`,
database, dan PDF tidak pernah bisa diunduh langsung lewat nginx.

```bash
node -v                      # harus v24.x
mkdir -p ~/apps && cd ~/apps
git clone https://github.com/fahmi-burhan/ujian.git
cd ujian
npm ci                       # JANGAN set NODE_ENV=production sebelum ini (Vite perlu terpasang untuk build)
npm run build
cp .env.example .env
nano .env                    # isi seperti di bawah
npm run penguji:buat         # membuat akun guru (password diketik tersembunyi, min. 10 karakter)
pm2 start ecosystem.config.cjs
pm2 save                     # agar dijalankan lagi setelah VPS reboot (sekali: `pm2 startup`, ikuti perintahnya)
```

Isi `.env` di VPS:
```ini
PORT=8132
HOST=127.0.0.1
DB_PATH=data/ujian.db
UPLOAD_DIR=uploads
TRUST_PROXY=true
ORIGIN_PUBLIK=https://ujian.domain-anda.id
```
`ORIGIN_PUBLIK` harus **persis** sama dengan alamat di browser (https, tanpa garis miring di akhir). Bila
berbeda, semua login ditolak `403`.

### Mengaktifkan penilaian AI (opsional, bisa kapan saja)
Tanpa kunci API, penilaian manual tetap jalan seperti biasa. Untuk mengaktifkan draf nilai AI:
1. Di https://platform.claude.com: cek saldo di **Billing** (biarkan *auto-reload* **mati**), buat workspace "Ujian",
   pasang batas bulanan di **Settings → Spend limits**, lalu buat kunci di **Settings → API Keys** dari workspace itu.
2. Di VPS, tempel kunci ke `.env` (jangan lewat chat, jangan di-commit):
   ```bash
   cd ~/apps/ujian
   nano .env        # isi baris: ANTHROPIC_API_KEY=sk-ant-...   (pengaturan AI_* lain ada di .env.example)
   chmod 600 .env   # hanya pemilik akun yang bisa membaca berkas ini
   pm2 restart ujian
   pm2 logs ujian --lines 20 --nostream   # harus ada "Penilaian AI: aktif (...)"; kuncinya sendiri tidak pernah dicetak
   ```
3. Di halaman Penilaian, panel "Draf nilai AI" menampilkan pilihan model, perkiraan biaya, dan sisa batas bulan ini.

## 3. Cek setelah deploy
```bash
pm2 logs ujian --lines 30                       # harus ada "Server ujian berjalan di http://127.0.0.1:8132"
curl -s http://127.0.0.1:8132/api/health        # {"ok":true,"serverTime":...}
curl -sI https://ujian.domain-anda.id/ | grep -i content-security-policy
```
Lalu di browser: buka `https://ujian.domain-anda.id/guru`, masuk, buat ujian contoh, unggah PDF, tambah satu
peserta, Buka ujian. Di jendela **InPrivate** masuk sebagai siswa, lalu pastikan buku PDF tampil di ruang tunggu.
Tekan Mulai di jendela guru; soal harus muncul di jendela siswa dalam ±1 detik tanpa memuat ulang.

## 4. Memperbarui aplikasi
```bash
cd ~/apps/ujian
git pull
npm ci
npm run build
pm2 restart ujian
```
Database dimigrasi otomatis saat server start. **Jangan memperbarui saat ujian berlangsung.** Bila terpaksa,
server yang dimulai ulang lebih dari 15 detik setelah detak terakhir akan **menjeda ujian otomatis**. Waktu siswa
tidak terpotong, tetapi guru perlu menekan Lanjutkan.

## 5. Cadangan
Yang perlu dicadangkan: `data/` (database) dan `uploads/` (PDF buku). Salin keduanya saat server **tidak**
sedang dipakai ujian. Cadangan otomatis selama ujian disiapkan di Fase 7 (gladi resik).

## Catatan
- pm2 wajib satu proses (`instances: 1`, mode fork; sudah diatur di `ecosystem.config.cjs`).
- Port 8132 hanya untuk aplikasi ini. Jangan membuka port itu di firewall: akses dari luar lewat nginx saja.
- `better-sqlite3` membawa binary Linux x64 sendiri, jadi `npm ci` tidak perlu compiler.
