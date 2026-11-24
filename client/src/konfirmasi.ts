// client/src/konfirmasi.ts — pengganti window.confirm untuk aksi hapus/reset di halaman guru: memunculkan modal
// konfirmasi yang rapi (client/src/komponen/DialogKonfirmasi.vue, dipasang sekali di App.vue) dan menunggu jawaban.
// Dipanggil oleh: komponen guru (BukuPdf, DaftarPeserta, DaftarSoal, PerangkatDikenal) dan PenilaianUjian.vue
//                 (keluar halaman dengan nilai belum disimpan). Memanggil: tidak ada.
// Pemakaian: `if (!(await konfirmasi({ judul: 'Hapus soal?', labelOk: 'Hapus' }))) return;`
import { shallowRef } from 'vue';

export type PermintaanKonfirmasi = {
  judul: string;
  // Nama benda yang terkena (mis. judul soal), ditampilkan tebal.
  subjek?: string;
  // Apa saja yang ikut hilang/berubah, sebagai daftar.
  rincian?: string[];
  catatan?: string;
  labelOk: string;
  // Ikon Font Awesome untuk tombol & judul (tanpa awalan "fa-"), mis. 'trash', 'key'.
  ikon?: string;
  // 'error' untuk hapus permanen, 'warning' untuk aksi yang bisa diulang (reset PIN, lupakan perangkat).
  warna?: 'error' | 'warning';
};

export type KonfirmasiAktif = PermintaanKonfirmasi & { jawab: (ok: boolean) => void };

export const konfirmasiAktif = shallowRef<KonfirmasiAktif | null>(null);

export function konfirmasi(p: PermintaanKonfirmasi): Promise<boolean> {
  // Permintaan lama yang belum dijawab dianggap batal (hanya satu modal sekaligus).
  konfirmasiAktif.value?.jawab(false);
  return new Promise<boolean>((resolve) => {
    const aktif: KonfirmasiAktif = {
      ...p,
      jawab: (ok) => {
        if (konfirmasiAktif.value === aktif) konfirmasiAktif.value = null;
        resolve(ok);
      },
    };
    konfirmasiAktif.value = aktif;
  });
}
