// client/src/proyektor.ts — logika layar proyektor tanpa Vue/DOM: pembagian siswa ke halaman (maks. 30 per halaman,
// yang punya catatan aktivitas di atas) dan deteksi aktivitas baru untuk bunyi.
// Dipanggil oleh: client/src/halaman/Proyektor.vue, tests/proyektor.test.ts. Memanggil: tidak ada.

// Satu layar proyektor memuat 30 kartu tanpa gulir (permintaan pemilik 24 Nov); lebih dari itu → halaman berikutnya.
export const PER_HALAMAN = 30;
// Halaman berganti sendiri karena proyektor tidak disentuh selama ujian.
export const JEDA_GANTI_HALAMAN_MS = 10_000;

type PesertaLayar = { status: string; aktivitas: Record<string, unknown> };

// Siswa yang belum masuk tidak ditampilkan. Siswa yang punya catatan aktivitas diletakkan paling atas (urutan
// asal dari server dipertahankan di dalam tiap kelompok, jadi kartu tidak berlompatan setiap data baru datang).
export function susunHalaman<T extends PesertaLayar>(peserta: readonly T[], perHalaman = PER_HALAMAN): T[][] {
  const hadir = peserta.filter((p) => p.status !== 'belum_masuk');
  const bertanda = hadir.filter((p) => Object.keys(p.aktivitas).length > 0);
  const lain = hadir.filter((p) => Object.keys(p.aktivitas).length === 0);
  const urut = [...bertanda, ...lain];
  const halaman: T[][] = [];
  for (let i = 0; i < urut.length; i += perHalaman) halaman.push(urut.slice(i, i + perHalaman));
  return halaman.length > 0 ? halaman : [[]];
}

// Aktivitas baru = ada entri "terbaru" yang mulai lebih akhir daripada yang terakhir dilihat. Data pertama setelah
// layar dibuka hanya menjadi patokan (tidak berbunyi untuk aktivitas lama). Disengaja: laporan yang baru sampai
// belakangan (antrean offline siswa) dengan waktu mulai yang lebih lama tidak berbunyi, tetapi tetap tampil di kartu.
export function cekAktivitasBaru(terbaru: readonly { mulai_at: number }[], terakhir: number | null): { baru: boolean; terakhir: number } {
  const maks = terbaru.reduce((m, e) => Math.max(m, e.mulai_at), 0);
  if (terakhir === null) return { baru: false, terakhir: maks };
  return { baru: maks > terakhir, terakhir: Math.max(maks, terakhir) };
}
