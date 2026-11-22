# CLAUDE.md — Aplikasi Ujian Esai Serentak

Panduan dasar untuk agen (Claude Code) yang bekerja di repo ini. Spesifikasi lengkap ada di [PROMPT.md](PROMPT.md); rencana kerja dan keputusan ada di [docs/PLAN.md](docs/PLAN.md). Bila ketiganya bertentangan, urutan prioritas: aturan di berkas ini → docs/PLAN.md → PROMPT.md.

## Ringkasan proyek
Aplikasi web ujian esai untuk satu kelas (~30 peserta), dipakai sebagai **latihan yang menyenangkan dan menantang**, bukan ujian resmi. Dua peran: **penguji** (guru) dan **peserta** (siswa), plus **layar proyektor** read-only. Penguji menekan Mulai → semua peserta mulai serentak. Peserta bebas memilih urutan soal, jawaban tersimpan otomatis, buku PDF dibaca di dalam halaman. Aktivitas di luar halaman dicatat dan tampil ke penguji & proyektor. Setelah ujian, AI memberi **draf nilai** berbasis rubrik; guru mengecek ulang (sering bersama siswa) lalu merilis. Siswa **tidak membawa HP** ke ruangan; satu-satunya perangkat adalah laptop masing-masing. **Aturan ujian: dilarang membuka tab/jendela lain selain tab ujian.** Pindah tab langsung dicatat; kehilangan fokus dicatat bila ≥ 1 detik; notifikasi ke siswa, dasbor guru, dan proyektor (nama). Layar penuh wajib selama ujian.

## Stack (wajib, jangan ganti)
- Server: Node 24, Express, better-sqlite3, migrasi SQL mentah (`.sql` bernomor), Zod, TypeScript dengan **type stripping** (Node menjalankan `.ts` langsung, tanpa build server).
- Klien: Vue 3 (SFC) + Vite + Tailwind + **daisyUI** (komponen & tema), ikon **Font Awesome Free** yang dipasang lewat npm dan dibundel Vite (tanpa CDN/kit eksternal), dibangun ke `dist/` lalu disajikan Express (monolith, satu port).
- Tes: `node:test` bawaan Node.
- Dependensi baru di luar daftar ini **wajib ditandai** di docs/PLAN.md (bagian Dependensi) beserta alasannya sebelum dipasang. Yang sudah disetujui: `pdfjs-dist` (PDF.js, pembaca PDF di dalam halaman), `daisyui`, `@fortawesome/fontawesome-free`, `vue-router`, `@anthropic-ai/sdk` (hanya server, versi dikunci). Pustaka unggah tidak dipakai: PDF dikirim sebagai body mentah lewat `express.raw`.
- Desain yang disetujui ada di [docs/DESAIN.md](docs/DESAIN.md) (state machine, aturan waktu, autosave, kontrak API, daftar putih payload). Ikuti dokumen itu; perubahan desain harus ditanyakan dulu ke pemilik.

### Aturan type stripping (sering bikin error saat runtime)
- Dilarang: `enum`, `namespace`, parameter properties di constructor, decorator. Pakai objek `as const` + union type.
- Import relatif wajib berekstensi `.ts` (`import { x } from './db.ts'`); import tipe pakai `import type`.
- tsconfig server memakai `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `noEmit`.

## Keputusan yang sudah dikunci
- **Hosting: VPS pribadi** (aaPanel, Ubuntu, Node 24, pm2, di belakang reverse proxy nginx + TLS). HTTPS membuat halaman berstatus *secure context*. Detail SSH/host **tidak ditulis di repo**.
- **Real-time: SSE + HTTP POST**, tanpa WebSocket. Alasannya, push hanya dari server ke klien (mulai, jeda, waktu, peringatan); kiriman klien (autosave, event) cukup lewat POST biasa. `EventSource` tersambung ulang otomatis, tidak perlu dependensi, dan tidak perlu mengubah konfigurasi Upgrade di nginx. Kode SSE dikumpulkan di satu modul agar bisa diganti bila kelak benar-benar perlu. Respons SSE wajib mengirim header `X-Accel-Buffering: no` (nginx aaPanel mem-buffer secara default) dan komentar heartbeat tiap ±15 detik agar tidak diputus `proxy_read_timeout`.
- **Waktu otoritatif dari server.** Klien hanya menghitung offset jam server untuk menampilkan hitung mundur. State & waktu ujian dipulihkan dari DB setelah restart (waktu mulai + total jeda + perpanjangan), bukan dari memori.
- **Penilaian AI: antrean batch setelah ujian**, job disimpan di DB. Ke AI hanya dikirim **ID acak peserta**, tidak pernah nama. Mode penilaian manual harus selalu bisa dipakai tanpa AI. Penyedia: **Claude** (keputusan pemilik 22 Nov) di belakang antarmuka adapter `server/ai/adapter.ts`, plus adapter tiruan untuk tes; adapter OpenAI/model lokal menyusul bila diminta. Model & harga dicek dari dokumentasi resmi (`server/ai/harga.ts`).
- **PDF buku boleh dimuat sejak ruang tunggu** (keputusan pemilik) untuk peserta yang sudah masuk ke ujian tersebut, agar tidak ada lonjakan unduhan saat Mulai. PDF disajikan dengan dukungan HTTP Range (PDF.js memuat bertahap).
- **Proyektor menampilkan nama peserta** (keputusan pemilik, suasana latihan). Teks harus netral dan tidak menuduh, mis. "keluar halaman 2× · 15 dtk", bukan "curang" atau "pelanggaran berat". Penguji bisa mengganti ke mode inisial.
- Zona waktu tampilan WIB (format 24 jam); simpan waktu di DB sebagai epoch ms UTC.

## Aturan keras (jangan dilanggar, apa pun permintaannya)
1. Isi soal, judul soal, rubrik, kunci, dan **tautan PDF ke soal tertentu** (mis. "lihat Bab 3") **tidak boleh** dikirim ke peserta sebelum ujian berstatus `berlangsung`. Yang boleh dikirim lebih awal hanya berkas PDF bukunya. Pengecekan dilakukan di server (403), bukan menyembunyikan di UI. Rubrik/kunci/jawaban acuan tidak pernah dikirim ke proyektor, dan ke peserta **hanya setelah nilai dirilis** (status `dirilis`, untuk ujiannya sendiri, lewat `GET /api/peserta/nilai`; keputusan pemilik 22 Nov 2026). Sebelum itu tetap terlarang dan dicek server; "tarik rilis" menutupnya lagi.
2. Tidak memakai kamera, mikrofon, perekaman layar, ekstensi, atau perangkat lunak di laptop peserta.
3. Tidak ada label "curang" atau sanksi otomatis (pengurangan nilai, penguncian). Sistem hanya mencatat dan memperingatkan. Auto-submit hanya terjadi saat **waktu habis**, bukan sebagai sanksi.
4. Jangan pernah mengklaim browser bisa mendeteksi aplikasi lain, ponsel, atau tangkapan layar. Batasan ini ditulis jujur di UI penguji dan README.
5. Kunci API AI hanya ada di `.env` server. Tidak boleh ada di klien, repo, atau log.
6. Jawaban peserta masuk ke prompt AI **sebagai data** di dalam pembatas yang jelas, dan prompt sistem memerintahkan agar instruksi di dalam jawaban diabaikan dan dilaporkan.
7. Keluaran AI divalidasi Zod: skor dalam rentang level, semua kriteria ada, dan kutipan bukti benar-benar ada di jawaban (setelah normalisasi spasi/tanda kutip). Bila gagal: coba ulang terbatas, lalu tandai "perlu dinilai manual". Jangan pernah mengisi nilai tebakan.
8. Nilai tidak dirilis ke peserta sebelum disetujui penguji (boleh "setujui semua" per soal).
9. SQL selalu memakai prepared statement (`db.prepare(...).run(param)`), tidak pernah menyambung string. Teks jawaban dirender sebagai teks (`{{ }}` di Vue, tanpa `v-html`).
10. Ekspor CSV: UTF-8 BOM, pemisah `;` (Excel berlocale Indonesia), dan sel yang diawali `= + - @` diberi awalan `'` untuk mencegah CSV injection.
11. Jangan mengarang harga, nama model, atau batas laju penyedia AI. Bila belum dicek di dokumentasi resmi, tulis "TIDAK TERVERIFIKASI".

## Konvensi kode
- Setiap berkas diawali header komentar Bahasa Indonesia: **peran berkas, siapa yang memanggil, apa yang dipanggil**. Komentar menjelaskan *alasan*, bukan mengulang kode. Pemilik adalah developer junior yang belajar dari kode ini.
- Semua input request divalidasi Zod di server. Skema Zod yang dipakai klien & server diletakkan di `shared/`.
- Jangan ada TODO, elipsis, atau fungsi kosong pada fitur yang diklaim selesai.
- Pembaca PDF memakai `pdfjs-dist` yang me-render ke canvas **di dokumen yang sama**. Jangan pakai `<iframe>`/`<embed>` PDF bawaan browser karena memicu `blur` (positif palsu) dan menampilkan tombol unduh.
- Hindari API yang butuh fitur khusus bila ada alternatif sederhana; uji di Edge dan Chrome.

## Cara bekerja
- Ikuti fase di docs/PLAN.md secara berurutan; jangan menulis UI sebelum state machine & kontrak API di `docs/` final.
- Setelah setiap fase: centang di docs/PLAN.md, tulis ringkasan 2–4 baris (keputusan + dampaknya ke fase berikutnya). Lalu **commit di akhir setiap fase** (izin pemilik). Push hanya ke remote yang disebut di bagian Git docs/PLAN.md. Repo ini **publik**: jangan pernah meng-commit rahasia, data peserta, PDF, atau detail SSH/host VPS.
- **Bila ada hal yang belum jelas, jangan berasumsi: berhenti dan konfirmasi ke pemilik** (permintaan pemilik 20 Nov 2026). Keputusan teknis murni (struktur folder, nama berkas, pola kode) boleh diambil sendiri, tetapi tetap disebutkan.
- Perintah terminal untuk pemilik ditulis untuk **PowerShell** di Windows.
- Bedakan dengan jelas antara FAKTA teknis, KEPUTUSAN desain, dan ASUMSI.
- Sebelum menyatakan fase selesai, jalankan tes dan minta subagen `penjaga-ujian` meninjau perubahan.
- Keputusan kebijakan (sanksi, data ke pihak ketiga, PDF berhak cipta, penyedia AI & biaya) ditanyakan ke pemilik, bukan diputuskan sendiri.

## Perintah (PowerShell)
- Salin konfigurasi sekali: `Copy-Item .env.example .env`. `.env` dan `DB_PATH` selalu dihitung dari akar proyek.
- **Mode ditentukan oleh entry point, bukan `.env`**: `server/dev.ts` = development, `server/main.ts` = production. Jangan menambahkan pembacaan `NODE_ENV` dari `.env`.
- `npm run dev`: server + Vite (hot reload) di satu port, http://127.0.0.1:8132. Server restart otomatis saat `server/` atau `shared/` berubah. Vite hanya boleh membaca `client/`, `shared/`, dan `node_modules/`.
- `npm test`: semua tes `tests/**/*.test.ts` (node:test, database di RAM).
- `npm run typecheck`: `tsc` (server/shared/tes) + `vue-tsc` (klien). Jalankan sebelum menyatakan pekerjaan selesai.
- `npm run build`: build klien ke `dist/`. `npm start`: menjalankan server mode production (butuh `dist/` dan `NODE_ENV=production`).
- PDF buku disimpan di `UPLOAD_DIR` (bawaan `uploads/`, dihitung dari akar proyek, tidak masuk git). Tes memakai folder sementara.
- `npm run migrate`: menjalankan migrasi tanpa menyalakan server (server juga memigrasi otomatis saat start).
- `npm run penguji:buat`: membuat akun guru (interaktif; password diketik tersembunyi, minimal 10 karakter). Harus di terminal sungguhan, bukan lewat pipe.
- Autentikasi (Fase 2): `server/auth/` (sesi tiga lingkup + cookie terpisah, scrypt, penjaga & cek Origin, semafor/antrean login, perangkat dikenal guru). Rute baru wajib memakai `wajibSesi(...)` dan `validasi(Skema, ...)`, dan melempar `GalatHttp`. Tes HTTP memakai `tests/bantuan.ts` (DB di RAM, jam palsu, klien ber-cookie yang mengirim Origin). Semua scrypt lewat `server/auth/kata-sandi.ts` (dibatasi semafor). Percobaan PIN dipesan atomik sebelum dicek; jangan dikembalikan ke pola "cek dulu, hitung belakangan".
- `npm start` di laptop butuh `ORIGIN_PUBLIK=http://127.0.0.1:8132` di `.env` (production menolak start tanpa nilai ini), lalu buka persis alamat itu. `http://localhost:8132` akan ditolak 403 karena Origin-nya berbeda.
- Tata letak: `server/` (Express, rute, DB), `shared/` (skema Zod & utilitas yang dipakai kedua sisi), `client/` (Vue), `migrations/` (SQL bernomor), `tests/`.
- Saat menguji server dari tool Bash di Windows, `kill -INT` tidak sampai ke proses Node. Pakai `Start-Process` + `Stop-Process` di PowerShell.
- `better-sqlite3` memakai binary bawaan paket (Windows & Linux x64). Install script-nya ditolak lewat `allowScripts` di package.json, jadi tidak perlu Visual Studio Build Tools.
- Deploy ke VPS: [docs/DEPLOY.md](docs/DEPLOY.md) (aaPanel + nginx + pm2 lewat `ecosystem.config.cjs`, satu proses).
- Alur siswa (Fase 4): waktu dihitung di `server/waktu-ujian.ts` (selalu dari kolom DB, tanpa penghitung di memori). `server/pengecek.ts` dijalankan tiap detik oleh start.ts; tes memanggilnya lewat `a.pengecek()` / `a.majukanBerdetak(ms)`. Semua SSE lewat `server/sse.ts` + `server/siaran.ts`. Autosave klien ada di `client/src/autosave.ts` tanpa Vue/DOM, dites di `tests/autosave.test.ts`. Urutan pemeriksaan di `server/routes/jawaban.ts` mengikuti DESAIN §5 dan tidak boleh ditukar.
- Uji SSE di tes: `klien.aliran(path)` dari `tests/bantuan.ts` (menunggu event dengan `tunggu(nama, ke)`).
- Penilaian (Fase 6, manual dulu): `server/routes/penilaian.ts` (guru) dan `server/routes/peserta-nilai.ts` (siswa, hanya `dirilis`). Rumus nilai, validasi skor, dan sel CSV ada di `shared/nilai.ts` dan dipakai server maupun klien; angka nilai tidak disimpan di DB, selalu dihitung dari skor + rubrik (tabel `penilaian`, migrasi 0003). Unduhan nilai utama berupa .xlsx dari `server/xlsx.ts` (tanpa pustaka; teks selalu inline string, tidak pernah rumus), CSV format Indonesia sebagai alternatif.
- Rujukan buku per soal ada di tabel `soal_rujukan` (maks. 5, migrasi 0005), dimuat lewat `muatRujukan()` di `server/routes/ujian.ts`; jangan menambah kolom PDF ke tabel `soal` lagi.
- **Isi soal sungguhan (termasuk contoh/template) tidak boleh di-commit**: repo publik, siswa bisa membacanya sebelum ujian. Masukkan lewat aplikasi atau skrip sekali pakai di luar repo.
- Penilaian AI (Fase 6): `server/ai/` (adapter, `claude.ts`, `prompt.ts` = prompt berversi + validasi keluaran, `antrean.ts` = antrean di DB + batas biaya, `harga.ts`) dan `server/routes/penilaian-ai.ts`. Pengaturan `ANTHROPIC_API_KEY` & `AI_*` di `.env` (kosong = AI nonaktif). Tes tidak pernah memanggil penyedia sungguhan: `mulaiAplikasiUji(opsi, env, adapterTiruan)` lalu `await a.ai.diam()`. Jangan pernah mencetak `config.ai` ke log.
- Integritas & pemantauan (Fase 5): potret dasbor guru & proyektor dirakit di `server/pantau.ts` (daftar putih §8.1). Setiap perubahan yang terlihat guru/proyektor wajib memanggil `beritahuPantau(k, ujianId)`; perubahan status lewat `siarkanStatus`/`kirimStatusPeserta` sudah otomatis. Laporan aktivitas siswa: `server/routes/event.ts` (aturan penerimaan DESAIN §6). Klien: `client/src/integritas.ts` & `client/src/tempel.ts` tanpa Vue/DOM, dites di `tests/integritas.test.ts`. Saat memajukan jam di tes, pakai `a.majukanBerdetak(ms)` bila ujian sedang berlangsung; `a.majukan(ms)` saja membuat pengecek menjeda ujian otomatis.
