// client/src/buku.ts — antrean unduhan buku PDF utuh untuk siswa (dengan progres) dan posisi baca per buku, TANPA
// PDF.js (jadi boleh diimpor halaman ujian tanpa ikut membawa PDF.js yang besar; PDF.js tetap dimuat terpisah oleh
// PembacaPdf.vue lewat client/src/pdf.ts).
// Dipanggil oleh: client/src/halaman/UjianPeserta.vue (siapkanBuku/hentikanUnduhan/lupakanBuku), client/src/pdf.ts (ambilDataBuku),
//                 PembacaPdf.vue (posisi baca, progres), ProgresBuku.vue & Pengerjaan.vue (statusBuku, ulangiBuku).
// Memanggil: client/src/unduh-buku.ts.
// Alasan (gladi 24 Nov): sebelumnya PDF.js memuat buku bagian demi bagian (HTTP Range) saat halaman digulir, sehingga
// di Wi-Fi kelas yang padat halaman tampil putih lama. Sekarang semua buku diunduh utuh satu per satu sejak ruang
// tunggu (progres terlihat), buku yang sedang dibuka siswa didahulukan, unduhan yang putus dilanjutkan dari byte
// terakhir, lalu PDF.js membaca dari memori tanpa jaringan. Isinya hanya di memori halaman (server mengirim
// no-store), jadi tidak tertinggal di perangkat; memuat ulang halaman = unduh ulang.
import { reactive } from 'vue';
import { GalatUnduhTetap, unduhPenuh } from './unduh-buku.ts';

// ---- Antrean unduhan ----
export type KeadaanBuku = { keadaan: 'menunggu' | 'mengunduh' | 'siap' | 'gagal'; diterima: number; total: number | null; tetap: boolean };
// Reaktif: ProgresBuku.vue, tombol "Buku", dan pembaca menampilkan progres dari sini.
export const statusBuku = reactive(new Map<number, KeadaanBuku>());

// `generasi`: setiap kali unduhan dihentikan, generasi naik. Tugas dari generasi lama yang baru selesai/gagal belakangan
// tidak boleh mengubah antrean/status generasi baru (mencegah unduhan ganda saat status ujian bolak-balik).
type Tugas = {
  id: number;
  generasi: number;
  mulai: boolean;
  janji: Promise<Uint8Array>;
  selesai: (data: Uint8Array) => void;
  gagal: (e: unknown) => void;
};
const tugas = new Map<number, Tugas>();
const ukuranBuku = new Map<number, number | null>();
let daftarAktif: readonly { id: number }[] = [];
let antrean: Tugas[] = [];
let aktif = 0;
let generasi = 0;
let pembatal = new AbortController();

async function jalankan(t: Tugas): Promise<void> {
  t.mulai = true;
  aktif += 1;
  const s = statusBuku.get(t.id);
  const batal = pembatal.signal;
  try {
    if (s) s.keadaan = 'mengunduh';
    const data = await unduhPenuh(`/api/peserta/pdf/${t.id}`, {
      ukuran: ukuranBuku.get(t.id) ?? null,
      batal,
      saatProgres: (p) => {
        if (!s || t.generasi !== generasi) return;
        s.diterima = p.diterima;
        if (p.total !== null) s.total = p.total;
      },
    });
    if (t.generasi === generasi && s) {
      s.keadaan = 'siap';
      s.diterima = data.length;
      s.total = data.length;
    }
    t.selesai(data);
  } catch (e) {
    if (t.generasi === generasi) {
      if (s) {
        s.keadaan = 'gagal';
        s.tetap = e instanceof GalatUnduhTetap;
      }
      if (tugas.get(t.id) === t) tugas.delete(t.id);
    }
    t.gagal(e);
  } finally {
    if (t.generasi === generasi) {
      aktif -= 1;
      pompa();
    }
  }
}

// Satu buku sekaligus supaya buku pertama cepat siap (tidak berbagi pita dengan buku lain).
function pompa(): void {
  while (aktif < 1 && antrean.length > 0) void jalankan(antrean.shift() as Tugas);
}

// `segera` = siswa sedang membuka buku ini: langsung diunduh walau buku lain masih berjalan.
function antrekan(id: number, segera: boolean): Promise<Uint8Array> {
  const ada = tugas.get(id);
  if (ada) {
    if (segera && !ada.mulai) {
      antrean = antrean.filter((t) => t !== ada);
      void jalankan(ada);
    }
    return ada.janji;
  }
  let selesai: (data: Uint8Array) => void = () => {};
  let gagal: (e: unknown) => void = () => {};
  const janji = new Promise<Uint8Array>((a, b) => {
    selesai = a;
    gagal = b;
  });
  // Kegagalan ditangani pemanggil (pembaca/progres); jangan jadi "unhandled rejection" bila tidak ada yang menunggu.
  janji.catch(() => {});
  const t: Tugas = { id, generasi, mulai: false, janji, selesai, gagal };
  tugas.set(id, t);
  statusBuku.set(id, { keadaan: 'menunggu', diterima: 0, total: ukuranBuku.get(id) ?? null, tetap: false });
  if (segera) void jalankan(t);
  else {
    antrean.push(t);
    pompa();
  }
  return janji;
}

// Dipanggil setiap data ujian siswa dimuat (ruang tunggu & selama ujian; saat itu server memang membuka buku).
// Aman dipanggil berulang. Buku yang tadinya gagal (termasuk ditolak server, mis. ujian sempat ditutup kembali)
// diantrekan lagi.
export function siapkanBuku(daftar: readonly { id: number; ukuran_byte: number }[]): void {
  daftarAktif = daftar;
  for (const b of daftar) {
    ukuranBuku.set(b.id, b.ukuran_byte);
    if (tugas.has(b.id)) continue;
    if (statusBuku.get(b.id)?.keadaan === 'gagal') statusBuku.delete(b.id);
    void antrekan(b.id, false).catch(() => {});
  }
}

// Tombol "Coba lagi" setelah unduhan gagal.
export function ulangiBuku(id: number): void {
  if (statusBuku.get(id)?.keadaan !== 'gagal') return;
  statusBuku.delete(id);
  void antrekan(id, true).catch(() => {});
}

// Wi-Fi tersambung lagi: buku yang gagal karena jaringan dicoba lagi sendiri.
// (Lewat globalThis karena modul ini juga dimuat tes di Node, yang tidak punya `window`.)
const jendela = globalThis as unknown as { addEventListener?: (nama: string, f: () => void) => void };
jendela.addEventListener?.('online', () => {
  for (const b of daftarAktif) {
    const s = statusBuku.get(b.id);
    if (s?.keadaan === 'gagal' && !s.tetap) ulangiBuku(b.id);
  }
});

// Siswa sudah mengumpulkan (tapi ujian masih berjalan): unduhan yang belum selesai dihentikan, buku yang SUDAH siap
// tetap disimpan, supaya perpanjangan waktu / "buka kembali" tidak membuat 24 siswa mengunduh ulang semua buku.
export function hentikanUnduhan(): void {
  generasi += 1;
  pembatal.abort();
  pembatal = new AbortController();
  antrean = [];
  aktif = 0;
  daftarAktif = [];
  for (const [id, t] of [...tugas]) {
    if (statusBuku.get(id)?.keadaan === 'siap') continue;
    tugas.delete(id);
    statusBuku.delete(id);
    t.gagal(new Error('unduhan dihentikan'));
  }
}

// Ujian selesai / siswa keluar / sesi berakhir / halaman ditinggalkan: semuanya dihentikan dan memori dilepas,
// termasuk posisi baca (perangkat bisa dipakai siswa lain).
export function lupakanBuku(): void {
  hentikanUnduhan();
  tugas.clear();
  statusBuku.clear();
  ukuranBuku.clear();
  posisi.clear();
  bukuTerakhir = null;
  for (const f of pembersih) f();
}

// client/src/pdf.ts mendaftarkan penutup dokumen PDF.js di sini (supaya modul ini tidak perlu mengimpor PDF.js).
const pembersih: (() => void)[] = [];
export function saatLupakanBuku(f: () => void): void {
  pembersih.push(f);
}

// Data buku utuh untuk PDF.js; buku ini langsung didahulukan bila belum diunduh.
export function ambilDataBuku(id: number): Promise<Uint8Array> {
  return antrekan(id, true);
}
// Dokumen gagal dibuka dari data ini (mis. berkas rusak): data dilepas supaya "Coba lagi" mengunduh ulang. Hanya bila
// datanya masih milik tugas yang sama (tidak menghapus unduhan baru yang dimulai sesudahnya).
export function lepasDataBuku(id: number, janji: Promise<Uint8Array>): void {
  const t = tugas.get(id);
  if (!t || t.janji !== janji) return;
  tugas.delete(id);
  if (statusBuku.get(id)?.keadaan === 'siap') statusBuku.delete(id);
}

// ---- Posisi baca ----
// Posisi baca per buku (halaman & zoom) dan buku yang terakhir dibuka, selama halaman ujian terbuka. Disimpan di
// modul (bukan di komponen), karena panel buku dilepas saat ditutup: saat dibuka lagi atau saat siswa kembali ke
// buku sebelumnya, ia mendarat di halaman terakhir yang dibacanya (permintaan pemilik 24 Nov).
export type PosisiBuku = { halaman: number; zoom: number };
const posisi = new Map<number, PosisiBuku>();
let bukuTerakhir: number | null = null;

export function ingatPosisi(pdfId: number, p: Partial<PosisiBuku>): void {
  const lama = posisi.get(pdfId) ?? { halaman: 1, zoom: 1 };
  posisi.set(pdfId, { ...lama, ...p });
  bukuTerakhir = pdfId;
}

export function posisiBuku(pdfId: number): PosisiBuku | null {
  return posisi.get(pdfId) ?? null;
}

export function bukaTerakhir(): number | null {
  return bukuTerakhir;
}

// "12,3" (MB, satu desimal, koma Indonesia) untuk teks progres.
export function formatMb(byte: number): string {
  return (byte / 1_048_576).toFixed(1).replace('.', ',');
}
