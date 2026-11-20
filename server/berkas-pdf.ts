// server/berkas-pdf.ts — lokasi, penyajian (HTTP Range), & penghapusan berkas PDF buku di folder UPLOAD_DIR.
// Dipanggil oleh: server/routes/pdf.ts (unggah, sajikan, hapus), server/routes/ujian.ts (hapus ujian),
//                 server/routes/peserta-ujian.ts (PDF untuk siswa).
// Memanggil: node:fs, node:path, node:crypto, Express (res.sendFile).
// Alasan: nama berkas di disk selalu buatan server (32 karakter hex + .pdf), tidak pernah dari nama asli
// unggahan, sehingga tidak mungkin ada path traversal ("../../.env") lewat nama berkas.
import { randomBytes } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { NextFunction, Response } from 'express';
import { GalatHttp } from './http.ts';

const POLA_NAMA_BERKAS = /^[0-9a-f]{32}\.pdf$/;

export function namaBerkasBaru(): string {
  return `${randomBytes(16).toString('hex')}.pdf`;
}

// Path absolut sebuah berkas. Menolak nama yang tidak sesuai pola (pengaman terakhir bila isi DB aneh).
export function pathBerkas(uploadDir: string, namaBerkas: string): string {
  if (!POLA_NAMA_BERKAS.test(namaBerkas)) throw new Error(`Nama berkas PDF tidak sah: ${namaBerkas}`);
  return join(uploadDir, namaBerkas);
}

// Mengirim berkas PDF. sendFile menangani Range (206) & ETag, sehingga PDF.js bisa memuat bertahap.
// no-store: berkas tidak tertinggal di cache laptop bersama.
// `root` wajib: tanpa itu, modul send memeriksa SETIAP folder di path absolut dengan aturan dotfiles,
// sehingga UPLOAD_DIR di bawah folder berawalan titik (mis. /srv/.apps/ujian) selalu 404.
// pathBerkas tetap dipanggil untuk memvalidasi pola nama berkas.
export function kirimPdf(uploadDir: string, namaBerkas: string, res: Response, next: NextFunction): void {
  pathBerkas(uploadDir, namaBerkas);
  res.sendFile(
    namaBerkas,
    { root: uploadDir, headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store' } },
    (galat) => {
      if (!galat) return;
      if ((galat as NodeJS.ErrnoException).code === 'ENOENT') next(new GalatHttp(404, 'tidak_ditemukan'));
      else next(galat);
    },
  );
}

// Menghapus berkas; berkas yang sudah tidak ada dianggap beres. Galat lain dicatat, tidak dilempar,
// karena baris DB-nya sudah terhapus (berkas yatim tidak merusak apa pun, hanya memakan tempat).
export async function hapusBerkas(uploadDir: string, namaBerkas: string): Promise<void> {
  try {
    await unlink(pathBerkas(uploadDir, namaBerkas));
  } catch (galat) {
    if ((galat as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`Gagal menghapus berkas PDF ${namaBerkas}:`, galat);
    }
  }
}
