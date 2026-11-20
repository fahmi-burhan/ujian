// server/routes/peserta-guru.ts — daftar peserta milik ujian: lihat, tambah satu, impor CSV, ubah, hapus.
// Dipanggil oleh: server/app.ts (dipasang di bawah /api; sesi guru dicek di app.ts untuk /api/ujian).
// Memanggil: shared/ujian.ts, shared/csv.ts, server/acak.ts, server/routes/milik.ts, database.
// Fase (docs/DESAIN.md §8): tambah & impor boleh sampai ujian berlangsung/dijeda (siswa yang terlupa
// bisa ditambahkan), sedangkan ubah & hapus hanya saat draf (setelah dibuka, siswa mungkin sudah masuk
// dengan nama itu). Reset PIN & buka kunci ada di server/routes/ujian-admin.ts.
import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { pesertaDariCsv } from '../../shared/csv.ts';
import { BATAS, ImporPesertaSchema, PesertaInputSchema, PesertaUbahSchema } from '../../shared/ujian.ts';
import type { ImporHasil, PesertaGuru } from '../../shared/ujian.ts';
import { GalatHttp, validasi } from '../http.ts';
import type { Konteks } from '../konteks.ts';
import { catatAksiGuru, ParamPeserta, ParamUjian, pesertaMilikUjian, sentuhUjian, ujianMilik, ujianMilikDiStatus } from './milik.ts';

const BOLEH_TAMBAH = ['draf', 'menunggu', 'berlangsung', 'dijeda'] as const;

type BarisPesertaGuru = Omit<PesertaGuru, 'punya_pin' | 'terkunci'> & { punya_pin: number; terkunci: number };

const KOLOM = `id, nama, nomor, status, pin_hash IS NOT NULL AS punya_pin, terkunci_at IS NOT NULL AS terkunci,
  masuk_pertama_at`;

// Daftar putih: hash PIN & id_anonim tidak pernah keluar, bahkan ke guru.
function keGuru(b: BarisPesertaGuru): PesertaGuru {
  return {
    id: b.id,
    nama: b.nama,
    nomor: b.nomor,
    status: b.status,
    punya_pin: b.punya_pin === 1,
    terkunci: b.terkunci === 1,
    masuk_pertama_at: b.masuk_pertama_at,
  };
}

// Pengganti nama saat jawaban dikirim ke AI (Fase 6). Acak, tidak bisa ditebak dari nama/urutan.
function idAnonim(): string {
  return `anon_${randomBytes(9).toString('base64url')}`;
}

export function pesertaGuruRouter(k: Konteks): Router {
  const router = Router();

  // ON CONFLICT: nama + nomor yang sama (tanpa membedakan huruf besar/kecil) sudah ada → dilewati.
  const sisip = k.db.prepare(
    `INSERT INTO peserta (ujian_id, nama, nomor, id_anonim, dibuat_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (ujian_id, nama, nomor) DO NOTHING RETURNING ${KOLOM}`,
  );

  function satuPeserta(ujianId: number, pesertaId: number): PesertaGuru {
    const b = k.db
      .prepare(`SELECT ${KOLOM} FROM peserta WHERE id = ? AND ujian_id = ?`)
      .get(pesertaId, ujianId) as BarisPesertaGuru | undefined;
    if (!b) throw new GalatHttp(404, 'tidak_ditemukan');
    return keGuru(b);
  }

  router.get('/ujian/:id/peserta', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilik(k, res, id);
    const baris = k.db
      .prepare(`SELECT ${KOLOM} FROM peserta WHERE ujian_id = ? ORDER BY nama COLLATE NOCASE, nomor, id`)
      .all(id) as BarisPesertaGuru[];
    res.json(baris.map(keGuru));
  });

  router.post('/ujian/:id/peserta', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilikDiStatus(k, res, id, BOLEH_TAMBAH);
    const input = validasi(PesertaInputSchema, req.body);
    const baru = k.db.transaction(() => {
      const b = sisip.get(id, input.nama, input.nomor, idAnonim(), k.jam()) as BarisPesertaGuru | undefined;
      if (!b) throw new GalatHttp(409, 'nama_sudah_ada');
      catatAksiGuru(k, res, id, 'tambah_peserta', { peserta_id: b.id });
      sentuhUjian(k, id);
      return keGuru(b);
    })();
    res.status(201).json(baru);
  });

  // Impor CSV (kolom nama[, nomor]). Baris kosong/terlalu panjang dan nama yang sudah ada dilewati
  // dan dilaporkan per nomor baris, bukan menggagalkan seluruh impor.
  router.post('/ujian/:id/peserta/impor', (req, res) => {
    const { id } = validasi(ParamUjian, req.params);
    ujianMilikDiStatus(k, res, id, BOLEH_TAMBAH);
    const { csv } = validasi(ImporPesertaSchema, req.body);
    const calon = pesertaDariCsv(csv);
    if (calon.length === 0) throw new GalatHttp(400, 'csv_kosong');
    if (calon.length > BATAS.barisImpor) throw new GalatHttp(400, 'csv_terlalu_banyak');
    const hasil: ImporHasil = { ditambah: [], dilewati: [] };
    k.db.transaction(() => {
      const sekarang = k.jam();
      for (const c of calon) {
        const cek = PesertaInputSchema.safeParse({ nama: c.nama, nomor: c.nomor });
        if (!cek.success) {
          hasil.dilewati.push({ baris: c.baris, nama: c.nama.slice(0, BATAS.nama), alasan: 'tidak_valid' });
          continue;
        }
        const b = sisip.get(id, cek.data.nama, cek.data.nomor, idAnonim(), sekarang) as BarisPesertaGuru | undefined;
        if (b) hasil.ditambah.push(keGuru(b));
        else hasil.dilewati.push({ baris: c.baris, nama: cek.data.nama, alasan: 'duplikat' });
      }
      catatAksiGuru(k, res, id, 'impor_peserta', { ditambah: hasil.ditambah.length, dilewati: hasil.dilewati.length });
      sentuhUjian(k, id);
    })();
    res.json(hasil);
  });

  router.patch('/ujian/:id/peserta/:pid', (req, res) => {
    const { id, pid } = validasi(ParamPeserta, req.params);
    ujianMilikDiStatus(k, res, id, ['draf']);
    const lama = satuPeserta(id, pid);
    const input = validasi(PesertaUbahSchema, req.body);
    k.db.transaction(() => {
      const ubah = k.db
        .prepare(
          `UPDATE peserta SET nama = ?, nomor = ? WHERE id = ? AND ujian_id = ?
           AND NOT EXISTS (SELECT 1 FROM peserta WHERE ujian_id = ? AND id <> ? AND nama = ? AND nomor = ?)`,
        )
        .run(input.nama ?? lama.nama, input.nomor ?? lama.nomor, pid, id, id, pid, input.nama ?? lama.nama, input.nomor ?? lama.nomor);
      if (ubah.changes === 0) throw new GalatHttp(409, 'nama_sudah_ada');
      sentuhUjian(k, id);
    })();
    res.json(satuPeserta(id, pid));
  });

  router.delete('/ujian/:id/peserta/:pid', (req, res) => {
    const { id, pid } = validasi(ParamPeserta, req.params);
    ujianMilikDiStatus(k, res, id, ['draf']);
    pesertaMilikUjian(k, id, pid);
    k.db.transaction(() => {
      // Sesi & data lain milik peserta ikut terhapus (FK ON DELETE CASCADE).
      k.db.prepare('DELETE FROM peserta WHERE id = ? AND ujian_id = ?').run(pid, id);
      catatAksiGuru(k, res, id, 'hapus_peserta', { peserta_id: pid });
      sentuhUjian(k, id);
    })();
    res.status(204).end();
  });

  return router;
}
