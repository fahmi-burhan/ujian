// server/http.ts — galat HTTP terkendali dan validasi input dengan Zod.
// Dipanggil oleh: semua berkas di server/routes/, server/auth/penjaga.ts, penangan galat di server/app.ts.
// Memanggil: zod.
// Alasan: rute cukup `throw new GalatHttp(404, 'tidak_ditemukan')`; penangan galat di app.ts yang
// mengubahnya menjadi respons { error: kode }. Express 5 meneruskan galat dari fungsi async otomatis.
import type { z } from 'zod';

export class GalatHttp extends Error {
  status: number;
  kode: string;
  // Data tambahan yang aman dikirim ke klien (mis. { sisa: 3 } untuk PIN salah).
  data: Record<string, unknown>;

  constructor(status: number, kode: string, data: Record<string, unknown> = {}) {
    super(kode);
    this.status = status;
    this.kode = kode;
    this.data = data;
  }
}

// Memvalidasi data (body/params) dengan skema Zod. Gagal → 400 input_tidak_valid.
// Detail galat Zod sengaja TIDAK dikirim ke klien agar tidak membocorkan struktur internal.
export function validasi<S extends z.ZodType>(skema: S, data: unknown): z.output<S> {
  const hasil = skema.safeParse(data);
  if (!hasil.success) throw new GalatHttp(400, 'input_tidak_valid');
  return hasil.data;
}

export function tunda(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
