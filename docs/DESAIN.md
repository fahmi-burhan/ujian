# Desain Aplikasi Ujian Esai (Fase 1)

Status: **disetujui pemilik 20 Nov 2026** (revisi 3 + keputusan §12). Revisi 2 memperbaiki 3 temuan KRITIS, 12 PENTING, dan 9 KECIL dari tinjauan pertama `penjaga-ujian`. Revisi 3 memperbaiki 5 temuan PENTING dan temuan KECIL dari tinjauan verifikasi, serta mengganti token kertas dengan nama + PIN. Mulai sekarang [migrations/0001_skema_awal.sql](../migrations/0001_skema_awal.sql) tidak boleh diubah; perubahan skema dilakukan lewat migrasi baru.

Label yang dipakai: **FAKTA** = perilaku teknis browser/server yang bisa dicek; **KEPUTUSAN** = pilihan desain; **ASUMSI / TIDAK TERVERIFIKASI** = belum dibuktikan dan akan diuji di fase terkait.

## 1. Peran
| Peran | Cara masuk | Catatan |
|---|---|---|
| Penguji (guru) | Username + password | Akun dibuat lewat `npm run penguji:buat` (tidak ada pendaftaran publik). Satu penguji hanya melihat ujian miliknya. |
| Peserta (siswa) | Kode ujian (6 karakter, tampil di proyektor) → **pilih nama** dari daftar → **PIN 4 angka yang dibuat siswa sendiri** saat pertama masuk (diketik dua kali). Masuk berikutnya cukup PIN itu. | Kode ujian tanpa huruf/angka mirip (O/0, I/1/L). PIN berlaku untuk satu ujian dan disimpan sebagai hash. 5 kali salah → nama terkunci sampai guru membukanya. Nama "diklaim" orang lain → guru menekan **Reset PIN**. |
| Proyektor | **Sesi khusus proyektor** untuk satu ujian, dibuat dari kode sekali pakai (berlaku 10 menit) yang dibuat guru | Hanya boleh memanggil endpoint proyektor (lingkup `proyektor`). Bisa dibuka di jendela kedua laptop guru **atau** di PC kelas tanpa login guru di sana. |
| Server / AI | — | Waktu otoritatif, validasi, penyimpanan, detak, antrean penilaian (Fase 6). |

**KEPUTUSAN (K1):** layar proyektor tidak pernah memakai sesi guru. Server menegakkan daftar putih payload proyektor, dan endpoint lain menolak sesi proyektor dengan 403. Tidak ada rahasia peserta yang bisa terlihat di layar guru (PIN hanya tersimpan sebagai hash). Checklist hari-H: cek Win+P = **Extend**, bukan Duplicate.

## 2. Matriks peran × fase
| Fase | Penguji | Peserta | Proyektor | Server/AI |
|---|---|---|---|---|
| **draf** | Membuat/mengubah ujian, soal, rubrik, jawaban acuan, PDF, daftar peserta. Pratinjau tampilan peserta (dirender dari data guru, tanpa sesi peserta). | Tidak bisa masuk ("Ujian belum dibuka"). | "Ujian belum dibuka". | Validasi Zod semua input. |
| **menunggu** | Melihat siapa yang sudah masuk, **menambah** peserta, **Reset PIN** / buka kunci peserta, menekan **Mulai**, atau mengembalikan ke draf. Soal/rubrik terkunci. | Ruang tunggu: judul, petunjuk umum, durasi, jumlah soal, nama PDF, **membaca PDF**, tombol "Masuk layar penuh". Tidak melihat soal. Aktivitas fokus **tidak** dicatat. | Kode ujian (besar), judul, jumlah hadir/total, nama yang sudah hadir. | Tidak ada endpoint yang mengirim soal. Simpan/kumpul ditolak (event `akses_sebelum_mulai`, hanya untuk guru). |
| **berlangsung** | Dasbor: status tiap peserta, koneksi, progres, event. Jeda, perpanjang (semua/per peserta, termasuk koreksi turun), buka kembali peserta yang sudah mengumpulkan, tandai event "wajar", Reset PIN / buka kunci, tambah peserta, **Akhiri**. | Mengerjakan soal bebas urutan, autosave, PDF, tandai soal, kumpulkan. Wajib layar penuh. Event fokus dicatat **hanya** saat status peserta `mengerjakan`. | Sisa waktu, progres (terjawab/terkumpul), aktivitas di luar halaman (nama · jumlah · total durasi), kecuali yang ditandai wajar. | Jam otoritatif, detak tiap 5 dtk, simpan berversi, kumpul otomatis per peserta. Ujian **tidak** diakhiri otomatis. |
| **dijeda** | Lanjutkan, perpanjang, atau akhiri. | Soal **tetap terlihat**, editor terkunci, pesan "Ujian dijeda pengawas". Event fokus tidak dicatat. | "DIJEDA" + sisa waktu beku. | Waktu berhenti. Simpanan yang terlambat dijawab `dijeda`; klien menyimpannya dan mengirim ulang setelah dilanjutkan. |
| **selesai** | Melihat jawaban, riwayat versi, jawaban terlambat (terima/tolak), dan log; memulai penilaian. | Ringkasan "jawaban terkumpul"; tidak bisa mengubah. | "Selesai" + rekap jumlah terkumpul. | Kiriman setelah batas masuk ke `jawaban_terlambat`. |
| **penilaian** | Menjalankan AI/manual, meninjau, mengubah skor, menyetujui. | "Nilai belum dirilis". | Tidak dipakai. | Antrean AI (Fase 6). |
| **dirilis** | Ekspor CSV nilai; bisa menarik kembali rilis. | Nilai akhir; per soal: nilai, jawabannya sendiri, kriteria beserta level yang dicapai (deskriptor), catatan guru (field yang ditulis/disetujui guru, bukan alasan mentah AI), dan jawaban acuan. | Tidak dipakai. | — |

**KEPUTUSAN (diubah 22 Nov 2026, §12 no. 9):** setelah rilis, peserta **melihat** kriteria, level yang dicapai, catatan guru, dan jawaban acuan untuk ujiannya sendiri, supaya bisa belajar dari hasilnya. Aturan keras #1 di CLAUDE.md disesuaikan: hanya di status `dirilis`, dicek server; sebelum itu dan setelah "tarik rilis" tetap terlarang. Proyektor tidak pernah menerima ini.

## 3. State machine ujian
```
          buka                mulai              jeda / server hidup lagi
 draf ───────────▶ menunggu ───────────▶ berlangsung ◀──────────▶ dijeda
   ▲                  │                       │        lanjutkan     │
   └── kembali ───────┘                       │ akhiri (guru)        │ akhiri (guru)
       ke draf                                ▼                      │
                                           selesai ◀─────────────────┘
                                              │ mulai penilaian
                                              ▼
                                          penilaian ◀──── tarik rilis ────┐
                                              │ rilis                      │
                                              ▼                            │
                                           dirilis ────────────────────────┘
```

| Dari | Ke | Dipicu Oleh | Syarat | Efek |
|---|---|---|---|---|
| draf | menunggu | Penguji | ≥ 1 soal; tiap soal punya teks, rubrik lengkap (§9), dan jawaban acuan; ≥ 1 peserta; durasi 1–600 menit | `dibuka_at` = sekarang; soal/rubrik terkunci; peserta bisa masuk |
| menunggu | draf | Penguji | Belum dimulai | `dibuka_at` = NULL; ruang tunggu menampilkan "Ujian ditutup kembali". Sesi siswa **tidak** dicabut (Fase 3), jadi ruang tunggu lanjut sendiri bila dibuka lagi; endpoint siswa yang membawa isi ujian menolak fase draf |
| menunggu | berlangsung | Penguji | — | `dimulai_at` = `detak_at` = sekarang; peserta `menunggu` → `mengerjakan`; SSE `status` ke semua |
| berlangsung | dijeda | Penguji | — | `dijeda_at` = sekarang |
| berlangsung | dijeda | **Server saat start** | `sekarang − detak_at > 15 dtk` (server sempat mati) | `dijeda_at = detak_at` (waktu membeku sejak detak terakhir); `log_aksi` "jeda_otomatis"; dasbor guru menampilkan "Server sempat mati X menit, ujian dijeda otomatis" |
| dijeda | berlangsung | Penguji | — | `total_jeda_ms += sekarang − dijeda_at`; `dijeda_at` = NULL; `detak_at` = sekarang |
| berlangsung | selesai | Penguji ("Akhiri", konfirmasi dua langkah) | — | `diakhiri_at` = sekarang; peserta `mengerjakan` → `dikumpulkan (diakhiri_penguji)`; peserta `belum_masuk` **tetap** (= tidak hadir) |
| dijeda | selesai | Penguji ("Akhiri") | — | Seperti di atas, ditambah `total_jeda_ms += diakhiri_at − dijeda_at` dan `dijeda_at` = NULL |
| selesai | penilaian | Penguji | Toleransi 10 dtk setelah Akhiri sudah lewat (+2 dtk cadangan), dan tidak ada jawaban terlambat berstatus `menunggu` (bila belum → 409 `belum_lengkap` + `masalah`) | Jawaban kosong siswa yang hadir langsung diberi 0 di semua kriteria (`otomatis_kosong`, disetujui; §12 no. 10). Jawaban tidak bisa berubah lagi |
| penilaian | dirilis | Penguji | Semua jawaban siswa yang **hadir** (status `dikumpulkan`) punya nilai yang disetujui; siswa tidak hadir tidak dinilai (§12 no. 11) | `dirilis_at` diisi; siswa yang tersambung memuat ulang dan melihat nilainya |
| dirilis | penilaian | Penguji | — | `dirilis_at` = NULL |

**KEPUTUSAN (K2):** ujian **tidak pernah** diakhiri otomatis oleh server. Saat waktu global habis, server hanya mengumpulkan per peserta, sedangkan dasbor guru menampilkan "Waktu habis, tekan Akhiri bila sudah selesai". Dengan begitu guru tetap bisa memberi perpanjangan setelah waktu habis (misalnya Wi-Fi kelas putus di menit terakhir). Detak server menangani kasus server mati.

Status peserta:

| Dari | Ke | Dipicu Oleh | Syarat | Efek |
|---|---|---|---|---|
| belum_masuk | menunggu | Peserta masuk | Ujian `menunggu` | `masuk_pertama_at` diisi |
| belum_masuk / menunggu | mengerjakan | Peserta masuk / penguji Mulai | Ujian `berlangsung`/`dijeda` | Peserta terlambat mendapat **sisa waktu global**, bukan waktu penuh |
| mengerjakan | dikumpulkan (`manual`) | Peserta ("Kumpulkan") | Versi semua jawaban di klien = versi di server (§5) | Snapshot `jawaban_versi` alasan `kumpul` (`ON CONFLICT DO NOTHING`) |
| mengerjakan | dikumpulkan (`waktu_habis`) | Server | `sisa_ms ≤ −10000` (§4) | Sama |
| mengerjakan | dikumpulkan (`diakhiri_penguji`) | Penguji Akhiri | — | Sama. Simpanan yang masih diterima dalam toleransi 10 dtk sesudahnya juga ditulis ke riwayat (alasan `kumpul`), jadi riwayat terakhir = jawaban final |
| dikumpulkan (`waktu_habis`) | mengerjakan | Penguji: perpanjangan (global atau per peserta) | Ujian `berlangsung`/`dijeda` | `cara_kumpul`, `dikumpulkan_at` = NULL; sisa waktu menurut §4 |
| dikumpulkan (`manual`) | mengerjakan | Penguji: "Buka kembali" dengan **jumlah menit** | Ujian `berlangsung`/`dijeda` | Sama; bila sisa waktunya sudah habis, perpanjangan per peserta diterapkan sekaligus supaya sisa = X menit |

Semua transisi dijalankan di server dalam transaksi SQLite yang memeriksa "status saat ini = status asal", jadi dua klik bersamaan tidak berefek ganda. Setiap aksi guru dan aksi otomatis server dicatat di `log_aksi`.

## 4. Waktu (semua dari jam server)
```
aktif_ms(t)  = (dijeda_at ?? t) − dimulai_at − total_jeda_ms
batas_ms     = durasi_menit × 60000 + ujian.perpanjangan_ms + peserta.perpanjangan_ms
sisa_ms(t)   = batas_ms − aktif_ms(t)
akhir_efektif(peserta) = waktu nyata saat sisa_ms = 0, atau dijeda_at (bila dijeda), atau diakhiri_at,
                         mana yang paling awal
```
**Satu aturan penerimaan simpanan**, diperiksa dengan urutan berikut:
1. Diterima bila `sekarang ≤ akhir_efektif + 10 dtk` **dan** peserta tidak berstatus `dikumpulkan (manual)`.
2. Bila tidak, dan ujian sedang `dijeda` sementara waktu peserta belum habis saat jeda dimulai: `409 dijeda`. Klien menyimpannya dan mengirim ulang setelah dilanjutkan, jadi tidak ada yang hilang.
3. Selain itu (waktu habis, ujian diakhiri, atau peserta sudah mengumpulkan): kiriman disimpan di `jawaban_terlambat` dengan `202 {terlambat: true}`, dan peserta melihat "Terkirim setelah waktu habis; guru akan memutuskan".

Kumpul otomatis berjalan saat `sisa_ms ≤ −10000`, jadi simpanan yang masih di jalan masuk lebih dulu.

**Catatan implementasi (Fase 4):**
- Peserta yang sudah dikumpulkan otomatis (`waktu_habis`) selalu masuk aturan 3. Kumpul otomatis baru berjalan setelah toleransi lewat, dan jeda yang terjadi setelah waktu peserta habis akan menggeser rumus bila dihitung ulang.
- **Akhiri saat dijeda (KEPUTUSAN teknis):** setelah Akhiri, `dijeda_at` dikosongkan (CHECK skema), sehingga toleransi 10 dtk dihitung dari `diakhiri_at`, bukan dari awal jeda. Dampaknya kecil karena editor siswa terkunci selama jeda. Yang masih bisa tiba hanya teks yang sudah diketik sebelum jeda dan tertahan di jalan, dan teks itu memang milik siswa.

**Perpanjangan:** satu aturan untuk semua kasus.
- **Arti:** "sisa waktu menjadi `max(sisa sekarang, 0) + X menit`".
- **Rumus:** `perpanjangan_ms += max(0, −sisa_ms) + X × 60000`.
  - Untuk satu peserta, yang diubah `peserta.perpanjangan_ms`.
  - Untuk semua peserta, yang diubah `ujian.perpanjangan_ms` memakai sisa global.
- **Dampak ke peserta yang sudah dikumpulkan:**
  - Perpanjangan (global atau per peserta) membuka kembali peserta `waktu_habis` yang tercakup.
  - Peserta `manual` hanya dibuka lewat "Buka kembali" per peserta, yang wajib menyertakan jumlah menit.
- **Koreksi salah ketik:** X boleh negatif (−120…120, bukan 0). Hasilnya dibatasi ≥ 0.
  - Penegasan teknis (Fase 5): X negatif hanya **mengurangi perpanjangan yang sudah diberikan** (`perpanjangan_ms += X × 60000`, minimal 0), tanpa "menambal" sisa negatif ke 0 lebih dulu. Koreksi negatif tidak membuka kembali siswa.
  - Dasbor meminta konfirmasi, karena sisa yang menjadi ≤ 0 membuat siswa langsung dikumpulkan otomatis.

**Klien:**
- Klien menerima `sisa_ms` + `jam_server`, lalu menghitung mundur dengan jam **monoton** browser (`performance.now()`) sejak data diterima (Fase 4). Jam laptop yang salah atau diubah siswa tidak berpengaruh.
- Klien menyelaraskan ulang setiap ada event SSE `waktu`: tiap 30 dtk, dan setiap jeda, perpanjangan, atau sambungan ulang.
- Saat hitung mundur mencapai 0, kotak jawaban terkunci dan semua ketikan yang tertunda langsung dikirim (masih diterima sampai +10 dtk).

**Server:**
- Pengecek 1 detik menjalankan kumpul otomatis per peserta, dan memperbarui `detak_at` tiap 5 dtk.
- Pemeriksaan detak (§3) berjalan saat start **dan** di setiap putaran pengecek, selalu **sebelum** kumpul otomatis. Dengan begitu proses yang sempat macet lebih dari 15 dtk tanpa restart (mis. VM ditangguhkan) juga dijeda otomatis.
- Database menolak ujian yang sudah dimulai tetapi tidak punya `detak_at` (CHECK), jadi kelupaan mengisinya langsung ketahuan saat tes.

## 5. Autosave, tab tunggal, dan penyangga offline
**Kiriman (`PUT /api/peserta/jawaban/:soalId`):**
- Body: `{isi, ditandai, versi_dasar, id_simpan}`. `id_simpan` = UUID baru per kiriman.
- Setiap kiriman wajib membawa header `X-Tab-Id`.
- Server memproses secara berurutan:
  1. Fase ujian harus `berlangsung`/`dijeda`/`selesai`. Bila `menunggu`: 409 `belum_mulai` + event `akses_sebelum_mulai`, maks 1 event per peserta per menit. Fase dicek **sebelum** soal, supaya ID soal tidak bisa ditebak sebelum mulai.
  2. Soal harus milik ujian dari sesi. Bila tidak: 404.
  3. Tab harus = `sesi.tab_aktif`. Bila tidak: `409 tab_tidak_aktif`.
  4. **Idempotensi, sebelum aturan waktu.** Ada dua kemungkinan:
     - `id_simpan` sama dengan `jawaban.id_simpan_terakhir`, atau `isi` + `ditandai` sama persis dengan yang tersimpan → 200 dengan versi saat ini.
     - `id_simpan` sudah ada di `jawaban_terlambat` → 202 `{terlambat: true}` lagi, tanpa baris baru.
  5. Aturan penerimaan waktu (§4).
  6. Bila `versi_dasar ≠ jawaban.versi`: `409 versi_bentrok` + `{versi, isi}` milik server.
  7. Bila lolos semua: simpan sebagai `versi + 1`. Riwayat ditulis bila riwayat terakhir soal itu lebih tua dari 30 dtk atau peserta sudah dikumpulkan. Penulisannya memakai `ON CONFLICT (peserta_id, soal_id, versi) DO NOTHING`.

**Protokol pengiriman di klien (per soal):**
- **Maksimal satu kiriman di jalan per soal.** Ketikan baru selama kiriman masih di jalan hanya memperbarui penyangga, lalu dikirim setelah balasan tiba.
- **Sukses (200):** `versi_dasar` di penyangga dinaikkan ke versi balasan.
  - Bila isi penyangga sama dengan yang terkirim, penyangga dihapus.
  - Bila siswa sudah mengetik lagi, isi baru dikirim berikutnya dengan `versi_dasar` baru. Dengan begitu tidak ada bentrok palsu.
- **Timeout atau jaringan gagal:** kirim ulang **kiriman yang sama persis**, dengan `id_simpan` dan isi yang sama. Coba lagi dengan jeda 2, 4, 8 … maks 30 dtk, dan tampilkan indikator "belum tersimpan".
- **`409 versi_bentrok` di tengah sesi** (payload `{versi, isi, ditandai}` milik server):
  - Bila `isi` server sama dengan kiriman terakhir milik tab ini yang belum terbalas, `versi_dasar` disesuaikan diam-diam dan pengiriman dilanjutkan.
  - Selain itu, tampilkan dialog dua teks (lihat di bawah). Pilihan siswa dikirim sebagai versi baru dengan `konflik: true` di body, dan riwayatnya ditulis dengan alasan `konflik`.
- **`202 terlambat`:** penyangga ditandai "terkirim terlambat" dan **tidak** dikirim ulang. Pengiriman ulang hanya terjadi bila status peserta kembali `mengerjakan`, misalnya setelah perpanjangan.
- **`409 dijeda`:** penyangga disimpan, lalu dikirim setelah SSE `status` = berlangsung.

**Penyangga lokal (`localStorage`):**
- Kunci: `ujian:{ujian_id}:peserta:{peserta_id}:soal:{soal_id}`.
- Isi: `{isi, ditandai, versi_dasar, id_simpan, terkirim_terlambat, diubah_at}`, ditambah `konflik` (pilihan saat bentrok) dan `terbang` (isi kiriman yang belum terbalas). Dengan `terbang`, simpanan sendiri yang balasannya hilang karena halaman ditutup tidak dianggap bentrok saat dimuat ulang (Fase 4).
- Kirim setelah jeda mengetik 1,5 dtk, tetapi paling lambat 15 dtk sejak perubahan pertama yang belum terkirim. Permintaan yang menggantung dianggap gagal setelah 15 dtk.
- Logika ini ada di `client/src/autosave.ts` (tanpa Vue/DOM) dan dites dengan jam & server tiruan.
- Ditulis **sebelum** dikirim. Dihapus setelah sukses sesuai protokol di atas.
- **Pembersihan:** semua kunci ujian itu dihapus saat halaman melihat status `penilaian`/`dirilis` dan tidak ada penyangga yang tertunda. Ini penting untuk laptop sekolah yang dipakai bergantian. Penyangga yang sudah "terkirim terlambat" tidak dihitung tertunda karena teksnya sudah ada di `jawaban_terlambat` server. Yang benar-benar tertunda dibiarkan, dan siswa diminta memberi tahu guru.

**Saat halaman dimuat** (termasuk setelah laptop restart), untuk setiap soal yang punya penyangga, jawaban server diambil dari `GET /api/peserta/ujian`. Jawaban dikirim juga di fase `selesai` (§8.1):
- `penyangga.versi_dasar = versi server` → kirim ulang (kasus biasa).
- Isi penyangga = isi server → buang penyangga (sudah tersimpan).
- Selain itu → tampilkan **kedua teks** ke peserta ("Teks di laptop ini berbeda dengan yang tersimpan di server") dengan pilihan memakai salah satu. Penyangga **tidak pernah** dibuang otomatis dalam kasus ini.

**Kumpulkan (`POST /api/peserta/kumpulkan`):**
- Body: `{versi: {soal_id: versi}}`. Server menolak (`409 belum_tersimpan`) bila ada yang tidak cocok.
- Tombol Kumpulkan nonaktif selama masih ada penyangga yang belum terkirim.

**Satu tab aktif:**
- Setiap tab membuat `tab_id` (UUID) saat dimuat.
- Saat dimuat, tab **lebih dulu** memanggil `POST /api/peserta/tab {tab_id}`, yang mengisi `sesi.tab_aktif` dan mengirim `tab_lain_aktif` ke tab lain. **Setelah** balasannya diterima, tab baru membuka SSE.
- Tab yang menerima `tab_lain_aktif` **menutup** koneksi SSE-nya (tidak tersambung ulang otomatis), lalu menampilkan "Ujian dilanjutkan di tab lain" dengan tombol "Lanjutkan di tab ini" yang mengklaim ulang.
- SSE dengan `tab_id` yang bukan tab aktif dijawab `tab_lain_aktif` lalu ditutup. Event integritas dari tab non-aktif diabaikan.
- `tab_aktif` tersimpan di DB, jadi tahan restart server.

**Menu editor:** `spellcheck="false"`, `autocomplete="off"`, `autocorrect="off"`, `writingsuggestions="false"`, untuk mengurangi saran teks otomatis browser (lihat §6).

## 6. Batas deteksi integritas
Aturan kelas: dilarang membuka tab/jendela lain; siswa tidak membawa HP; layar penuh wajib. Event dicatat **hanya untuk kejadian saat ujian `berlangsung` dan peserta `mengerjakan`** (dinilai dari waktu kejadian, lihat "Penerimaan laporan" di bawah).

| Perilaku | Dapat Dideteksi Browser? | Sinyal yang Dipakai | Risiko Positif Palsu | Cara Ditampilkan ke Penguji |
|---|---|---|---|---|
| Pindah tab / minimize | **Ya** | `visibilitychange` → `hidden`, langsung | Rendah: laptop tertidur (dikurangi dengan Screen Wake Lock), layar ditutup | "Pindah tab/minimize · 12 dtk · 14:31 WIB" |
| Pindah ke aplikasi/jendela lain (Alt+Tab) | **Sebagian** | `blur` pada window ≥ 1 detik | Sedang: notifikasi Windows/antivirus diklik, dialog sistem, panel Win+V (ASUMSI, diuji Fase 5) | "Jendela tidak aktif · 3 dtk" |
| Keluar layar penuh | **Ya** | `fullscreenchange` | Sedang: Esc tidak sengaja. Keyboard Lock untuk Esc akan dicoba di Fase 5 (TIDAK TERVERIFIKASI di browser sekolah) | "Keluar layar penuh · kembali setelah 5 dtk" |
| Menempel teks dari luar halaman | **Sebagian**, dan **DIBLOKIR** (keputusan pemilik) | `paste` dan `drop` di editor. Teksnya dibandingkan dengan **himpunan hash semua teks** yang pernah keluar dari halaman ujian lewat `copy`, `cut`, atau `dragstart` (soal, PDF, jawaban sendiri). Agar hash sama persis: saat `copy`/`cut`, halaman sendiri yang menulis teks ke clipboard (`clipboardData.setData`), dan teks dinormalisasi (akhir baris `\r\n` → `\n`, spasi berlebih dirapikan) sebelum di-hash. Himpunan disimpan di `localStorage` per ujian+peserta, sehingga tetap ada setelah ambil-alih sesi atau tab baru di laptop yang sama. Bila tidak cocok, penempelan dibatalkan (`preventDefault`) dan upayanya dicatat | Rendah: menyeret teks di dalam editor sendiri tercakup oleh `dragstart`. **Sisa risiko:** siswa yang berpindah ke laptop lain kehilangan himpunannya (TIDAK TERVERIFIKASI: perbedaan karakter tak terlihat dari PDF.js akan diuji di Fase 5) | "Upaya menempel 230 karakter dari luar halaman (diblokir)". **Hanya panjangnya** yang dicatat, bukan isinya, karena clipboard siswa bisa berisi hal pribadi |
| Masuk ulang / sesi baru | **Ya** (server) | Login baru saat sesi lama masih aktif. Login baru **langsung mengambil alih** (keputusan pemilik): sesi lama dicabut (`diambil_alih`) | Rendah: laptop restart | "Masuk ulang (sesi baru) · Chrome/Windows" di dasbor guru |
| Koneksi terputus | **Ya** (server) | SSE terputus > 10 dtk | **Tinggi**: Wi-Fi kelas | Hanya di dasbor guru, tidak dihitung sebagai aktivitas di luar halaman, tidak tampil di proyektor |
| Simpan/kumpul sebelum ujian dimulai | **Ya** (server) | `PUT jawaban`/`kumpulkan` saat ujian `menunggu` (klien normal tidak mengirimnya) | Rendah | Hanya di dasbor guru |
| Jendela lain berdampingan (split screen) | **Dipersulit**: layar penuh wajib, dan keluar layar penuh/blur tercatat | — | — | — |
| Fitur AI bawaan browser (sidebar Copilot di Edge, "Help me write" di Chrome) | **Tidak / sebagian**. Teks bisa masuk tanpa event `paste`. Membuka sidebar mungkin memicu `blur` (TIDAK TERVERIFIKASI) | Atribut editor di §5 | — | Ditulis jujur di UI guru & README. Disarankan mematikan fitur ini di laptop sekolah |
| Monitor kedua, catatan kertas, teman sebelah | **Tidak** | — | — | Ditulis jujur: pengawasan manusia tetap diperlukan |
| Isi tab lain (mis. chatbot AI) | **Tidak**: hanya tahu siswa pindah tab, bukan apa yang dibuka | — | — | — |
| Tangkapan layar, DevTools, ekstensi browser | **Tidak** | — | — | — |

**Satu kepergian = satu event (P9).**
- Kepergian dimulai pada sinyal pertama (`hidden`, `blur` ≥ 1 dtk, atau keluar layar penuh). Kepergian berakhir saat halaman kembali terlihat, terfokus, **dan** layar penuh.
- `jenis` = sinyal terkuat (tab_tersembunyi > fokus_hilang > keluar_layar_penuh). Semua sinyal dicatat di `detail.sinyal`.
- Laporan "mulai" dikirim segera (untuk blur, setelah 1 dtk) supaya guru melihatnya ≤ 3 dtk. Laporan "selesai" membawa durasi.
- **Penerimaan laporan:**
  - Laporan **baru** ("mulai", atau "selesai" tanpa "mulai" sebelumnya) dinilai dari `mulai_klien_at`. Laporan diterima bila saat **kejadian** peserta sedang mengerjakan, bukan dilihat dari status saat laporan tiba. Laporan yang tertahan offline dan baru tiba saat dijeda tetap tercatat dengan benar.
  - Laporan **"selesai"** untuk `id_klien` yang sudah ada **selalu** diterima, dengan durasi dipotong di akhir efektif peserta. Dengan begitu tidak ada event yang terbuka selamanya walau siswa kembali setelah dijeda atau dikumpulkan.
- **UPSERT** berdasarkan `id_klien` tidak pernah membuka ulang event yang sudah selesai: `selesai_at = COALESCE(event_integritas.selesai_at, excluded.selesai_at)`, begitu juga `durasi_ms`. Urutan laporan yang terbalik (selesai tiba sebelum mulai) aman.
- **Keluar layar penuh tetapi tetap di halaman:** overlay menutup editor sampai layar penuh dipulihkan, jadi siswa tidak bisa terus mengerjakan tanpa layar penuh. Durasinya mencerminkan waktu nyata yang terlewat.

**Catatan implementasi (Fase 5):**
- Logika kepergian & antrean laporan ada di `client/src/integritas.ts` (tanpa Vue/DOM, dites dengan jam tiruan). Waktu kejadian dikirim dalam perkiraan **jam server** (`jam_server` terakhir + jam monoton), bukan jam laptop.
- Antrean laporan disimpan di `localStorage` dan dikirim ulang (2 → 30 dtk). Kepergian yang terputus karena halaman ditutup diselesaikan saat halaman dimuat lagi.
- Keluar layar penuh hanya dihitung bila terjadi saat mengerjakan. Esc di ruang tunggu tidak "tertinggal" lalu dihitung saat ujian dimulai.
- Saat pencatatan **menjadi aktif** (Mulai, Lanjutkan, dibuka kembali), keadaan halaman dibaca ulang. Siswa yang saat itu sudah berada di luar halaman tercatat sejak saat aktif; sisa blur dari ruang tunggu tidak membuat waktu mulai jatuh sebelum ujian dimulai.
- Bila klaim tab gagal saat halaman dimuat (mis. Wi-Fi putus sesaat), klaim dicoba ulang (2 → 30 dtk) dan siswa melihat pesan koneksi terputus. Himpunan salin disiapkan tanpa menunggu klaim. Tab yang diambil alih tab lain berhenti mencatat.
- Bila browser menolak layar penuh, penutup editor tidak dipakai (tombol "Layar penuh" tetap ada untuk mencoba lagi), dan kepergian "keluar layar penuh" yang sedang berjalan bisa berakhir.
- Dasbor & proyektor menampilkan **jam kejadian** (`mulai_klien_at`), bukan jam laporan tiba. Kepergian yang belum selesai milik siswa yang sudah dikumpulkan dihitung sampai saat ia dikumpulkan (juga saat Akhiri).
- **TIDAK TERVERIFIKASI:** durasi kepergian di browser memakai `performance.now()`. Belum dipastikan jam ini tetap berjalan saat laptop tidur (layar ditutup) di Chrome/Edge Windows. Bila tidak, durasi menutup laptop tercatat lebih pendek. Diuji saat gladi resik (Fase 7).
- **Akhiri** menutup kepergian yang belum dilaporkan selesai (mis. siswa menutup laptop), dengan durasi sampai saat Akhiri.
- Server mengabaikan laporan baru setelah 500 event per siswa (pengaman laporan palsu dari DevTools).
- **Batasan yang diketahui:** jeda yang sudah selesai hanya tercatat sebagai total di DB, tidak per rentang. Akibatnya laporan offline yang kejadiannya jatuh di jeda sebelumnya tetap diterima. Dampaknya kecil dan bukan sanksi.
- **Himpunan salin:** memakai hash sinkron cyrb53 (53 bit) atas teks yang sudah dinormalisasi, karena keputusan blokir harus diambil di dalam event `paste` (crypto.subtle bersifat async). Teks lengkapnya tidak disimpan. Tempel yang diblokir memunculkan pesan ke siswa bahwa teks dari halaman ujian sendiri tetap boleh.
- **Koneksi terputus:** dicatat sebagai `koneksi_putus` bila aliran SSE siswa putus > 10 dtk saat mengerjakan & ujian berlangsung, dan ditutup saat tersambung lagi. Pencatatannya ada di memori server, jadi hilang bila server dimulai ulang (server yang mati sudah menjeda ujian otomatis).
- **Keyboard Lock:** `navigator.keyboard.lock(['Escape'])` dicoba setelah masuk layar penuh. Di Chrome/Edge, Esc lalu harus ditahan untuk keluar. Tidak didukung → Esc biasa (TIDAK TERVERIFIKASI di laptop sekolah).

**Lain-lain:**
- **Screen Wake Lock** (`navigator.wakeLock`) aktif selama mengerjakan, supaya laptop tidak tidur saat siswa lama membaca PDF.
- **Proyektor** menampilkan pindah tab, jendela tidak aktif, dan keluar layar penuh yang tidak ditandai wajar, dalam format nama · jumlah · total durasi. **Upaya tempel dari luar hanya tampil di dasbor guru**, tidak di proyektor (keputusan pemilik 20 Nov), karena tempelannya sudah diblokir dan masih ada sisa risiko salah deteksi.
- **Batas pemblokiran tempel (FAKTA):** pemblokiran hanya berlaku untuk tempel/seret ke editor. Mengetik ulang dari sumber lain dan fitur AI bawaan browser yang menyisipkan teks tanpa event `paste` tidak bisa diblokir.
- **Peringatan ke siswa** saat kembali: "Kamu meninggalkan halaman ujian selama 12 detik. Aktivitas ini tercatat dan terlihat oleh pengawas." Tidak ada kata "curang".
- **PDF** dibaca dengan PDF.js di dokumen yang sama, sehingga tidak memicu `blur`.

## 7. Skema database
Rincian kolom, tipe, dan constraint ada di [migrations/0001_skema_awal.sql](../migrations/0001_skema_awal.sql), dengan komentar per kolom. Semua tabel `STRICT`, dan waktu disimpan sebagai epoch ms UTC.

| Tabel | Kolom | Tipe | Constraint | Keterangan |
|---|---|---|---|---|
| `penguji` | id, username, nama, password_hash, dibuat_at | INTEGER/TEXT | username unik NOCASE 3–32; hash berawalan `scrypt$` | Akun guru |
| `ujian` | id, penguji_id, judul, petunjuk, kode, durasi_menit, status, mode_tampil, dibuka/dimulai/dijeda/diakhiri/dirilis_at, total_jeda_ms, perpanjangan_ms, detak_at | INTEGER/TEXT | kode 6 karakter dari alfabet tanpa huruf mirip; 8 CHECK konsistensi status ↔ kolom waktu (mis. `dijeda_at` terisi ⇔ dijeda) | Inti state machine |
| `pdf` | id, ujian_id, nama_tampil, nama_berkas, ukuran_byte, sha256 | INTEGER/TEXT | nama_berkas acak unik; UNIQUE(id, ujian_id) | Berkas di `uploads/` |
| `soal` | id, ujian_id, urutan, judul, teks, bobot, rubrik_json, jawaban_acuan, pdf_id, pdf_halaman | INTEGER/TEXT | rubrik JSON valid; FK komposit (pdf_id, ujian_id), sehingga PDF harus dari ujian yang sama | Rubrik & acuan tidak pernah ke peserta |
| `peserta` | id, ujian_id, nama, nomor, pin_hash, pin_dibuat_at, pin_gagal, terkunci_at, id_anonim, status, cara_kumpul, perpanjangan_ms, masuk_pertama_at, dikumpulkan_at | INTEGER/TEXT | (ujian, nama NOCASE, nomor) unik; PIN berupa hash scrypt; pin_gagal 0–5, terkunci ⇔ 5; id_anonim unik; status ↔ cara_kumpul ↔ dikumpulkan_at konsisten | `id_anonim` dikirim ke AI menggantikan nama |
| `sesi` | id_hash, lingkup, penguji_id, peserta_id, ujian_id, tab_aktif, … | TEXT/INTEGER | PK = SHA-256 token cookie; CHECK per lingkup (tepat satu pemilik); tab_aktif hanya untuk peserta | Bisa dicabut seketika |
| `tautan_proyektor` | kode_hash, ujian_id, kedaluwarsa_at, dipakai_at | TEXT/INTEGER | hash saja; sekali pakai | Membuka proyektor tanpa login guru |
| `perangkat_guru` (migrasi 0002) | penguji_id, token_hash, info_perangkat, dipakai_at, kedaluwarsa_at | INTEGER/TEXT | hash saja; 90 hari | Perangkat dikenal untuk login guru (§8 Batas laju) |
| `jawaban` | ujian_id, peserta_id, soal_id, isi, versi, ditandai, id_simpan_terakhir, diubah_at | INTEGER/TEXT | PK (peserta, soal); **FK komposit** ke peserta & soal dari ujian yang sama; isi ≤ 50.000 | Jawaban terkini |
| `jawaban_versi` | peserta_id, soal_id, versi, isi, alasan, disimpan_at | INTEGER/TEXT | unik (peserta, soal, versi); alasan ∈ berkala/kumpul/pulih | Riwayat |
| `jawaban_terlambat` | ujian_id, peserta_id, soal_id, isi, versi_dasar, diterima_at, alasan, keputusan | INTEGER/TEXT | FK komposit; keputusan ∈ menunggu/diterima/ditolak | Teks yang tiba setelah batas tidak hilang |
| `event_integritas` | ujian_id, peserta_id, id_klien, jenis, mulai_at, mulai_klien_at, selesai_at, durasi_ms, detail_json, ditandai_wajar, catatan_penguji | INTEGER/TEXT | FK komposit (peserta, ujian); unik (peserta, id_klien) | Catatan, bukan vonis |
| `log_aksi` | ujian_id, aktor, penguji_id, aksi, detail_json, dibuat_at | INTEGER/TEXT | aktor penguji ⇔ penguji_id terisi | Jejak aksi guru & server |
| `penilaian` (0003) | ujian_id, peserta_id, soal_id, skor_json, catatan, sumber, status, versi_jawaban, dinilai_at, disetujui_at | INTEGER/TEXT | PK (peserta, soal); sumber ∈ manual/otomatis_kosong/ai; disetujui ⇔ disetujui_at | Angka nilai tidak disimpan, selalu dihitung (§9) |
| `ai_run` (0004) | ujian_id, penguji_id, model, versi_prompt, status, alasan_berhenti, dibuat_at, selesai_at | INTEGER/TEXT | maks. satu `berjalan` per ujian (index unik sebagian) | Satu kali "Nilai dengan AI" (§9a) |
| `ai_tugas` (0004) | run_id, ujian_id, peserta_id, soal_id, status, percobaan, galat, hasil_json, versi_jawaban | INTEGER/TEXT | status ∈ menunggu/berjalan/selesai/perlu_manual/dibatalkan; selesai ⇔ hasil_json | Antrean di DB, lanjut setelah restart |
| `ai_pemakaian` (0004) | ujian_id, run_id, model, token_masuk/tulis_cache/baca_cache/keluar, biaya_mikro_usd, dibuat_at | INTEGER/TEXT | biaya ≥ 0 (mikro-USD) | Dasar batas biaya bulanan |

Index dan alasannya:
- `soal(ujian_id, urutan)`: soal berurutan per ujian.
- `soal(pdf_id, ujian_id)`, `jawaban(soal_id, ujian_id)`, `jawaban_terlambat(peserta_id, ujian_id)`, `jawaban_terlambat(soal_id, ujian_id)`: kolom anak FK, supaya penghapusan/cascade tidak memindai seluruh tabel.
- `ujian(penguji_id)`, `log_aksi(penguji_id)`: daftar per pemilik & FK.
- `peserta(ujian_id, nama, nomor)` (UNIQUE): daftar pilihan nama per ujian, sekaligus mencegah nama dobel.
- `sesi(peserta_id)`, `sesi(penguji_id)`, `sesi(ujian_id)`: mencabut semua sesi seseorang atau semua sesi proyektor sebuah ujian.
- `sesi(kedaluwarsa_at)`: membersihkan sesi kedaluwarsa.
- `jawaban(ujian_id)`: ekspor & dasbor per ujian.
- `jawaban_terlambat(ujian_id, keputusan)`: daftar yang menunggu keputusan guru.
- `event_integritas(ujian_id, mulai_at)`, `log_aksi(ujian_id, dibuat_at)`: event/aksi terbaru per ujian.

## 8. Kontrak API & event real-time
**Aturan umum:**
- Aksi pada fase yang salah (mis. mengubah soal setelah ujian dibuka) → 409 `status_tidak_sesuai`. Batas jumlah (100 soal, 20 PDF per ujian) → 409 `batas_tercapai`.
- Semua body divalidasi Zod dengan skema di `shared/`. Error berbentuk `{ "error": "kode_tetap" }`.
- **Otorisasi berlapis:** setiap ID di path (`ujian`, `soal`, `pdf`, `peserta`) wajib milik ujian dari sesi (peserta) atau milik penguji dari sesi (guru). Bila tidak: 404, bukan 403, supaya keberadaannya tidak bocor.
- **CSRF:** semua metode non-GET wajib membawa header `Origin` yang sama dengan alamat aplikasi. Di VPS alamat itu diambil dari `ORIGIN_PUBLIK` di `.env` (wajib di production, server menolak start bila kosong), sehingga tidak bergantung pada header `Host`/`X-Forwarded-Proto` dari nginx. Di laptop dibandingkan dengan protokol + host permintaan. Body JSON wajib `Content-Type: application/json`. Pengecualiannya unggah PDF (`application/pdf`) dan POST tanpa body.
- **Cookie:** `HttpOnly`, `SameSite=Lax`, `Secure` bila `ORIGIN_PUBLIK` berawalan `https:`. **Satu nama per lingkup**: `sesi_guru` dan `sesi_peserta` (`Path=/`), serta `sesi_proyektor` (`Path=/api/proyektor`). Login peserta di browser guru (mis. saat mencoba) tidak mengeluarkan guru. Setiap endpoint hanya membaca cookie lingkupnya sendiri. `Max-Age` 12 jam, lalu peserta masuk lagi dengan nama + PIN yang sama untuk melihat nilai (lupa PIN → guru Reset PIN).
- **Batas laju:**
  - Login guru: **tanpa penguncian** (penguncian bisa dipicu siswa untuk mengunci guru di luar). Sebagai gantinya, password minimal 10 karakter dan setiap percobaan gagal dijawab setelah jeda tetap 1 dtk. Percobaan untuk username yang sama diproses **berurutan** (antrean per username, paling banyak 10 menunggu, selebihnya `503 server_sibuk`), jadi tebakan paralel pun tetap ±1 per detik. Menebak password 10 karakter dengan kecepatan itu tidak realistis.
    - **Perangkat dikenal** (keputusan pemilik 20 Nov 2026): antrean di atas bisa dipenuhi siswa sehingga guru ditolak `503`. Karena itu, browser yang berhasil login guru diberi cookie `perangkat_guru` (acak, HttpOnly, `SameSite=Strict`, `Path=/api/penguji/masuk`, 90 hari; DB hanya menyimpan sidiknya, maks 10 per guru). Login dari browser itu untuk username yang sama melewati antrean dan memakai jatah scrypt siswa. Batasan jalur ini: satu login per perangkat pada satu waktu (permintaan paralel lain dengan cookie yang sama masuk antrean biasa), jeda 1 dtk setiap gagal, dan 3 password salah berturut-turut membuat perangkat dilupakan. Cookie yang tertinggal di PC kelas paling banyak memberi 3 tebakan lambat, sedangkan salah ketik 1–2 kali tidak menghilangkan jalur guru. Keluar (logout) tidak melupakan perangkat; daftar & "lupakan perangkat ini" menyusul di Fase 5.
  - Login peserta: PIN salah dihitung **per peserta** (5 kali → terkunci, guru membuka). Slot percobaan dipesan secara atomik **sebelum** PIN dicek, sehingga tebakan yang dikirim serentak pun paling banyak 5 yang dicek. Penguncian dicatat di `log_aksi` (aktor server, `pin_terkunci`, beserta perangkat). **Risiko yang diterima:** teman bisa sengaja mengunci nama orang lain dengan 5 PIN salah. Ini tercatat, dan guru membuka kuncinya dengan satu klik (per nama, atau "Buka kunci semua" di dasbor guru, Fase 5).
  - Kode ujian & kode proyektor: **tanpa blokir per IP** (keputusan pemilik 20 Nov 2026). Satu kelas berbagi satu IP, sehingga blokir per IP bisa dipakai satu siswa untuk menghalangi login seluruh kelas. Kode benar selalu langsung diterima, sedangkan kode salah dijawab setelah jeda tetap 1 dtk. Ruang kode 31⁶ ≈ 887 juta (ujian) dan 31⁸ (proyektor, berlaku 10 menit), jadi menebak tetap tidak praktis.
  - Scrypt dibatasi dengan dua jatah terpisah: PIN siswa 2 berjalan + 100 menunggu, login guru 1 berjalan + 20 menunggu (`503 server_sibuk` bila penuh). Dengan begitu banjir login tidak memperlambat penyajian berkas, dan banjir di login guru (yang menerima username apa pun) tidak membuat siswa gagal masuk. 503 tidak dihitung sebagai PIN salah.

| Method/Event | Path/Nama | Peran | Fase yang Diizinkan | Body/Payload | Validasi Zod | Response | Keterangan |
|---|---|---|---|---|---|---|---|
| POST | `/api/penguji/masuk` | publik | semua | `{username, password}` | string 3–32 / 10–200 | 204 + cookie `sesi_guru` | Gagal → jeda 1 dtk, 401 `login_salah`. Antrean penuh → 503 `server_sibuk` |
| POST | `/api/penguji/keluar` | penguji | semua | — | — | 204 | Mencabut sesi |
| GET | `/api/penguji/saya` | penguji | semua | — | — | `{id, nama}` | |
| GET/POST | `/api/ujian` | penguji | — | POST: `{judul, durasi_menit}` | judul 1–200, durasi 1–600 | daftar / ujian baru | Kode ujian dibuat server |
| GET | `/api/ujian/:id` | penguji pemilik | semua | — | — | ujian + soal + rubrik + PDF + jumlah peserta + `waktu` global (null sebelum Mulai) | `waktu` tanpa perpanjangan per peserta (Fase 4) |
| PATCH | `/api/ujian/:id` | penguji pemilik | draf | `{judul?, petunjuk?, durasi_menit?}` | | ujian | |
| POST | `/api/ujian/:id/duplikat` | penguji pemilik | semua | `{salin_peserta}` | boolean | 201 ujian baru (draf, kode baru) | Menyalin judul + " (salinan)", petunjuk, durasi, mode tampil, soal + rubrik + acuan, dan PDF (berkas disalin ke nama acak baru). Peserta (nama + nomor saja, id anonim baru, tanpa PIN) hanya bila `salin_peserta`. Jawaban, event, log, dan waktu tidak ikut. Ujian asal tidak berubah (§12 no. 7) |
| PATCH | `/api/ujian/:id/tampilan` | penguji pemilik | semua | `{mode_tampil}` | nama/inisial | ujian | |
| DELETE | `/api/ujian/:id` | penguji pemilik | draf | — | — | 204 | Juga menghapus berkas PDF di disk |
| POST/PATCH/DELETE | `/api/ujian/:id/soal[/:soalId]` | penguji pemilik | draf | `{judul, teks, bobot, rubrik, jawaban_acuan, pdf_id?, pdf_halaman?}` | rubrik: §9; pdf_id milik ujian ini | soal | |
| PUT | `/api/ujian/:id/soal/urutan` | penguji pemilik | draf | `{ids}` | persis semua soal ujian ini | 204 | |
| POST | `/api/ujian/:id/pdf` | penguji pemilik | draf | body mentah `application/pdf` (maks 30 MB), header `X-Nama-Berkas` (URL-encoded) | diawali `%PDF-`, ukuran | `{id, nama_tampil, ukuran_byte, diunggah_at}` | **Tanpa dependensi unggah**: `express.raw` |
| GET | `/api/ujian/:id/pdf/:pdfId` | penguji pemilik | semua | — | — | PDF (HTTP Range) | Untuk pratinjau guru |
| DELETE | `/api/ujian/:id/pdf/:pdfId` | penguji pemilik | draf | — | — | 204 | Mengosongkan rujukan soal dulu |
| POST | `/api/ujian/:id/peserta/impor` | penguji pemilik | draf, menunggu, berlangsung, dijeda (fase selain draf hanya **menambah**) | `{csv}` | ≤ 200 baris; pemisah `,`, `;`, atau Tab (dideteksi; Tab = tempel langsung dari Excel); UTF-8 dengan/tanpa BOM; kolom `nama[,nomor]`; baris judul ("Nama", "Nama Siswa", …) dilewati | `{ditambah[], dilewati[{baris, nama, alasan}]}` | Nama kembar & baris rusak dilewati per baris, bukan menggagalkan impor. Kosong → 400 `csv_kosong`; > 200 → 400 `csv_terlalu_banyak` |
| POST | `/api/ujian/:id/peserta` | penguji pemilik | draf, menunggu, berlangsung, dijeda | `{nama, nomor?}` | | peserta | Nama + nomor kembar (tanpa beda huruf besar/kecil) → 409 `nama_sudah_ada` |
| PATCH/DELETE | `/api/ujian/:id/peserta/:pid` | penguji pemilik | draf | `{nama?, nomor?}` | | peserta / 204 | |
| GET | `/api/ujian/:id/peserta` | penguji pemilik | semua | — | — | daftar + `punya_pin`, `terkunci` (tanpa hash PIN) | |
| POST | `/api/ujian/:id/{buka,kembali-draf,mulai,jeda,lanjutkan,akhiri,mulai-penilaian,rilis,tarik-rilis}` | penguji pemilik | sesuai §3 | — | — | ujian | 409 `transisi_tidak_sah`. `buka` yang belum lengkap → 409 `belum_lengkap` + `masalah[]` (fungsi `masalahUjian` di `shared/ujian.ts`, sama dengan daftar periksa di halaman guru). Fase 3: `buka` & `kembali-draf`. Fase 4: `mulai`, `jeda`, `lanjutkan`, `akhiri` (jeda/lanjutkan dimajukan dari Fase 5 karena jeda otomatis server butuh tombol Lanjutkan). Fase 6: `mulai-penilaian`, `rilis`, `tarik-rilis` menjawab payload penilaian guru (bukan ujian); `rilis` yang belum lengkap → 409 `belum_lengkap` + `masalah[]` |
| POST | `/api/ujian/:id/perpanjang` | penguji pemilik | berlangsung, dijeda | `{menit, peserta_id?}` | menit −120…120, ≠ 0 | ujian/peserta | Aturan §4 |
| POST | `/api/ujian/:id/peserta/:pid/buka-kembali` | penguji pemilik | berlangsung, dijeda | `{menit}` | 1–120 | peserta | Sisa waktu peserta menjadi minimal X menit (§4) |
| POST | `/api/ujian/:id/proyektor/cabut` | penguji pemilik | semua | — | — | 204 | Mencabut semua sesi proyektor ujian ini (`dicabut_penguji`) |
| POST | `/api/ujian/:id/peserta/:pid/reset-pin` | penguji pemilik | semua kecuali draf | — | — | 204 | Menghapus PIN + mencabut semua sesi peserta itu (`direset_penguji`) + membuka kunci. Siswa membuat PIN baru. Dicatat di `log_aksi`. Draf → 409 `status_tidak_sesuai` |
| POST | `/api/ujian/:id/peserta/:pid/buka-kunci` | penguji pemilik | semua kecuali draf | — | — | 204 | `pin_gagal` = 0, PIN tetap. Draf → 409 `status_tidak_sesuai` |
| POST | `/api/ujian/:id/peserta/buka-kunci-semua` | penguji pemilik | semua kecuali draf | — | — | `{jumlah}` | Fase 5. Membuka semua nama yang terkunci (PIN tetap). Dasbor meminta konfirmasi. Dicatat di `log_aksi` |
| PATCH | `/api/ujian/:id/event/:eventId` | penguji pemilik | semua | `{ditandai_wajar, catatan_penguji}` | catatan ≤ 500 | 204 | Event "wajar" tidak dihitung di proyektor & ringkasan |
| GET | `/api/ujian/:id/pantau` | penguji pemilik | semua | — | — | potret (daftar field §8.1) | |
| GET | `/api/ujian/:id/peserta/:pid/jawaban` | penguji pemilik | berlangsung → dirilis | — | — | `{peserta, soal[{id, urutan, judul}], jawaban, riwayat, terlambat, event}` | Fase 5, hanya dibaca. Keputusan jawaban terlambat & pemulihan versi di Fase 6 |
| POST | `/api/ujian/:id/peserta/:pid/jawaban/:soalId/pulihkan` | penguji pemilik | selesai | `{versi}` | | jawaban | **Belum dibuat.** Riwayat alasan `pulih`. Hanya sebelum penilaian dimulai, karena jawaban tidak berubah lagi selama penilaian |
| PATCH | `/api/ujian/:id/terlambat/:tid` | penguji pemilik | berlangsung, dijeda, selesai | `{keputusan}` | diterima/ditolak | 204 | Diterima = menjadi versi baru jawaban (riwayat alasan `terlambat`). Fase 6: tidak lagi di fase penilaian, supaya jawaban yang dinilai tidak berubah |
| GET | `/api/ujian/:id/penilaian` | penguji pemilik | selesai, penilaian, dirilis | — | — | `{ujian, soal (dengan rubrik & acuan), peserta (hadir), tidak_hadir, jawaban, nilai, terlambat (menunggu)}` | Fase 6 (manual) |
| PUT | `/api/ujian/:id/penilaian/:pid/:soalId` | penguji pemilik | penilaian | `{skor: {id_kriteria: skor}, catatan, setujui}` | setiap kriteria rubrik wajib ada, skor = salah satu level; catatan ≤ 2.000 | nilai jawaban | Siswa tidak hadir → 409. Angka nilai dihitung dari skor (tidak disimpan) |
| POST | `/api/ujian/:id/penilaian/setujui/:soalId` | penguji pemilik | penilaian | — | — | `{jumlah}` | "Setujui semua" draf satu soal (aturan keras #8) |
| GET | `/api/ujian/:id/nilai.xlsx` | penguji pemilik | penilaian, dirilis | — | — | Excel .xlsx | **Unduhan utama** (§12 no. 12, diubah 22 Nov): dibuat `server/xlsx.ts` tanpa pustaka; angka sebagai angka, teks sebagai inline string (tidak pernah rumus), judul kolom tebal & dibekukan. Isi sama dengan CSV |
| GET | `/api/ujian/:id/nilai.csv` | penguji pemilik | penilaian, dirilis | — | — | CSV | Alternatif, format Indonesia | UTF-8 BOM, `;`, desimal koma, sel `= + - @` diberi `'`. Satu baris per siswa: nama, nomor, nilai tiap soal (0–100), nilai akhir; "belum dinilai" / "belum lengkap" / "tidak hadir" |
| POST | `/api/ujian/:id/tautan-proyektor` | penguji pemilik | semua | — | — | `{kode, kedaluwarsa_at}` | Kode 8 karakter, 10 menit, sekali pakai |
| POST | `/api/proyektor/masuk` | publik | semua | `{kode}` | 8 karakter dari alfabet tanpa huruf mirip | 204 + cookie `sesi_proyektor` | Halaman `/p` untuk mengetik kode |
| GET | `/api/proyektor/saya` | proyektor | semua | — | — | `{ujian{judul, status}}` | Ditambahkan Fase 2 |
| SSE | `/api/proyektor/stream` | proyektor | semua | event `proyektor` (§8.1), `sesi_dicabut` | — | stream | Ujian diambil dari sesi. "Cabut proyektor" menutup aliran dengan `sesi_dicabut` |
| SSE | `/api/ujian/:id/pantau/stream` | penguji pemilik | semua | `pantau` (potret utuh §8.1), `sesi_dicabut` (guru keluar) | — | stream | KEPUTUSAN teknis Fase 5: satu event potret utuh menggantikan `snapshot`/`peserta`/`event_integritas`/`waktu`. Potret dikirim saat koneksi dibuka, setiap ada perubahan (digabung per 300 ms), dan tiap 5 dtk |
| GET/DELETE | `/api/penguji/masuk/perangkat[/:id]` | penguji | semua | — | — | daftar `{id, info_perangkat, dibuat_at, dipakai_at, kedaluwarsa_at, ini}` / 204 | Fase 5. Di bawah `/penguji/masuk` agar cookie `perangkat_guru` ikut terkirim, sehingga server tahu "browser ini". Melupakan browser ini juga menghapus cookie-nya |
| POST | `/api/peserta/daftar-nama` | publik | semua kecuali draf | `{kode}` | 6 karakter | `{judul, peserta[{id, nama, nomor, punya_pin}]}` | Daftar untuk dipilih. Kode yang salah atau ujian draf → `kode_salah` |
| POST | `/api/peserta/masuk` | publik | semua kecuali draf | `{kode, peserta_id, pin, pin_ulang?}` | pin tepat 4 angka; `pin_ulang` wajib & sama bila belum punya PIN | 204 + cookie | Belum punya PIN → PIN dibuat. Sudah punya → dicek. Salah → 401 `pin_salah` + `sisa`. Terkunci → 423 `terkunci`. PIN direset guru saat sedang dicek/dibuat → 409 `pin_berubah`. Antrean penuh → 503 `server_sibuk` (tidak dihitung salah). Sesi lama diambil alih (event `masuk_ulang`) |
| POST | `/api/peserta/keluar` | peserta | semua | — | — | 204 | Mencabut sesi sendiri |
| GET | `/api/peserta/saya` | peserta | semua | — | — | `{nama, nomor, status, ujian{judul, status}}` | Ringkas, untuk halaman setelah masuk (ditambahkan Fase 2) |
| GET | `/api/peserta/ujian` | peserta | semua kecuali draf | — | — | §8.1 | **Soal + jawaban sendiri hanya saat berlangsung/dijeda** |
| GET | `/api/peserta/pdf/:pdfId` | peserta | menunggu, berlangsung, dijeda | — | — | PDF (HTTP Range) | Hanya PDF ujiannya (lain → 404); fase lain → 409 `status_tidak_sesuai` |
| POST | `/api/peserta/tab` | peserta | semua (Fase 4: termasuk draf, agar layar "ditutup kembali" tetap bisa membuka SSE) | `{tab_id}` | UUID | 204 | Mengklaim tab aktif; tidak membawa isi ujian |
| PUT | `/api/peserta/jawaban/:soalId` | peserta | berlangsung, dijeda, selesai (aturan §4); draf/menunggu → 409 `belum_mulai` + event (§5 langkah 1); penilaian/dirilis → 409 `status_tidak_sesuai` | `{isi, ditandai, versi_dasar, id_simpan, konflik?}` + `X-Tab-Id` | isi ≤ 50.000 | `{versi, disimpan_at}` / 202 `{terlambat: true}` | 409 `tab_tidak_aktif` / `versi_bentrok` + `{versi, isi, ditandai}` / `dijeda` |
| POST | `/api/peserta/kumpulkan` | peserta | berlangsung | `{versi: {soal_id: n}}` + `X-Tab-Id` | | 204 | 409 `belum_tersimpan`; dijeda → 409 `dijeda`; draf/menunggu → 409 `belum_mulai`. Sudah dikumpulkan → 204 (klik ganda bukan galat) |
| POST | `/api/peserta/event` | peserta | berlangsung (peserta `mengerjakan`, tab aktif) | `{id_klien, jenis, tahap, mulai_klien_at, durasi_ms?, detail?}` + `X-Tab-Id` | jenis ∈ 4 jenis klien; `detail` hanya `{sinyal?, panjang?}` (strict) | 204 | Selain kondisi itu: 204 dan diabaikan. Aturan penerimaan di §6 |
| SSE | `/api/peserta/stream?tab=<uuid>` | peserta | semua (draf: hanya event `status`) | `status`, `waktu`, `tab_lain_aktif`, `sesi_dicabut` | — | stream | Tidak tersambung ulang setelah `tab_lain_aktif`/`sesi_dicabut`. Saat draf (ujian ditutup kembali) stream tetap dijawab 200 dengan `status` saja. FAKTA: `EventSource` yang menerima status non-200 berhenti permanen, sehingga ruang tunggu tidak akan lanjut sendiri saat ujian dibuka lagi |
| GET | `/api/peserta/nilai` | peserta | dirilis (lainnya 409) | — | — | §8.1 | Siswa tidak hadir → `{hadir: false}` tanpa nilai |
| GET | `/api/ujian/:id/ai` | penguji pemilik | penilaian, dirilis | — | — | `{tersedia, model[], model_bawaan, batas_usd_bulanan, terpakai_usd_bulan_ini, belum_dinilai, perkiraan_usd{model}, run}` | Tanpa kunci API, tanpa isi jawaban. `tersedia: false` bila `ANTHROPIC_API_KEY` kosong |
| POST | `/api/ujian/:id/ai/mulai` | penguji pemilik | penilaian | `{model}` | model ∈ daftar §9a | 202 + status | 409 `ai_belum_diatur` / `ai_sedang_berjalan` / `tidak_ada_jawaban` / `batas_biaya` |
| POST | `/api/ujian/:id/ai/hentikan` | penguji pemilik | penilaian, dirilis | — | — | status | Tugas yang menunggu dibatalkan; yang sedang diproses tetap disimpan |

### 8.1 Daftar putih payload (P12)
Setiap payload punya skema Zod `.strict()` di `shared/`, dan tes otomatis memastikan kunci terlarang tidak pernah muncul.
- **Kunci terlarang untuk peserta & proyektor:** `rubrik`, `rubrik_json`, `jawaban_acuan`, `pin_hash`, `id_anonim`.
- **Kunci terlarang tambahan untuk proyektor:** `teks`, `isi`, `detail`.

Catatan: `aktivitas` dan `terbaru` di payload proyektor **tidak pernah** memuat jenis `tempel_dari_luar` (hanya untuk guru).

| Penerima | Payload | Field yang boleh |
|---|---|---|
| Peserta | `GET /api/peserta/ujian` | `id` (ujian), `status`, `waktu{sisa_ms, jam_server, dijeda}`, `judul`, `petunjuk`, `durasi_menit`, `jumlah_soal`, `pdf[{id, nama_tampil}]`, `saya{id, nama, status, cara_kumpul}`. (`id` & `saya.id` hanya untuk kunci penyangga lokal; id peserta memang sudah terlihat di daftar nama.) Hanya saat berlangsung/dijeda: `soal[{id, urutan, judul, teks, bobot, pdf_id, pdf_halaman}]`. Saat berlangsung/dijeda/selesai: `jawaban[{soal_id, isi, versi, ditandai}]` (jawaban **sendiri**, untuk mencocokkan penyangga; di fase selesai tanpa teks soal) |
| Peserta | SSE `status` | `{status}` saja (sinyal, lalu klien memanggil ulang GET) |
| Peserta | SSE `waktu` | `{sisa_ms, jam_server, dijeda}` |
| Peserta | SSE `tab_lain_aktif` / `sesi_dicabut` | `{}` / `{alasan}` dengan alasan ∈ `keluar`, `diambil_alih`, `direset_penguji`, `dihapus_penguji` |
| Peserta | `GET /api/peserta/nilai` (hanya `dirilis`) | `judul`, `status`, `hadir`, `nilai_akhir`, `soal[{urutan, judul, teks, bobot, porsi_persen, nilai_persen, jawaban (sendiri), acuan, catatan, kriteria[{nama, bobot, skor, skor_maks, deskriptor (level yang dicapai)}]}]`. Tanpa `rubrik_json` mentah, tanpa level lain, tanpa poin wajib |
| Proyektor | SSE `proyektor` | `judul`, `status`, `kode` (hanya fase menunggu), `waktu{sisa_ms, jam_server, dijeda}` (global), `hadir`, `total`, `terkumpul`, `peserta[{label, status, terjawab, jumlah_soal, aktivitas{jenis: {kali, total_ms}}}]`, `terbaru[{label, jenis, durasi_ms, mulai_at}]` (maks 8; `durasi_ms` null = masih berlangsung), `jam_server`. Hanya 3 jenis kepergian yang tidak ditandai wajar |
| Guru | `GET /penilaian` | Soal + rubrik + acuan, siswa hadir/tidak hadir, teks jawaban, nilai, kiriman terlambat, dan `saran_ai[{peserta_id, soal_id, model, status, hasil{skor, kriteria{alasan, kutipan}, catatan_siswa, indikasi_instruksi}, galat}]`. Saran AI tidak pernah dikirim ke siswa/proyektor |
| Guru | `GET /pantau` & SSE `pantau` | `ujian{id, judul, kode, status, mode_tampil, jumlah_soal, waktu}`. Per peserta: `id`, `nama`, `nomor`, `status`, `cara_kumpul`, `tersambung`, `info_perangkat`, `terjawab`, `simpan_terakhir_at`, `sisa_ms`, `perpanjangan_ms`, `punya_pin`, `terkunci`, `aktivitas` (ringkasan per jenis, tanpa yang wajar), `terlambat_menunggu`. `event[]` (maks 300 terbaru, dengan `detail` dan tanda wajar), `log[]` (maks 100 aksi terbaru), `jam_server`. **Tanpa hash PIN, id anonim, teks soal, atau isi jawaban** |

`label` = nama atau inisial sesuai `mode_tampil`. Setiap koneksi SSE baru langsung menerima `status` + `waktu` terkini (dan `snapshot`/`proyektor`), supaya event yang terlewat saat offline tidak membuat tampilan basi.

## 9. Format rubrik (disimpan di `soal.rubrik_json`)
```json
{
  "kriteria": [
    {
      "id": "k1",
      "nama": "Analisis masalah",
      "bobot": 40,
      "level": [
        { "skor": 0, "deskriptor": "Tidak mengidentifikasi masalah" },
        { "skor": 2, "deskriptor": "Mengidentifikasi sebagian masalah" },
        { "skor": 4, "deskriptor": "Mengidentifikasi masalah utama dengan alasan yang tepat" }
      ]
    }
  ],
  "poin_wajib": ["Menyebut konsep X", "Memberi contoh dari kasus"]
}
```
- **Struktur rubrik:**
  - 1–10 kriteria, dengan `bobot` bulat 1–100.
  - Tiap kriteria punya 2–6 level berisi `skor` bulat 0–10 yang unik, dan wajib ada level berskor 0.
  - `id` kriteria unik dalam satu soal.
- **Nilai soal** = Σ(skor ÷ skor_maks_kriteria × bobot_kriteria) ÷ Σ bobot_kriteria → 0–1.
- **Nilai ujian** = Σ(nilai_soal × bobot_soal) ÷ Σ bobot_soal × 100 → 0–100, dibulatkan 1 desimal.
- **Bobot bersifat relatif**, baik bobot kriteria di dalam soal maupun bobot soal di dalam ujian. Soal berbobot 20 baru bernilai "20 dari 100" bila jumlah bobot semua soal = 100. Tab "Soal & rubrik" menampilkan total bobot dan persentase tiap soal (§12 no. 8).
- **Saran menyusun rubrik:** satu kriteria = satu hal yang dinilai. Jangan mencampur dua hal (mis. "berapa poin yang disebut" dan "ketepatan rinciannya") dalam satu tangga level, karena jawaban bisa cocok ke dua level atau tidak ke level mana pun, sehingga AI maupun guru menilai tidak konsisten. Deskriptor level sebaiknya bisa dihitung atau dicek (mis. "5 dari 6 rukun disebut").
- **Diputuskan (22 Nov 2026, §12):**
  - Rubrik/acuan tetap terkunci setelah ujian dibuka (bisa dilihat, tidak bisa diubah). Untuk memakai ulang dengan perubahan, ujian diduplikasi.
  - Jawaban kosong = 0 otomatis (disetujui), tetap bisa diubah guru.
  - Siswa tidak hadir tidak dinilai; tertulis "tidak hadir" di rekap dan unduhan.
  - Angka nilai tidak disimpan di DB. Yang disimpan hanya skor per kriteria (tabel `penilaian`, migrasi 0003), jadi angka selalu konsisten dengan rumus.
  - Editor rubrik menampilkan porsi kriteria (% nilai soal) dan nilai tiap level (skor ÷ skor tertinggi kriteria).

## 9a. Draf nilai AI (Fase 6, keputusan pemilik 22 Nov 2026)
- **Penyedia:** Claude lewat SDK resmi `@anthropic-ai/sdk`, di belakang antarmuka adapter (`server/ai/adapter.ts`). Adapter lain (OpenAI, model lokal lewat terowongan SSH) menyusul bila diperlukan. Tes memakai adapter tiruan.
- **Model:** dipilih guru di halaman Penilaian setiap kali menjalankan AI: `claude-haiku-5-5` (percobaan) atau `claude-sonnet-5-5` (ujian sungguhan). Bawaannya dari `.env` (`AI_MODEL_BAWAAN`).
- **Satu permintaan per jawaban** (siswa × soal). Jawaban satu siswa tidak bisa memengaruhi penilaian siswa lain. Isi permintaan: instruksi tetap + soal, rubrik, acuan, poin wajib (di-cache) + jawaban di dalam `<jawaban_siswa>`. Semua kurung sudut di teks jawaban (termasuk varian lebar penuh) diganti `‹ ›`, jadi tidak ada tag yang bisa terbentuk dari jawaban siswa. Tanpa nama, nomor, atau ID siswa (kecuali yang ditulis siswa sendiri di jawabannya). Prompt berversi (`VERSI_PROMPT`, tersimpan di `ai_run`).
- **Keluaran** (structured outputs, lalu divalidasi Zod): per kriteria `{alasan, kutipan[], skor}`, `catatan_siswa`, `indikasi_instruksi{ada, keterangan}`. Ditolak bila: kriteria kurang/lebih, skor bukan level rubrik, kutipan tidak ditemukan di jawaban (setelah normalisasi Unicode, tanda kutip, spasi, huruf besar/kecil, tatweel) atau lebih pendek dari 8 karakter (kecuali jawabannya sendiri lebih pendek), skor > 0 tanpa kutipan, atau keluaran terpotong/ditolak. Gagal → dicoba sekali lagi → `perlu_manual`.
- **Hasil:** ditulis ke `penilaian` sebagai `sumber 'ai'`, `status 'draf'`, dengan `catatan` = `catatan_siswa` (draf untuk disunting guru). Hanya untuk jawaban yang **belum punya nilai**: nilai/draf guru tidak pernah ditimpa, dan jawaban yang dinilai guru selama antrean berjalan dilewati. Alasan & kutipan hanya tampil untuk guru; siswa hanya melihat catatan yang disetujui guru. "Setujui semua" **melewati** draf AI yang ditandai berisi instruksi untuk penilai (`indikasi_instruksi.ada`); draf itu wajib diperiksa dan disetujui satu per satu.
- **Antrean:** di DB (`ai_run`, `ai_tugas`), `AI_PARALEL` permintaan sekaligus, urut per soal. Setelah restart, tugas yang terputus dilanjutkan. Galat sementara (408/429/5xx/koneksi, setelah dicoba ulang SDK) → jeda 15 dtk lalu dicoba lagi (terbatas). Tugas yang terputus karena restart dihitung sebagai satu percobaan. Galat fatal (kunci ditolak, saldo habis, batas Console, 400) → seluruh run berhenti dengan pesan untuk guru.
- **Batas biaya bulanan** (`AI_BATAS_USD_BULANAN`, bulan kalender UTC): sebelum tiap permintaan, terpakai + cadangan permintaan yang berjalan + cadangan konservatif permintaan ini (1 token per karakter masukan + 2.000 token, tanpa diskon cache, + seluruh `max_tokens`) ≤ batas; bila tidak, run berhenti (`batas_biaya`). Biaya dihitung dari token yang dilaporkan penyedia × tabel harga resmi (`server/ai/harga.ts`, dicek 22 Nov 2026). Biaya permintaan yang gagal divalidasi tetap dihitung. ASUMSI: permintaan yang terputus karena server mati, atau yang habis waktu lalu diulang SDK, bisa ditagih penyedia tetapi tidak tercatat. Karena itu batas di Console tetap dipasang sebagai pengaman utama.
- **Thinking** adaptif dengan `AI_EFFORT` (bawaan `low`, paling murah). Naikkan bila pilot menunjukkan hasil kurang teliti.

## 10. Rute halaman (vue-router)
| Rute | Peran | Isi |
|---|---|---|
| `/` | peserta | Masuk: kode ujian → pilih nama → buat/ketik PIN |
| `/ujian` | peserta | Ruang tunggu → pengerjaan → ringkasan → nilai (satu halaman, isinya mengikuti status) |
| `/guru/masuk` | publik | Login guru |
| `/guru` | penguji | Daftar ujian |
| `/guru/ujian/:id` | penguji | Penyusunan: info, soal & rubrik, PDF, peserta, pratinjau |
| `/guru/ujian/:id/pantau` | penguji | Dasbor pemantauan + tombol "Buka layar proyektor" |
| `/guru/ujian/:id/nilai` | penguji | Tinjauan nilai (Fase 6) |
| `/p` | publik → proyektor | Mengetik kode proyektor, lalu layar proyektor tanpa navigasi apa pun |

- Halaman `/guru/*` dan `/p` dimuat terpisah (lazy), sehingga kodenya tidak ikut terunduh ke laptop siswa.
- Tombol "Buka layar proyektor" membuat kode baru, lalu membuka `/p?kode=…` di **jendela baru**. Kode langsung dihapus dari alamat setelah ditukar menjadi sesi.

## 11. Yang sengaja tidak dibuat
- Mencegah tangkapan layar, mengunci laptop, atau mendeteksi aplikasi lain. **FAKTA:** browser tidak bisa melakukannya.
- Vonis "curang" atau sanksi otomatis.
- Mengakhiri ujian secara otomatis (lihat K2 di §3).

## 12. Keputusan pemilik (20 Nov 2026)
1. **Login ulang saat sesi lama masih aktif:** login baru langsung mengambil alih. Sesi lama dicabut, dan event "masuk ulang" muncul di dasbor guru dengan info perangkat.
2. **Saat dijeda:** soal tetap terlihat, editor terkunci.
3. **Menempel teks dari luar halaman:** diblokir. Upayanya dicatat (panjang teks saja) dan tampil seperti aktivitas lain. Teks yang disalin dari halaman ujian sendiri tetap boleh ditempel.
4. **Cara masuk siswa:** kode ujian → pilih nama → PIN 4 angka yang dibuat siswa sendiri (menggantikan token kertas). MAC address tidak bisa dipakai (FAKTA: browser tidak memberi akses ke identitas perangkat keras).
5. **Batas laju (tinjauan Fase 2):** kode ujian & proyektor tanpa blokir per IP (kode benar selalu lolos, kode salah dijeda 1 dtk). Login guru memakai "perangkat dikenal" agar tidak bisa diblokir siswa. Dasbor guru mendapat tombol "Buka kunci semua" (Fase 5).
6. **Kembali ke draf (tinjauan Fase 3):** siswa di ruang tunggu tidak dikeluarkan. Layarnya menampilkan "Ujian ditutup kembali oleh guru" dan kembali ke ruang tunggu biasa saat guru membuka lagi, tanpa mengetik PIN ulang. Selama draf, siswa hanya menerima sinyal status, tanpa isi ujian apa pun.
7. **Duplikasi ujian (22 Nov):** ujian dari status apa pun bisa diduplikasi menjadi draf baru (soal, rubrik, acuan, PDF, petunjuk, durasi). Daftar peserta ikut disalin hanya bila guru mencentangnya di dialog (nama + nomor, tanpa PIN).
8. **Tampilan bobot (22 Nov):** tab "Soal & rubrik" menampilkan total bobot dan persentase tiap soal. Rumus §9 tidak berubah.
9. **Hasil untuk siswa (22 Nov):** setelah dirilis, siswa melihat nilai akhir; per soal: nilai, jawabannya, kriteria & level yang dicapai, catatan guru, dan jawaban acuan. Aturan keras #1 diubah untuk ini (hanya status `dirilis`).
10. **Jawaban kosong (22 Nov):** otomatis 0 saat penilaian dimulai.
11. **Tidak hadir (22 Nov):** tidak dinilai, ditulis "tidak hadir".
12. **Unduhan nilai (22 Nov, diubah):** CSV ternyata berantakan di Windows berformat en-US (pemisah `,`, desimal `.`), dan format CSV yang rapi di semua pengaturan tidak ada. Unduhan utama menjadi **.xlsx** (dibuat sendiri tanpa dependensi baru), dengan tautan CSV format Indonesia sebagai alternatif.
13. **Penilaian AI (22 Nov):** penyedia Claude dulu; adapter OpenAI/model lokal menyusul. Model dipilih guru di halaman Penilaian (Haiku untuk percobaan, Sonnet untuk ujian sungguhan). Batas biaya dihitung per bulan (bawaan $3). AI menulis draf catatan untuk siswa yang disunting/disetujui guru. Rincian di §9a.
14. **Tampilan (22 Nov):** nama aplikasi "Ujian" (bukan "Ujian Esai"), logo padat-minimal satu warna: otak dengan lekuk sebagai celah + pena yang menulis, tanpa latar (`client/src/komponen/LogoUjian.vue`; ikon tab `client/public/logo.svg`), dipasangkan dengan nama "ujian" huruf kecil tebal (`MerekUjian.vue`), judul tab "Ujian | Halaman", dan pemisah "|" menggantikan tanda pisah di teks tampilan.
