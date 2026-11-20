// server/berkas-pdf.ts — lokasi & penghapusan berkas PDF buku di folder UPLOAD_DIR.
// Dipanggil oleh: server/routes/pdf.ts (unggah, sajikan, hapus), server/routes/ujian.ts (hapus ujian).
// Memanggil: node:fs, node:path, node:crypto.
// Alasan: nama berkas di disk selalu buatan server (32 karakter hex + .pdf), tidak pernah dari nama asli
// unggahan, sehingga tidak mungkin ada path traversal ("../../.env") lewat nama berkas.
import { randomBytes } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';

const POLA_NAMA_BERKAS = /^[0-9a-f]{32}\.pdf$/;

export function namaBerkasBaru(): string {
  return `${randomBytes(16).toString('hex')}.pdf`;
}

// Path absolut sebuah berkas. Menolak nama yang tidak sesuai pola (pengaman terakhir bila isi DB aneh).
export function pathBerkas(uploadDir: string, namaBerkas: string): string {
  if (!POLA_NAMA_BERKAS.test(namaBerkas)) throw new Error(`Nama berkas PDF tidak sah: ${namaBerkas}`);
  return join(uploadDir, namaBerkas);
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
