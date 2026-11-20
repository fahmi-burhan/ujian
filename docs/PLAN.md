# Rencana Kerja — Aplikasi Ujian Esai Serentak

Dibuat 20 Nov 2026. Target ujian pertama: **sekitar Jumat, 4 Des 2026** (±2 pekan).

## Keputusan pemilik
| Hal | Keputusan | Catatan |
|---|---|---|
| Hosting | VPS pribadi (HTTPS, reverse proxy aaPanel, pm2) | Wi-Fi kelas memblokir koneksi antarlaptop, jadi server lokal tidak bisa dipakai. Hotspot HP tidak sanggup menampung ~31 perangkat. |
| Jumlah peserta | ~30 | Untuk skala ini SSE di satu proses Node sudah sangat cukup. |
| Sifat ujian | Latihan yang menyenangkan & menantang, bukan resmi | Risiko joki jarak jauh diterima. Mitigasinya ringan: token dibagikan di kelas. |
| Tampilan pelanggaran di proyektor | Nama peserta | Teks netral. Penguji bisa mengganti ke inisial. |
| Data ke AI | Hanya ID acak + teks jawaban | AI hanya memberi draf. Guru mengecek ulang bersama siswa. |
| Penyedia AI | Claude atau OpenAI, **kunci API belum ada** | Adapter untuk keduanya + adapter tiruan untuk tes. Penilaian dilakukan setelah ujian, jadi kunci yang terlambat tidak menghambat hari-H. |
| HP di ruangan | Siswa tidak membawa HP | Pemantauan fokus pada tab/jendela lain di laptop (mis. chatbot AI di browser). |
| PDF sebelum Mulai | Boleh | Dimuat di ruang tunggu dengan PDF.js + HTTP Range. Tautan PDF per soal tetap disembunyikan sampai Mulai. |
| Real-time | SSE, tanpa WebSocket | Push hanya satu arah (server → klien); kiriman klien lewat POST. |
| UI | Tailwind + daisyUI + Font Awesome Free (npm, tanpa CDN) | — |

## Variabel yang diisi (default, bisa diubah)
| Variabel | Nilai |
|---|---|
| ATURAN_SANKSI | Hanya mencatat & memperingatkan; penguji yang memutuskan |
| DURASI_DEFAULT | Diatur per ujian; perpanjangan untuk semua atau per peserta |
| METODE_MASUK_PESERTA | Kode ujian + token unik per peserta (dibagikan di kertas) |
| FORMAT_RUBRIK | Per soal → kriteria (nama, bobot) → deskriptor per level; plus jawaban acuan & poin wajib |
| SKALA_NILAI | 0–100 per ujian (bobot soal × bobot kriteria) |
| EVENT_INTEGRITAS | Halaman tak terlihat, blur ≥ 3 dtk, keluar fullscreen, tempel teks dari luar halaman, sesi kedua, koneksi terputus |
| INTERVAL_AUTOSAVE | Setelah jeda mengetik 1,5 dtk + berkala 15 dtk; riwayat versi maks 1 per 30 dtk per soal |
| LATENSI_NOTIFIKASI | ≤ 3 dtk |
| TOLERANSI_DETIK | 10 dtk setelah waktu habis |
| BATAS_UKURAN_PDF | 30 MB |
| AMBANG_SELISIH | 15% dari skor maksimum kriteria |
| BAHASA_ANTARMUKA | Bahasa Indonesia, waktu WIB 24 jam |

## Dependensi di luar stack
| Paket | Status | Alasan |
|---|---|---|
| `pdfjs-dist` | Disetujui | PDF di-render ke canvas di halaman yang sama. Viewer bawaan (iframe) memicu `blur` dan menampilkan tombol unduh. |
| `daisyui` | Disetujui | Komponen & tema siap pakai di atas Tailwind (pemilik sudah familiar dari proyek koor). |
| `vue-router` | Disetujui (20 Nov) | Alamat halaman & tombol Back untuk halaman guru/peserta/proyektor, plus pemisahan kode per peran. |
| `@fortawesome/fontawesome-free` | Disetujui | Ikon. Hanya CSS inti + set *solid* yang diimpor, dibundel Vite tanpa CDN. |
| Pustaka unggah (`multer`/`busboy`) | Menunggu | Unggah PDF dan CSV peserta. Alternatifnya `express.raw` untuk satu berkas. |
| SDK penyedia AI | Menunggu | Bisa diganti `fetch` biasa bila penyedia sudah dipilih. |

Perkakas bawaan stack (devDependencies, dipasang di Fase 0): `typescript` 6, `vue-tsc` (memeriksa tipe di berkas .vue), `@types/node@24` (disamakan dengan runtime Node 24), `@types/express`, `@types/better-sqlite3`, `vite` 8, `@vitejs/plugin-vue`, `tailwindcss` 4, `@tailwindcss/vite`, `vue`. Tidak ada `concurrently`/`nodemon`: Vite berjalan sebagai middleware di dalam Express dan `node --watch` menangani restart.

## Git
- **Commit di setiap akhir fase** (keputusan pemilik 20 Nov 2026).
- Remote: repo GitHub **publik** `ujian` di akun `fahmi-burhan`. Karena publik, tidak boleh ada rahasia, data peserta, PDF, atau detail SSH/host VPS di repo.
- `gh` belum terpasang di laptop pemilik, jadi repo dibuat oleh pemilik (atau setelah `gh` dipasang). Email penulis commit untuk repo publik masih menunggu konfirmasi pemilik.

## Aturan fokus & layar penuh (keputusan pemilik 20 Nov 2026)
- Pindah tab/minimize (halaman tidak terlihat) langsung dicatat. Jendela kehilangan fokus dicatat bila **≥ 1 detik**.
- Notifikasi ke **siswa** (peringatan saat kembali ke halaman), **dasbor guru**, dan **proyektor** (dengan nama).
- **Layar penuh wajib** selama ujian. Keluar dari layar penuh dicatat, dan siswa diminta kembali ke layar penuh.

## Menunggu konfirmasi pemilik
| Hal | Dibutuhkan di | Pertanyaan |
|---|---|---|
| Email commit | Sebelum push pertama | Pakai email Gmail atau email noreply GitHub untuk repo publik? |

## Jadwal & fase
| Tanggal | Fase | Isi | Selesai bila |
|---|---|---|---|
| 20–22 Nov | **0. Fondasi** ✅ 20 Nov | package.json, tsconfig type stripping, Express + Vite + Vue + Tailwind, runner migrasi, `.env.example`, script npm | `npm run dev` jalan di Windows, `npm test` hijau |
| 20–22 Nov | **1. Desain** | `docs/`: matriks peran × fase, state machine (termasuk jeda), skema DB, kontrak API & event SSE | Pemilik menyetujui desain |
| 23–24 Nov | **2. Auth & peran** | Login penguji (scrypt), token peserta, sesi di SQLite, satu sesi aktif, rute proyektor | Tes matriks endpoint × peran lulus |
| 24–25 Nov | **3. Penyusunan ujian** | CRUD ujian/soal/rubrik/kunci, unggah PDF, impor peserta CSV, pratinjau, validasi kelengkapan | Ujian contoh lengkap bisa disiapkan |
| 26–28 Nov | **4. Alur peserta** | Ruang tunggu, gerbang mulai, navigasi bebas, autosave berversi + buffer lokal, timer, pembaca PDF, submit/auto-submit | Ujian bisa dikerjakan dari awal sampai akhir. **Deploy pertama ke VPS** |
| 29–30 Nov | **5. Integritas & proyektor** | Event browser → SSE, peringatan ke peserta, dasbor penguji, layar proyektor, jeda/perpanjangan | Event muncul ≤ 3 dtk di dasbor & proyektor |
| 30 Nov–1 Des | **6. Penilaian** | Penilaian manual dulu, lalu AI: antrean, prompt berversi, validasi Zod, tinjau/setujui, rilis, ekspor CSV | Draf nilai AI bisa ditinjau & dirilis |
| 2 Des | **7. Gladi resik** | Uji di VPS dengan 5+ perangkat, simulasi putus Wi-Fi & restart pm2, uji beban 30 peserta, README + checklist hari-H | Tidak ada jawaban hilang |
| 3 Des | Pembekuan | Hanya perbaikan bug | — |
| ~4 Des | **Ujian pertama** | — | — |

## Ringkasan per fase
**Fase 0 (20 Nov):**
- **Keputusan:** Express + Vite middleware di satu port. Mode ditentukan oleh entry point (dev.ts/main.ts), bukan `.env`, sehingga `.env` yang hilang di VPS tidak menyalakan Vite ke publik. `.env` dan DB dihitung dari akar proyek. Runner migrasi atomik, bersidik jari, dan aman untuk pola bangun-ulang tabel. Error 4xx dijawab apa adanya tanpa mencatat isi request.
- **Dampak ke fase berikutnya:** skema Fase 1 ditulis sebagai `migrations/0001_*.sql` dan tidak boleh diubah setelah dijalankan di mana pun. Kode klien memakai kode error tetap (`terlalu_besar`, `json_tidak_valid`, `permintaan_terputus`) untuk logika autosave. 34 tes lulus. Sudah ditinjau `penjaga-ujian`: 4 temuan PENTING + 8 KECIL, semuanya sudah diperbaiki.

## Catatan hosting (VPS)
- Subdomain baru (mis. `ujian.<domain>`) di aaPanel + sertifikat TLS. Port aplikasi dicek dulu agar tidak bentrok dengan aplikasi lain di VPS.
- SSE di belakang nginx: header `X-Accel-Buffering: no` + heartbeat 15 dtk.
- `app.set('trust proxy', 1)` agar IP & cookie `secure` benar di belakang proxy.
- Backup DB berkala selama ujian dengan `db.backup()`.
- pm2 **wajib mode fork dengan `instances: 1`**. State SSE ada di memori proses, dan SQLite hanya punya satu penulis.
- Jalankan lewat npm dengan `cwd` = akar proyek (`pm2 start npm --name ujian -- start`, atau ecosystem file dengan `script: 'npm', args: 'start'`). Jangan `pm2 start server/main.ts` langsung: pm2 bisa memilih interpreter lain untuk berkas `.ts` (TIDAK TERVERIFIKASI untuk versi pm2 di VPS).
- Jangan set `NODE_ENV=production` di shell VPS sebelum `npm ci`, karena npm akan melewati devDependencies dan `npm run build` gagal (Vite tidak terpasang). Mode production sudah dijamin oleh `npm start`.
- Pastikan nginx aaPanel meneruskan `X-Forwarded-For` dan `X-Forwarded-Proto` (dicek saat deploy pertama).
- `better-sqlite3` 13 membawa binary `linux-x64`. Kecocokannya dengan glibc Ubuntu 22.04 dicek saat deploy pertama.
- Rencana cadangan bila Wi-Fi kelas putus: siswa tetap bisa mengetik karena jawaban disimpan di browser dan dikirim ulang otomatis saat tersambung. Penguji menjeda ujian bila putusnya lama, lalu memberi perpanjangan waktu. Siswa tidak membawa HP, jadi tidak ada hotspot cadangan untuk seluruh kelas.

## Pertanyaan terbuka
- Pilihan akhir Claude/OpenAI dan kunci API. Paling lambat dibutuhkan saat penilaian ujian pertama, bukan saat ujian berlangsung.
