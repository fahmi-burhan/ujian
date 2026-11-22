// server/routes/peserta-nilai.ts — nilai untuk siswa setelah dirilis (GET /api/peserta/nilai).
// Dipanggil oleh: server/app.ts (dipasang di bawah /api, setelah peserta-ujian.ts yang memasang wajibSesi).
// Memanggil: server/routes/peserta-ujian.ts (pesertaDariSesi), server/routes/ujian.ts (muatSoalGuru),
//            server/routes/penilaian.ts (bacaNilai), shared/nilai.ts, database.
// Aturan keras #1 (diubah atas keputusan pemilik 22 Nov): rubrik (kriteria, deskriptor level yang dicapai) dan
// jawaban acuan BOLEH dikirim ke siswa HANYA saat ujian berstatus 'dirilis', hanya untuk ujiannya sendiri.
// Status lain → 409. Setelah "tarik rilis" status kembali 'penilaian', jadi endpoint ini tertutup lagi.
// Payload dirakit field demi field (daftar putih NilaiPesertaSchema); rubrik_json mentah tidak pernah dikirim.
import { Router } from 'express';
import { nilaiSoal, nilaiUjian, persenSoal, skorMaks } from '../../shared/nilai.ts';
import type { NilaiPeserta } from '../../shared/nilai.ts';
import { GalatHttp } from '../http.ts';
import type { Konteks } from '../konteks.ts';
import { bacaNilai } from './penilaian.ts';
import { pesertaDariSesi } from './peserta-ujian.ts';
import { muatSoalGuru } from './ujian.ts';

export function pesertaNilaiRouter(k: Konteks): Router {
  const router = Router();

  router.get('/peserta/nilai', (_req, res) => {
    const { peserta, ujian } = pesertaDariSesi(k, res);
    if (ujian.status !== 'dirilis') throw new GalatHttp(409, 'status_tidak_sesuai');
    // Laptop sekolah dipakai bergantian: jawaban, nilai, dan acuan tidak boleh tertinggal di cache browser.
    res.set('Cache-Control', 'private, no-store');
    const judul = k.db.prepare('SELECT judul FROM ujian WHERE id = ?').pluck().get(ujian.id) as string;
    const hadir = peserta.status === 'dikumpulkan';
    if (!hadir) {
      const body: NilaiPeserta = { judul, status: peserta.status, hadir: false, nilai_akhir: null, soal: [] };
      res.json(body);
      return;
    }
    const soal = muatSoalGuru(k, ujian.id);
    const nilai = new Map(bacaNilai(k, ujian.id).filter((n) => n.peserta_id === peserta.id).map((n) => [n.soal_id, n]));
    const jawaban = new Map(
      (k.db.prepare('SELECT soal_id, isi FROM jawaban WHERE peserta_id = ?').all(peserta.id) as { soal_id: number; isi: string }[]).map(
        (j) => [j.soal_id, j.isi],
      ),
    );
    const totalBobot = soal.reduce((n, s) => n + s.bobot, 0);
    const perSoal = soal.map((s) => {
      const n = nilai.get(s.id);
      // Rilis mensyaratkan semua jawaban disetujui dengan skor sah. Bila tetap tidak sah (data rusak), galat:
      // nilai tebakan (mis. 0) tidak pernah ditampilkan ke siswa.
      const skor = n?.status === 'disetujui' ? n.skor : {};
      const nilaiS = nilaiSoal(s.rubrik, skor);
      if (nilaiS === null) throw new Error(`Nilai peserta ${peserta.id} soal ${s.id} tidak sah setelah rilis`);
      return {
        urutan: s.urutan,
        judul: s.judul,
        teks: s.teks,
        bobot: s.bobot,
        porsi_persen: totalBobot > 0 ? Math.round((s.bobot / totalBobot) * 1000) / 10 : 0,
        nilai_persen: persenSoal(nilaiS),
        jawaban: jawaban.get(s.id) ?? '',
        acuan: s.jawaban_acuan,
        catatan: n?.status === 'disetujui' ? n.catatan : '',
        kriteria: s.rubrik.kriteria.map((kr) => {
          const sk = skor[kr.id] ?? 0;
          return {
            nama: kr.nama,
            bobot: kr.bobot,
            skor: sk,
            skor_maks: skorMaks(kr),
            deskriptor: kr.level.find((l) => l.skor === sk)?.deskriptor ?? '',
          };
        }),
        _nilai: nilaiS,
      };
    });
    const body: NilaiPeserta = {
      judul,
      status: peserta.status,
      hadir: true,
      nilai_akhir: nilaiUjian(perSoal.map((s) => ({ nilai: s._nilai, bobot: s.bobot }))),
      soal: perSoal.map(({ _nilai, ...s }) => s),
    };
    res.json(body);
  });

  return router;
}
