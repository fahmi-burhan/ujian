// server/routes/penguji-auth.ts — login, logout, dan profil guru.
// Dipanggil oleh: server/app.ts (dipasang di bawah /api).
// Memanggil: server/auth/*, shared/auth.ts.
// Endpoint (docs/DESAIN.md §8): POST /penguji/masuk, POST /penguji/keluar, GET /penguji/saya.
// Percobaan login untuk username yang sama diproses BERURUTAN (antrean per username), termasuk jeda
// 1 dtk bila gagal. Jadi tebakan password paling cepat ±1 per detik per username, walau dikirim paralel.
// Browser yang pernah berhasil login ("perangkat dikenal", server/auth/perangkat-dikenal.ts) melewati
// antrean itu, supaya banjir tebakan dari siswa tidak membuat guru gagal masuk.
import { Router } from 'express';
import { PengujiMasukSchema } from '../../shared/auth.ts';
import type { PengujiSaya } from '../../shared/auth.ts';
import { buatAntreanPerKunci } from '../auth/antrean.ts';
import { cocokkanRahasia, HASH_PALSU } from '../auth/kata-sandi.ts';
import type { JalurScrypt } from '../auth/kata-sandi.ts';
import {
  cariPerangkatDikenal,
  catatGagalPerangkat,
  hapusCookiePerangkat,
  ingatPerangkat,
  NAMA_COOKIE_PERANGKAT,
  pasangCookiePerangkat,
} from '../auth/perangkat-dikenal.ts';
import { ringkasPerangkat } from '../auth/perangkat.ts';
import { sesiDari, wajibSesi } from '../auth/penjaga.ts';
import { bacaCookie, buatSesi, cabutSesi, hapusCookieSesi, pasangCookieSesi } from '../auth/sesi.ts';
import { GalatHttp, tunda, validasi } from '../http.ts';
import type { Konteks } from '../konteks.ts';

type BarisPenguji = { id: number; username: string; nama: string; password_hash: string };

// Paling banyak 10 percobaan menunggu per username; selebihnya langsung 503 server_sibuk.
const ANTRE_LOGIN_PER_USERNAME = 10;

export function pengujiAuthRouter(k: Konteks): Router {
  const router = Router();
  const wajibGuru = wajibSesi(k.db, k.jam, 'penguji');
  const cariPenguji = k.db.prepare('SELECT id, username, nama, password_hash FROM penguji WHERE username = ?');
  const antreanLogin = buatAntreanPerKunci(ANTRE_LOGIN_PER_USERNAME);

  // Perangkat dikenal yang sedang memproses login. Satu perangkat hanya boleh memproses satu login
  // pada satu waktu; permintaan paralel lain dengan cookie yang sama dialihkan ke antrean biasa.
  // Tanpa ini, satu cookie (mis. tertinggal di PC kelas) bisa dipakai untuk ratusan tebakan serentak.
  const perangkatSibuk = new Set<number>();

  // Cek password. Hash tetap dihitung walau username tidak ada, agar lama respons tidak membocorkan
  // username. Gagal → `saatGagal` dijalankan lebih dulu, lalu jeda tetap (tanpa penguncian akun, karena
  // siswa bisa memakainya untuk mengunci guru).
  async function periksaPassword(
    username: string,
    password: string,
    jalur: JalurScrypt,
    saatGagal: () => void = () => {},
  ): Promise<BarisPenguji> {
    const baris = cariPenguji.get(username) as BarisPenguji | undefined;
    const cocok = await cocokkanRahasia(password, baris?.password_hash ?? HASH_PALSU, jalur);
    if (!baris || !cocok) {
      saatGagal();
      await tunda(k.opsi.jedaGagalLoginMs);
      throw new GalatHttp(401, 'login_salah');
    }
    return baris;
  }

  router.post('/penguji/masuk', async (req, res) => {
    const input = validasi(PengujiMasukSchema, req.body);
    const sekarang = k.jam();
    const infoPerangkat = ringkasPerangkat(req.get('user-agent'));
    const tokenPerangkat = bacaCookie(req, NAMA_COOKIE_PERANGKAT);
    const dikenal = tokenPerangkat ? cariPerangkatDikenal(k.db, sekarang, tokenPerangkat) : null;

    let penguji: BarisPenguji;
    if (
      dikenal &&
      dikenal.username.toLowerCase() === input.username.toLowerCase() &&
      !perangkatSibuk.has(dikenal.id)
    ) {
      // Jalur perangkat dikenal: tanpa antrean per username, memakai jatah scrypt 'umum' (bukan 'guru')
      // supaya banjir tebakan di jalur guru tidak ikut menghalangi. Satu per satu per perangkat, dan
      // setiap gagal dijeda 1 dtk, jadi jalur ini juga paling cepat ±1 tebakan per detik.
      perangkatSibuk.add(dikenal.id);
      try {
        penguji = await periksaPassword(input.username, input.password, 'umum', () => {
          // Salah ketik ditoleransi beberapa kali; setelah batasnya perangkat dilupakan (dicatat SEBELUM
          // jeda) dan percobaan berikutnya lewat antrean biasa.
          if (catatGagalPerangkat(k.db, dikenal.id)) hapusCookiePerangkat(req, res, k.originPublik);
        });
      } finally {
        perangkatSibuk.delete(dikenal.id);
      }
    } else {
      // Jalur biasa: diproses berurutan per username, dan jeda gagal dijalani DI DALAM antrean
      // sehingga percobaan berikutnya ikut menunggu. Kunci dikecilkan hurufnya karena kolom username
      // di DB tidak membedakan huruf besar/kecil.
      penguji = await antreanLogin.jalankan(input.username.toLowerCase(), () =>
        periksaPassword(input.username, input.password, 'guru'),
      );
    }

    const tokenBaru = ingatPerangkat(k.db, sekarang, penguji.id, tokenPerangkat, infoPerangkat);
    pasangCookiePerangkat(req, res, tokenBaru, k.originPublik);
    const token = buatSesi(k.db, sekarang, { lingkup: 'penguji', pengujiId: penguji.id, infoPerangkat });
    pasangCookieSesi(req, res, 'penguji', token, k.originPublik);
    res.status(204).end();
  });

  router.post('/penguji/keluar', wajibGuru, (req, res) => {
    cabutSesi(k.db, k.jam(), sesiDari(res).idHash, 'keluar');
    hapusCookieSesi(req, res, 'penguji', k.originPublik);
    res.status(204).end();
  });

  router.get('/penguji/saya', wajibGuru, (_req, res) => {
    const penguji = k.db
      .prepare('SELECT id, username, nama FROM penguji WHERE id = ?')
      .get(sesiDari(res).pengujiId) as PengujiSaya | undefined;
    if (!penguji) throw new GalatHttp(401, 'belum_masuk');
    const body: PengujiSaya = { id: penguji.id, username: penguji.username, nama: penguji.nama };
    res.json(body);
  });

  return router;
}
