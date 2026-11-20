// client/src/api.ts — satu-satunya pintu klien untuk memanggil server (/api/...).
// Dipanggil oleh: semua halaman di client/src/halaman/ dan client/src/router.ts.
// Memanggil: fetch bawaan browser, zod (memvalidasi respons dengan skema dari shared/).
// Alasan: setiap respons divalidasi skema yang sama dengan server (daftar putih .strict()), dan setiap
// galat diubah menjadi GalatApi berisi kode tetap, sehingga halaman cukup menampilkan pesanGalat(kode).
import type { z } from 'zod';
import { GalatSchema } from '../../shared/auth.ts';

export class GalatApi extends Error {
  status: number;
  kode: string;
  data: Record<string, unknown>;

  constructor(status: number, kode: string, data: Record<string, unknown> = {}) {
    super(kode);
    this.status = status;
    this.kode = kode;
    this.data = data;
  }
}

type OpsiApi<T> = {
  body?: unknown;
  // Body mentah (unggah PDF): isi berkas, Content-Type, dan header tambahan.
  mentah?: { isi: Blob; tipe: string; header?: Record<string, string> };
  skema?: z.ZodType<T>;
};

// Contoh: const saya = await api('GET', '/api/penguji/saya', { skema: PengujiSayaSchema });
// Tanpa skema → respons diabaikan (untuk 204 No Content).
export async function api<T = void>(method: string, path: string, opsi: OpsiApi<T> = {}): Promise<T> {
  let respons: Response;
  try {
    respons = await fetch(path, {
      method,
      // Cookie sesi ikut terkirim (same-origin). Browser otomatis menambahkan header Origin
      // untuk POST, yang diperiksa server sebagai perlindungan CSRF.
      credentials: 'same-origin',
      headers: opsi.mentah
        ? { 'Content-Type': opsi.mentah.tipe, ...opsi.mentah.header }
        : opsi.body === undefined
          ? {}
          : { 'Content-Type': 'application/json' },
      body: opsi.mentah ? opsi.mentah.isi : opsi.body === undefined ? undefined : JSON.stringify(opsi.body),
      cache: 'no-store',
    });
  } catch {
    throw new GalatApi(0, 'jaringan');
  }
  if (!respons.ok) {
    const isi: unknown = await respons.json().catch(() => ({}));
    const galat = GalatSchema.safeParse(isi);
    if (galat.success) {
      const { error, ...data } = galat.data;
      throw new GalatApi(respons.status, error, data);
    }
    throw new GalatApi(respons.status, 'kesalahan_server');
  }
  if (!opsi.skema) return undefined as T;
  return opsi.skema.parse(await respons.json());
}

// Pesan ramah (netral, tidak menuduh) untuk setiap kode galat.
const PESAN: Record<string, string> = {
  jaringan: 'Tidak bisa menghubungi server. Periksa koneksi Wi-Fi, lalu coba lagi.',
  input_tidak_valid: 'Isian belum sesuai. Periksa kembali.',
  belum_masuk: 'Sesi sudah berakhir. Silakan masuk lagi.',
  asal_tidak_sah: 'Permintaan ditolak. Muat ulang halaman, lalu coba lagi.',
  tidak_ditemukan: 'Data tidak ditemukan.',
  server_sibuk: 'Server sedang melayani banyak permintaan. Tunggu sebentar, lalu coba lagi.',
  status_tidak_sesuai: 'Aksi ini belum bisa dilakukan pada tahap ujian sekarang.',
  transisi_tidak_sah: 'Status ujian sudah berubah. Muat ulang halaman.',
  belum_lengkap: 'Ujian belum lengkap. Periksa daftar yang perlu dilengkapi.',
  nama_sudah_ada: 'Nama dengan nomor yang sama sudah ada di daftar.',
  batas_tercapai: 'Jumlahnya sudah mencapai batas maksimum.',
  bukan_pdf: 'Berkas bukan PDF. Pilih berkas berakhiran .pdf.',
  csv_kosong: 'Tidak ada nama yang terbaca. Pastikan kolom pertama berisi nama.',
  csv_terlalu_banyak: 'Paling banyak 200 nama sekali impor.',
  terlalu_besar: 'Berkas atau isian terlalu besar (PDF maksimal 30 MB).',
  login_salah: 'Username atau password salah.',
  kode_salah: 'Kode ujian tidak ditemukan atau ujian belum dibuka. Cek kode di layar depan.',
  pin_salah: 'PIN salah.',
  pin_tidak_sama: 'Kedua PIN tidak sama. Ketik ulang.',
  pin_berubah: 'PIN nama ini baru saja direset guru. Pilih namamu lagi untuk membuat PIN baru.',
  terkunci: 'Nama ini terkunci karena PIN salah 5 kali. Minta guru membuka kuncinya.',
  kesalahan_server: 'Terjadi kesalahan di server. Coba lagi sebentar lagi.',
};

export function pesanGalat(galat: unknown): string {
  if (galat instanceof GalatApi) {
    const dasar = PESAN[galat.kode] ?? PESAN.kesalahan_server ?? '';
    if (galat.kode === 'pin_salah' && typeof galat.data.sisa === 'number') {
      return `${dasar} Sisa ${galat.data.sisa} kali percobaan sebelum nama terkunci.`;
    }
    return dasar;
  }
  return PESAN.kesalahan_server ?? '';
}
