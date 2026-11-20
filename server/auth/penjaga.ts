// server/auth/penjaga.ts — middleware penjaga: wajib login per lingkup, dan cek asal permintaan (CSRF).
// Dipanggil oleh: server/app.ts (cekAsal) dan server/routes/* (wajibSesi).
// Memanggil: server/auth/sesi.ts, server/http.ts.
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Db } from '../db/connection.ts';
import { GalatHttp } from '../http.ts';
import { bacaCookie, cariSesi, NAMA_COOKIE } from './sesi.ts';
import type { Lingkup, SesiAktif } from './sesi.ts';

export type Jam = () => number;

// Middleware: lanjut hanya bila ada sesi aktif untuk lingkup ini. Sesi disimpan di res.locals.sesi.
export function wajibSesi(db: Db, jam: Jam, lingkup: Lingkup): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = bacaCookie(req, NAMA_COOKIE[lingkup]);
    const sesi = token ? cariSesi(db, jam(), lingkup, token) : null;
    if (!sesi) throw new GalatHttp(401, 'belum_masuk');
    res.locals.sesi = sesi;
    next();
  };
}

// Mengambil sesi yang sudah dipasang wajibSesi. Dipanggil hanya di rute yang memakai wajibSesi.
export function sesiDari(res: Response): SesiAktif {
  const sesi = res.locals.sesi as SesiAktif | undefined;
  if (!sesi) throw new Error('sesiDari dipanggil di rute tanpa wajibSesi');
  return sesi;
}

// Perlindungan CSRF (docs/DESAIN.md §8): setiap permintaan yang mengubah data (selain GET/HEAD/OPTIONS)
// wajib membawa header Origin yang sama dengan alamat aplikasi. Browser selalu mengirim Origin untuk
// POST/PUT/PATCH/DELETE, dan situs lain tidak bisa memalsukannya, sehingga form jahat di situs lain
// yang menumpang cookie siswa/guru akan ditolak.
// Di VPS dibandingkan dengan ORIGIN_PUBLIK dari .env (tidak bergantung pada header dari nginx).
// Di laptop (ORIGIN_PUBLIK kosong) dibandingkan dengan protokol + host permintaan.
export function buatCekAsal(originPublik: string | null): RequestHandler {
  return (req, _res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }
    const harapan = originPublik ?? `${req.protocol}://${req.host}`;
    const asal = req.get('origin');
    if (!asal || asal !== harapan) throw new GalatHttp(403, 'asal_tidak_sah');
    next();
  };
}
