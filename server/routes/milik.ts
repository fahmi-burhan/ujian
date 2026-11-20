// server/routes/milik.ts — pemeriksaan "ujian/peserta ini milik guru yang sedang masuk" dan "ujian sedang
// di fase yang mengizinkan aksi ini", dipakai semua rute guru di bawah /api/ujian.
// Dipanggil oleh: server/routes/ujian.ts, soal.ts, pdf.ts, peserta-guru.ts, ujian-admin.ts.
// Memanggil: server/auth/penjaga.ts (sesi dari res.locals), server/http.ts, database.
// Aturan (docs/DESAIN.md §8): ID milik guru lain dijawab 404, bukan 403, supaya keberadaannya tidak bocor.
// Fase yang salah dijawab 409 status_tidak_sesuai (mis. mengubah soal setelah ujian dibuka).
import type { Response } from 'express';
import { z } from 'zod';
import type { StatusUjian } from '../../shared/auth.ts';
import { sesiDari } from '../auth/penjaga.ts';
import { GalatHttp } from '../http.ts';
import type { Konteks } from '../konteks.ts';

// Parameter path. z.coerce: nilai dari URL selalu teks.
export const ParamUjian = z.object({ id: z.coerce.number().int().positive() });
export const ParamPeserta = ParamUjian.extend({ pid: z.coerce.number().int().positive() });
export const ParamSoal = ParamUjian.extend({ soalId: z.coerce.number().int().positive() });
export const ParamPdf = ParamUjian.extend({ pdfId: z.coerce.number().int().positive() });

export type UjianMilik = { id: number; status: StatusUjian };

export function ujianMilik(k: Konteks, res: Response, ujianId: number): UjianMilik {
  const ujian = k.db
    .prepare('SELECT id, status FROM ujian WHERE id = ? AND penguji_id = ?')
    .get(ujianId, sesiDari(res).pengujiId) as UjianMilik | undefined;
  if (!ujian) throw new GalatHttp(404, 'tidak_ditemukan');
  return ujian;
}

export function wajibStatus(ujian: UjianMilik, boleh: readonly StatusUjian[]): void {
  if (!boleh.includes(ujian.status)) throw new GalatHttp(409, 'status_tidak_sesuai');
}

// Ujian milik guru + fase yang diizinkan, sekaligus.
export function ujianMilikDiStatus(
  k: Konteks,
  res: Response,
  ujianId: number,
  boleh: readonly StatusUjian[],
): UjianMilik {
  const ujian = ujianMilik(k, res, ujianId);
  wajibStatus(ujian, boleh);
  return ujian;
}

export function pesertaMilikUjian(k: Konteks, ujianId: number, pesertaId: number): void {
  const ada = k.db.prepare('SELECT 1 FROM peserta WHERE id = ? AND ujian_id = ?').get(pesertaId, ujianId);
  if (!ada) throw new GalatHttp(404, 'tidak_ditemukan');
}

export function catatAksiGuru(
  k: Konteks,
  res: Response,
  ujianId: number,
  aksi: string,
  detail: Record<string, unknown> = {},
): void {
  k.db
    .prepare(
      "INSERT INTO log_aksi (ujian_id, aktor, penguji_id, aksi, detail_json, dibuat_at) VALUES (?, 'penguji', ?, ?, ?, ?)",
    )
    .run(ujianId, sesiDari(res).pengujiId, aksi, JSON.stringify(detail), k.jam());
}

// Menandai ujian berubah (daftar ujian diurutkan dari yang terakhir diubah).
export function sentuhUjian(k: Konteks, ujianId: number): void {
  k.db.prepare('UPDATE ujian SET diubah_at = ? WHERE id = ?').run(k.jam(), ujianId);
}
