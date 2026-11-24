# Rencana Kerja — Aplikasi Ujian Esai Serentak

Dibuat 20 Nov 2026. Target ujian pertama: **sekitar Jumat, 4 Des 2026** (±2 pekan).

## Keputusan pemilik
| Hal | Keputusan | Catatan |
|---|---|---|
| Hosting | VPS pribadi (HTTPS, reverse proxy aaPanel, pm2) | Wi-Fi kelas memblokir koneksi antarlaptop, jadi server lokal tidak bisa dipakai. Hotspot HP tidak sanggup menampung ~31 perangkat. |
| Jumlah peserta | ~30 | Untuk skala ini SSE di satu proses Node sudah sangat cukup. |
| Sifat ujian | Latihan yang menyenangkan & menantang, bukan resmi | Risiko joki jarak jauh diterima. Mitigasinya ringan: kode ujian hanya tampil di proyektor kelas. |
| Tampilan pelanggaran di proyektor | Nama peserta | Teks netral. Penguji bisa mengganti ke inisial. |
| Data ke AI | Hanya ID acak + teks jawaban | AI hanya memberi draf. Guru mengecek ulang bersama siswa. |
| Penyedia AI | **Claude** (22 Nov), kunci diisi pemilik di `.env` | Adapter Claude + adapter tiruan untuk tes; OpenAI/model lokal menyusul bila perlu. Penilaian dilakukan setelah ujian, jadi kunci yang terlambat tidak menghambat hari-H. |
| HP di ruangan | Siswa tidak membawa HP | Pemantauan fokus pada tab/jendela lain di laptop (mis. chatbot AI di browser). |
| PDF sebelum Mulai | Boleh | Dimuat di ruang tunggu dengan PDF.js + HTTP Range. Tautan PDF per soal tetap disembunyikan sampai Mulai. |
| Real-time | SSE, tanpa WebSocket | Push hanya satu arah (server → klien); kiriman klien lewat POST. |
| UI | Tailwind + daisyUI + Font Awesome Free (npm, tanpa CDN) | — |

## Variabel yang diisi (default, bisa diubah)
| Variabel | Nilai |
|---|---|
| ATURAN_SANKSI | Hanya mencatat & memperingatkan; penguji yang memutuskan |
| DURASI_DEFAULT | Diatur per ujian; perpanjangan untuk semua atau per peserta |
| METODE_MASUK_PESERTA | Kode ujian (di proyektor) → pilih nama → PIN 4 angka buatan siswa sendiri (keputusan pemilik 20 Nov) |
| FORMAT_RUBRIK | Per soal → kriteria (nama, bobot) → deskriptor per level; plus jawaban acuan & poin wajib |
| SKALA_NILAI | 0–100 per ujian (bobot soal × bobot kriteria) |
| EVENT_INTEGRITAS | Halaman tak terlihat (langsung), blur ≥ 1 dtk, keluar layar penuh (digabung menjadi satu event per kepergian), upaya tempel teks dari luar halaman (**diblokir**), masuk ulang, koneksi terputus. Hanya dicatat saat peserta mengerjakan. Rincian di docs/DESAIN.md §6 |
| INTERVAL_AUTOSAVE | Setelah jeda mengetik 1,5 dtk + berkala 15 dtk; riwayat versi maks 1 per 30 dtk per soal |
| LATENSI_NOTIFIKASI | ≤ 3 dtk |
| TOLERANSI_DETIK | 10 dtk setelah waktu habis |
| BATAS_UKURAN_PDF | 30 MB |
| AMBANG_SELISIH | 15% dari skor maksimum kriteria |
| BAHASA_ANTARMUKA | Bahasa Indonesia, waktu WIB 24 jam |

## Dependensi di luar stack
| Paket | Status | Alasan |
|---|---|---|
| `pdfjs-dist` | Disetujui, terpasang 6.5.438 (Fase 4) | PDF di-render ke canvas di halaman yang sama. Viewer bawaan (iframe) memicu `blur` dan menampilkan tombol unduh. Yang dipakai **build legacy**: build modern memakai fitur JavaScript yang sangat baru (`Map.prototype.getOrInsertComputed`) sehingga gagal di Chrome/Edge yang belum diperbarui. Berkas pendukung (cmaps, font standar, wasm) disajikan server dari `node_modules`, tanpa CDN. Paket ini membawa dependensi **opsional** native `@napi-rs/canvas` (hanya untuk PDF.js di Node, tidak dipakai aplikasi) yang ikut terpasang lewat `npm ci`. Jangan dihapus dengan `--omit=optional`, karena binding native Vite/rolldown juga opsional dan build akan gagal. |
| `daisyui` | Disetujui | Komponen & tema siap pakai di atas Tailwind (pemilik sudah familiar dari proyek koor). |
| `vue-router` | Disetujui (20 Nov) | Alamat halaman & tombol Back untuk halaman guru/peserta/proyektor, plus pemisahan kode per peran. |
| `@fortawesome/fontawesome-free` | Disetujui | Ikon. Hanya CSS inti + set *solid* yang diimpor, dibundel Vite tanpa CDN. |
| Pustaka unggah (`multer`/`busboy`) | **Tidak diperlukan** | PDF dikirim sebagai body mentah `application/pdf` (`express.raw`, bawaan Express). CSV peserta dikirim sebagai teks JSON. |
| `uqr` | Disetujui (24 Nov), terpasang 0.1.3 (versi dikunci) | QR code di layar proyektor (alamat masuk siswa + kode ujian). Tanpa dependensi lain, MIT, hanya dibundel ke klien; QR digambar sebagai SVG di template (tanpa `v-html`). |
| `@anthropic-ai/sdk` | Disetujui (22 Nov), terpasang 1.12.0 (versi dikunci) | SDK resmi Claude untuk draf nilai AI (`server/ai/claude.ts`): kelas galat bertipe, coba ulang otomatis untuk 429/5xx, structured outputs. Hanya dipakai server; tidak masuk bundel klien. Ikut terpasang (transitif): `json-schema-to-ts`, `ts-algebra`, `@babel/runtime`, `standardwebhooks`, `@stablelib/base64`, `fast-sha256`, `@opentelemetry/api` (API saja, tanpa pengirim data). |

Perkakas bawaan stack (devDependencies, dipasang di Fase 0): `typescript` 6, `vue-tsc` (memeriksa tipe di berkas .vue), `@types/node@24` (disamakan dengan runtime Node 24), `@types/express`, `@types/better-sqlite3`, `vite` 8, `@vitejs/plugin-vue`, `tailwindcss` 4, `@tailwindcss/vite`, `vue`. Tidak ada `concurrently`/`nodemon`: Vite berjalan sebagai middleware di dalam Express dan `node --watch` menangani restart.

## Git
- **Commit di setiap akhir fase** (keputusan pemilik 20 Nov 2026).
- Remote: repo GitHub **publik** `ujian` di akun `fahmi-burhan`. Karena publik, tidak boleh ada rahasia, data peserta, PDF, atau detail SSH/host VPS di repo.
- Email commit: **noreply GitHub** (diatur global di laptop pemilik, 20 Nov 2026), jadi Gmail tidak terpajang di repo publik.

## Aturan fokus & layar penuh (keputusan pemilik 20 Nov 2026)
- Pindah tab/minimize (halaman tidak terlihat) langsung dicatat. Jendela kehilangan fokus dicatat bila **≥ 1 detik**.
- Notifikasi ke **siswa** (peringatan saat kembali ke halaman), **dasbor guru**, dan **proyektor** (dengan nama).
- **Layar penuh wajib** selama ujian. Keluar dari layar penuh dicatat, dan siswa diminta kembali ke layar penuh.

## Menunggu konfirmasi pemilik
| Hal | Dibutuhkan di | Pertanyaan |
|---|---|---|
| Kunci API Claude | Sebelum penilaian AI pertama | Pemilik membuat akun & kunci di Claude Console, lalu mengisinya sendiri di `.env` VPS (22 Nov: "saya aturkan api key di akhir"). |

## Jadwal & fase
| Tanggal | Fase | Isi | Selesai bila |
|---|---|---|---|
| 20–22 Nov | **0. Fondasi** ✅ 20 Nov | package.json, tsconfig type stripping, Express + Vite + Vue + Tailwind, runner migrasi, `.env.example`, script npm | `npm run dev` jalan di Windows, `npm test` hijau |
| 20–22 Nov | **1. Desain** ✅ 20 Nov | `docs/`: matriks peran × fase, state machine (termasuk jeda), skema DB, kontrak API & event SSE | Pemilik menyetujui desain |
| 23–24 Nov | **2. Auth & peran** ✅ 20 Nov | Login penguji (scrypt), masuk peserta (nama + PIN), sesi di SQLite, ambil alih sesi, sesi & kode proyektor | Tes matriks endpoint × peran lulus |
| 24–25 Nov | **3. Penyusunan ujian** ✅ 20 Nov | CRUD ujian/soal/rubrik/kunci, unggah PDF, impor peserta CSV, pratinjau, validasi kelengkapan | Ujian contoh lengkap bisa disiapkan |
| 26–28 Nov | **4. Alur peserta** ✅ 21 Nov (deploy 22 Nov) | Ruang tunggu, gerbang mulai, navigasi bebas, autosave berversi + buffer lokal, timer, pembaca PDF, submit/auto-submit | Ujian bisa dikerjakan dari awal sampai akhir. **Deploy pertama ke VPS** |
| 29–30 Nov | **5. Integritas & proyektor** ✅ 22 Nov | Event browser → SSE, peringatan ke peserta, dasbor penguji, layar proyektor, jeda/perpanjangan | Event muncul ≤ 3 dtk di dasbor & proyektor |
| 30 Nov–1 Des | **6. Penilaian** ✅ 22 Nov (AI siap, menunggu kunci API) | Penilaian manual dulu, lalu AI: antrean, prompt berversi, validasi Zod, tinjau/setujui, rilis, ekspor CSV | Draf nilai AI bisa ditinjau & dirilis |
| 2 Des | **7. Gladi resik** | Uji di VPS dengan 5+ perangkat, simulasi putus Wi-Fi & restart pm2, uji beban 30 peserta, README + checklist hari-H | Tidak ada jawaban hilang |
| 3 Des | Pembekuan | Hanya perbaikan bug | — |
| ~4 Des | **Ujian pertama** | — | — |

## Ringkasan per fase
**Fase 0 (20 Nov):**
- **Keputusan:** Express + Vite middleware di satu port. Mode ditentukan oleh entry point (dev.ts/main.ts), bukan `.env`, sehingga `.env` yang hilang di VPS tidak menyalakan Vite ke publik. `.env` dan DB dihitung dari akar proyek. Runner migrasi atomik, bersidik jari, dan aman untuk pola bangun-ulang tabel. Error 4xx dijawab apa adanya tanpa mencatat isi request.
- **Dampak ke fase berikutnya:** skema Fase 1 ditulis sebagai `migrations/0001_*.sql` dan tidak boleh diubah setelah dijalankan di mana pun. Kode klien memakai kode error tetap (`terlalu_besar`, `json_tidak_valid`, `permintaan_terputus`) untuk logika autosave. 34 tes lulus. Sudah ditinjau `penjaga-ujian`: 4 temuan PENTING + 8 KECIL, semuanya sudah diperbaiki.

**Fase 1 (20 Nov):**
- **Keputusan:** desain lengkap di docs/DESAIN.md (revisi 3, disetujui). Ujian tidak pernah diakhiri otomatis; detak server menjeda ujian bila server sempat mati. Autosave idempoten dengan satu kiriman per soal, satu tab aktif, dan penyangga offline yang tidak pernah dibuang diam-diam. Jawaban terlambat disimpan terpisah untuk diputuskan guru. Proyektor memakai sesi khusus. Siswa masuk dengan nama + PIN buatan sendiri. Tempel dari luar diblokir.
- **Dampak ke fase berikutnya:** skema `0001` dibekukan; perubahan berikutnya lewat migrasi baru. Fase 2 membangun sesi tiga lingkup (cookie terpisah), PIN, dan kode proyektor. Tes skema berisi "Pola server" yang wajib ditiru query di kode. Dua kali ditinjau `penjaga-ujian`, dan semua temuan sudah ditangani. 68 tes lulus.

**Fase 2 (20 Nov):**
- **Keputusan:** sesi acak 32 byte (DB hanya menyimpan sidiknya) dengan tiga cookie terpisah, cek Origin terhadap `ORIGIN_PUBLIK` (wajib di production), dan scrypt untuk password & PIN (dibatasi semafor global). Percobaan PIN dipesan atomik sebelum dicek, sehingga tebakan serentak pun paling banyak 5. Login guru diproses berurutan per username, dan browser yang pernah berhasil login ("perangkat dikenal", migrasi 0002) melewati antrean itu sehingga siswa tidak bisa memblokir guru (keputusan pemilik). Kode ujian/proyektor tanpa blokir per IP (keputusan pemilik): kode benar selalu lolos, kode salah dijawab setelah jeda 1 dtk. Akun guru dibuat lewat `npm run penguji:buat`.
- **Dampak ke fase berikutnya:** rute baru memakai `wajibSesi` + `validasi` + `GalatHttp`, dan tes HTTP memakai `tests/bantuan.ts`. Fase 3: perilaku sesi peserta saat `kembali-draf` diputuskan (hasil: sesi tetap, lihat DESAIN §12 no. 6). Fase 5: dasbor guru menampilkan log `pin_terkunci` dan tombol "Buka kunci semua" dengan konfirmasi (keputusan pemilik), serta daftar perangkat dikenal + "lupakan perangkat ini" (penting bila guru login di PC kelas bersama). Ditinjau `penjaga-ujian` tiga kali: 1 KRITIS + 7 PENTING + 14 KECIL, semuanya ditangani atau dijadwalkan. 113 tes lulus.

**Fase 3 (20 Nov):**
- **Keputusan:** halaman `/guru/ujian/:id` dengan tab Info, Soal & rubrik, Buku PDF, Peserta, dan Pratinjau. Rubrik boleh disimpan setengah jadi; kelengkapannya dicek saat "Buka ujian" oleh satu fungsi bersama (`masalahUjian`) yang dipakai server (409 `belum_lengkap`) dan daftar periksa di layar. PDF diunggah sebagai body mentah, disimpan dengan nama acak di `UPLOAD_DIR`, dan disajikan dengan Range. Impor peserta menerima CSV atau tempel langsung dari Excel. "Kembali ke draf" tidak mencabut sesi siswa: ruang tunggu menampilkan "ditutup kembali" lalu lanjut sendiri saat dibuka lagi (keputusan pemilik, DESAIN §12 no. 6). Port bawaan 8132 dan tanda fokus kustom mengikuti tema (permintaan pemilik).
- **Dampak ke fase berikutnya:** Fase 4 membuat endpoint siswa (`/api/peserta/ujian`, PDF untuk siswa, autosave) yang wajib menolak fase draf dan memakai daftar putih §8.1; SSE siswa tetap tersambung saat draf dengan event `status` saja (agar `EventSource` tidak berhenti permanen); transisi `mulai`, serta deploy pertama (nginx `client_max_body_size`). Tampilan pratinjau bisa dipakai ulang untuk halaman pengerjaan. Ditinjau `penjaga-ujian`: 2 PENTING + 12 KECIL, semuanya ditangani. 141 tes lulus.

**Fase 4 (21 Nov; deploy pertama 22 Nov oleh pemilik mengikuti docs/DEPLOY.md):**
- **Keputusan:** waktu selalu dihitung dari kolom DB (`server/waktu-ujian.ts`), dan pengecek tiap detik menangani detak, jeda otomatis setelah server mati, serta kumpul otomatis per peserta (ujian tidak pernah diakhiri otomatis). Autosave dua sisi: server memeriksa fase → soal → tab → idempotensi → waktu → versi dalam satu transaksi. Klien (`client/src/autosave.ts`, tanpa Vue) menulis penyangga sebelum mengirim, mengirim ulang kiriman yang sama saat gagal, dan tidak pernah membuang teks tanpa pilihan siswa. SSE satu modul dengan `X-Accel-Buffering: no` + detak 15 dtk. Hitung mundur klien memakai `performance.now()`, jadi kebal jam laptop yang diubah. PDF.js build legacy (lihat Dependensi), dimuat terpisah dari halaman masuk. CSP ketat di production. Jeda/Lanjutkan/Akhiri dimajukan dari Fase 5 karena jeda otomatis butuh tombol Lanjutkan. Panduan deploy di docs/DEPLOY.md + `ecosystem.config.cjs`.
- **Dampak ke fase berikutnya:** Fase 5 menambah aliran guru & proyektor di `server/sse.ts`, event integritas (`POST /api/peserta/event`), overlay layar penuh, Wake Lock, blokir tempel, perpanjangan & buka kembali (klien sudah punya `autosave.bukaKembali()`), dan dasbor yang menampilkan log `jeda_otomatis` ("Server sempat mati X menit, ujian dijeda otomatis", DESAIN §3; di Fase 4 halaman guru baru menampilkan status Dijeda) serta `akses_sebelum_mulai`. Tampilan UI siswa belum dicoba di browser sungguhan oleh agen; wajib dicoba pemilik (Chrome & Edge) sebelum gladi resik. Ditinjau `penjaga-ujian`: 0 KRITIS, 3 PENTING (login berbarengan dengan Mulai membuat siswa terjebak "menunggu"; teks tertahan "dijeda" tidak terkirim ulang; ringkasan "terkumpul" padahal masih ada teks di laptop) + 10 KECIL. Semuanya ditangani, kecuali Akhiri-saat-dijeda yang dicatat sebagai keputusan teknis (DESAIN §4). 186 tes lulus; uji asap `npm start` lewat HTTP (aset, worker PDF.js, wasm, Range, SSE) lulus.

**Fase 5 (22 Nov):**
- **Keputusan:** dasbor guru (`/guru/ujian/:id/pantau`) dan layar proyektor menerima **potret utuh** lewat SSE (`pantau` / `proyektor`). Potret dikirim saat ada perubahan (digabung per 300 ms) dan tiap 5 dtk, bukan sebagai event per perubahan. Dengan 30 siswa potretnya kecil, dan sambungan ulang tidak pernah basi. Browser siswa melapor kepergian lewat `client/src/integritas.ts`: satu kepergian = satu event, blur dihitung setelah ≥ 1 dtk, waktu kejadian dalam jam server, dan antrean laporan tahan putus Wi-Fi. Tempel dari luar diblokir memakai himpunan sidik (`client/src/tempel.ts`); hanya panjang teks yang dicatat. Layar penuh wajib (penutup editor), Wake Lock, dan Keyboard Lock (Esc ditahan) dipasang. Perpanjangan semua/per siswa, buka kembali, buka kunci semua, tandai "wajar", jawaban per siswa (hanya dibaca), perangkat dikenal (daftar & lupakan), serta koneksi putus > 10 dtk juga sudah ada. Tambahan atas permintaan pemilik: **duplikasi ujian** (peserta opsional) dan **total bobot + persentase** di tab Soal.
- **Tinjauan `penjaga-ujian`:** 0 KRITIS, 2 PENTING, dan 9 KECIL.
  - PENTING: siswa yang sudah di luar halaman saat Mulai/Lanjutkan tidak tercatat, dan sisa blur dari ruang tunggu membuat kepergian ditolak server; klaim tab yang gagal saat halaman dimuat membuat editor tampil tanpa autosave, SSE, dan blokir tempel.
  - KECIL yang diperbaiki: durasi kepergian terbuka dipotong saat siswa dikumpulkan; koreksi negatif dengan konfirmasi; layar penuh yang ditolak; tab non-aktif berhenti menulis localStorage; jam kejadian; `koneksi_putus` saat jeda; aliran guru/proyektor dengan sesi kedaluwarsa ditutup; kerapian kode.
  - Durasi saat laptop tidur (`performance.now`) dicatat TIDAK TERVERIFIKASI untuk gladi resik. 217 tes lulus.
- **Dampak ke fase berikutnya:** Fase 6 memakai `GET /api/ujian/:id/peserta/:pid/jawaban` sebagai dasar tampilan penilaian, lalu menambah keputusan jawaban terlambat (`PATCH /terlambat/:tid`) dan pemulihan versi. Perilaku layar penuh, Keyboard Lock, blur saat notifikasi Windows, dan sidebar Copilot/Edge **belum dicoba di browser sungguhan** dan wajib dicoba pemilik (Chrome & Edge) sebelum gladi resik (Fase 7).

**Fase 6 bagian manual (22 Nov):**
- **Keputusan:** tabel `penilaian` (migrasi 0003) menyimpan skor per kriteria; angka dihitung dengan rumus bersama `shared/nilai.ts`. Penilaian per soal untuk semua siswa sekaligus. Jawaban terlambat diputuskan sebelum penilaian; jawaban kosong otomatis 0; siswa tidak hadir tidak dinilai. Rilis mensyaratkan semua jawaban siswa yang hadir disetujui. Setelah rilis siswa melihat kriteria, catatan, dan jawaban acuan; aturan keras #1 diubah atas keputusan pemilik. Unduhan CSV untuk Excel. Sebelum Fase 6 ada perbaikan dari uji pemilik: PDF bergulir bersambung, dasbor otomatis setelah Mulai, persen kriteria/level di editor rubrik, soal bisa dilihat setelah dibuka, tandai "wajar" satu klik, dan dialog tanpa animasi.
- **Dampak ke langkah berikutnya:** penilaian AI tinggal mengisi tabel yang sama dengan `sumber = 'ai'` dan `status = 'draf'`, lalu guru menyetujui di halaman yang sama. Penyedia (Claude/OpenAI/model lokal lewat terowongan SSH) belum diputuskan.

**Fase 6 bagian AI (22 Nov):**
- **Keputusan:** Claude lewat SDK resmi (adapter + tiruan untuk tes; OpenAI/model lokal menyusul). Antrean di DB (migrasi 0004), satu permintaan per jawaban, model dipilih guru di halaman Penilaian (Haiku percobaan / Sonnet ujian sungguhan), batas biaya bulanan di aplikasi (bawaan $3) selain saldo prabayar & batas Console. Keluaran divalidasi (skor = level rubrik, kutipan ada di jawaban) lalu menjadi draf; gagal → `perlu_manual`. AI menulis draf catatan siswa; alasan & kutipan hanya untuk guru. Ditinjau `penjaga-ujian`: 2 PENTING (pembatas jawaban bisa ditembus varian tag → semua kurung sudut dinetralkan, dan "Setujui semua" melewati draf yang ditandai berisi instruksi; polling halaman Penilaian bisa menimpa isian dengan data basi → respons basi dibuang) + 10 KECIL (kutipan minimal 8 karakter, cadangan biaya lebih konservatif, restart dihitung sebagai percobaan, 408 = sementara, jeda coba ulang, dll.), semuanya ditangani. 242 tes lulus. Kunci hanya di `.env` (`ANTHROPIC_API_KEY`, kosong = AI nonaktif). Sekalian: logo, nama "Ujian", judul tab "Ujian | …", pemisah "|".
- **Tambahan 22 Nov (permintaan pemilik):** hapus ujian permanen (modal ketik HAPUS, tombol di tabel daftar ujian), beberapa buku per soal (migrasi 0005 membangun ulang tabel soal; dites dengan data lama), perbaikan tata letak editor soal (kotak jawaban acuan tidak lagi terdorong ke bawah oleh rubrik), logo otak + pena satu warna. Contoh soal (template rukun wudhu + 4 studi kasus al-Yaqut an-Nafis) dimasukkan langsung ke database sebagai ujian draf, **tidak** disimpan di repo karena repo publik. Ditinjau `penjaga-ujian`: 1 PENTING (ujian bisa dihapus saat permintaan AI masih di penyedia sehingga biayanya tak tercatat: sekarang ditolak, dan pencatatan biaya tahan terhadap ujian yang terhapus) + 6 KECIL (dasbor guru ujian terhapus ditutup, status yang boleh dihapus satu sumber di `shared/`, index rujukan di migrasi 0006, rujukan kembar/halaman tidak sah ditolak, dokumen), semuanya ditangani. 250 tes lulus.
- **Perbaikan setelah gladi (24 Nov, permintaan pemilik):** HP boleh dipakai ujian (kotak jawaban tidak lagi tertutup keyboard), modal konfirmasi F11, proyektor tanpa gulir (30 kartu per halaman, yang bertanda di atas, kode ujian selama ujian, bunyi aktivitas), kode ujian di dasbor, posisi baca buku diingat, modal konfirmasi hapus yang seragam, catatan AI bersekat (prompt `nilai-v2`), dan nilai ulang draf AI. QR code di proyektor (pustaka `uqr`, disetujui pemilik) membuka halaman masuk dengan kode ujian sudah terisi. Ditinjau `penjaga-ujian`: 1 PENTING (nilai ulang bisa menghapus tanda "berisi instruksi untuk penilai" dari layar guru → draf bertanda tidak ikut nilai ulang, tanda diambil dari semua hasil, saran selaras dengan draf yang tampil; `ai_run.ulang` di migrasi 0007 supaya hanya run nilai ulang yang boleh mengganti draf AI) + 10 KECIL ("Setujui semua" nonaktif selama AI menilai, teks "laptop" → "perangkat", mode ringkas HP tidak membuat ketukan meleset, klaim F11 ditandai TIDAK TERVERIFIKASI, dokumen & header), semuanya ditangani. 261 tes lulus. Di-deploy 24 Nov (migrasi 0007). Lalu: **buku diunduh utuh** dengan progres & lanjutan Range (jawaban pemilik: layar putih hanya di area buku, di laptop, saat menggulir). Ditinjau `penjaga-ujian`: 4 PENTING (siswa yang dikumpulkan lalu diperpanjang mengunduh ulang semua buku; unduhan tidak berhenti saat sesi dicabut/tab lain/halaman ditinggalkan; buku gagal tidak pernah dicoba lagi; koneksi macet menggantung antrean) + 7 KECIL (galat baca server diputus & dicatat, balapan antar generasi antrean, Content-Length terkompresi, memori dua kali, lencana gagal, posisi baca dilepas, komentar), semuanya ditangani. 273 tes lulus. Belum di-deploy (pemilik mencoba dulu).
- **Dampak ke langkah berikutnya:** begitu kunci diisi, jalankan pilot: nilai satu ujian percobaan dengan Haiku dan Sonnet, bandingkan dengan nilai manual pemilik, lalu sesuaikan `AI_EFFORT`/rubrik bila perlu. Harga di `server/ai/harga.ts` dicek ulang bila Anthropic mengubahnya.

## Catatan hosting (VPS)
- Subdomain baru di aaPanel + sertifikat TLS (dibuat pemilik). Port aplikasi **8132** (keputusan pemilik 20 Nov 2026, juga nilai bawaan `PORT`); nginx meneruskan ke `127.0.0.1:8132`.
- SSE di belakang nginx: header `X-Accel-Buffering: no` + heartbeat 15 dtk.
- `app.set('trust proxy', 1)` agar IP & cookie `secure` benar di belakang proxy.
- Backup DB berkala selama ujian dengan `db.backup()`.
- pm2 **wajib mode fork dengan `instances: 1`**. State SSE ada di memori proses, dan SQLite hanya punya satu penulis.
- Jalankan lewat npm dengan `cwd` = akar proyek (`pm2 start npm --name ujian -- start`, atau ecosystem file dengan `script: 'npm', args: 'start'`). Jangan `pm2 start server/main.ts` langsung: pm2 bisa memilih interpreter lain untuk berkas `.ts` (TIDAK TERVERIFIKASI untuk versi pm2 di VPS).
- Jangan set `NODE_ENV=production` di shell VPS sebelum `npm ci`, karena npm akan melewati devDependencies dan `npm run build` gagal (Vite tidak terpasang). Mode production sudah dijamin oleh `npm start`.
- Pastikan nginx aaPanel meneruskan `X-Forwarded-For` dan `X-Forwarded-Proto` (dicek saat deploy pertama).
- nginx `client_max_body_size` minimal `32m` (unggah PDF maksimal 30 MB); bawaan nginx 1 MB akan menolak unggahan dengan 413.
- Cadangan berkala mencakup database **dan** folder `UPLOAD_DIR` (PDF buku).
- Isi `ORIGIN_PUBLIK=https://<subdomain>` di `.env` VPS. `npm start` menolak jalan bila kosong. Cek Origin (CSRF) dan cookie `Secure` memakai nilai ini, jadi tidak bergantung pada header `Host` dari nginx.
- `better-sqlite3` 13 membawa binary `linux-x64`. Kecocokannya dengan glibc Ubuntu 22.04 dicek saat deploy pertama.
- Rencana cadangan bila Wi-Fi kelas putus: siswa tetap bisa mengetik karena jawaban disimpan di browser dan dikirim ulang otomatis saat tersambung. Penguji menjeda ujian bila putusnya lama, lalu memberi perpanjangan waktu. Siswa tidak membawa HP, jadi tidak ada hotspot cadangan untuk seluruh kelas.

## Pertanyaan terbuka
- Kunci API Claude (diisi pemilik di `.env` VPS). Paling lambat dibutuhkan saat penilaian ujian pertama, bukan saat ujian berlangsung.
- Hasil pilot AI vs nilai manual: apakah Haiku cukup, atau Sonnet perlu untuk ujian sungguhan.
