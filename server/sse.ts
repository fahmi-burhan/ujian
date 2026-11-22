// server/sse.ts — pusat koneksi Server-Sent Events (SSE): mendaftar koneksi, mengirim event, detak
// komentar tiap 15 dtk, dan menutup koneksi.
// Dipanggil oleh: server/app.ts (membuat hub), server/siaran.ts (mengirim event), server/pengecek.ts
//                 (koneksi siswa yang putus > 10 dtk), server/routes/peserta-ujian.ts, server/routes/pantau.ts,
//                 server/routes/proyektor.ts (membuka aliran), rute login/reset PIN/cabut proyektor (menutup).
// Memanggil: objek Response Express saja (tanpa dependensi).
// Alasan satu modul: semua kode real-time terkumpul di sini, jadi bisa diganti (mis. ke WebSocket) tanpa
// menyentuh rute lain (CLAUDE.md, keputusan real-time).
// Tiga jenis aliran: siswa (per tab), dasbor guru, dan layar proyektor (keduanya per ujian).
// Catatan teknis:
// - Header `X-Accel-Buffering: no` wajib: nginx aaPanel mem-buffer respons secara bawaan, sehingga event
//   tertahan dan baru tiba bertumpuk.
// - Komentar ": detak" tiap 15 dtk menjaga koneksi agar tidak diputus `proxy_read_timeout` nginx (bawaan
//   60 dtk) dan membantu browser tahu koneksinya masih hidup.
// - State koneksi hanya ada di memori proses ini. Karena itu pm2 wajib `instances: 1` (docs/PLAN.md).
import type { Request, Response } from 'express';

export type KoneksiPeserta = {
  res: Response;
  pesertaId: number;
  ujianId: number;
  sesiHash: string;
  tabId: string;
  // true = ditutup server (tab lain aktif, sesi dicabut), bukan putus jaringan: tidak dicatat sebagai putus.
  ditutupServer?: boolean;
};

export type AliranPantau = {
  res: Response;
  jenis: 'guru' | 'proyektor';
  ujianId: number;
  sesiHash: string;
};

// Siswa yang aliran terakhirnya putus. eventId terisi setelah pengecek mencatat event `koneksi_putus`
// (putus > 10 dtk saat mengerjakan, docs/DESAIN.md §6).
export type PutusPeserta = { pesertaId: number; ujianId: number; sejak: number; eventId: number | null };
// Siswa yang tersambung lagi setelah event koneksi_putus-nya dicatat: event itu ditutup pengecek.
export type KembaliPeserta = { eventId: number; pada: number };

export type HubSse = {
  // Membuka respons SSE (header + jeda sambung ulang). Dipanggil sebelum event pertama.
  bukaAliran: (req: Request, res: Response) => void;
  kirim: (res: Response, event: string, data: unknown) => void;
  daftarPeserta: (req: Request, koneksi: KoneksiPeserta) => void;
  koneksiPeserta: (saring: (k: KoneksiPeserta) => boolean) => KoneksiPeserta[];
  // Mengirim event terakhir lalu menutup koneksi yang cocok. Klien tidak menyambung ulang untuk
  // event penutup (tab_lain_aktif, sesi_dicabut).
  tutupPeserta: (saring: (k: KoneksiPeserta) => boolean, event: string, data: unknown) => number;
  jumlahKoneksi: () => number;
  daftarPantau: (req: Request, aliran: AliranPantau) => void;
  aliranPantau: (saring: (a: AliranPantau) => boolean) => AliranPantau[];
  tutupPantau: (saring: (a: AliranPantau) => boolean, event: string, data: unknown) => number;
  // Siswa yang sedang terputus (diperbarui pengecek) dan yang baru tersambung lagi (dikosongkan saat dibaca).
  putus: Map<number, PutusPeserta>;
  ambilKembali: () => KembaliPeserta[];
  // Menjalankan fn sekali setelah `ms`, menggabungkan permintaan dengan kunci sama yang datang di antaranya
  // (mis. 30 siswa menyimpan jawaban dalam sedetik → dasbor guru dikirimi satu potret saja).
  tunda: (kunci: string, ms: number, fn: () => void) => void;
  tutupSemua: () => void;
};

export const JEDA_DETAK_SSE_MS = 15_000;

export function buatHubSse(jam: () => number = Date.now): HubSse {
  const peserta = new Set<KoneksiPeserta>();
  const pantau = new Set<AliranPantau>();
  const putus = new Map<number, PutusPeserta>();
  let kembali: KembaliPeserta[] = [];
  const tertunda = new Map<string, ReturnType<typeof setTimeout>>();

  function tulis(res: Response, teks: string): void {
    // Koneksi yang sudah putus diabaikan; pembersihan terjadi lewat event 'close'.
    if (res.writableEnded || res.destroyed) return;
    res.write(teks);
  }

  function kirim(res: Response, event: string, data: unknown): void {
    tulis(res, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  const detak = setInterval(() => {
    for (const k of peserta) tulis(k.res, ': detak\n\n');
  }, JEDA_DETAK_SSE_MS);
  // Tidak menahan proses tetap hidup (mis. saat tes selesai).
  detak.unref();

  return {
    bukaAliran(req, res) {
      res.status(200).set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      // Socket tanpa batas waktu: koneksi SSE memang dibiarkan terbuka lama.
      req.socket.setTimeout(0);
      req.socket.setNoDelay(true);
      // Browser menyambung ulang 3 dtk setelah koneksi putus (bawaan browser ±3 dtk juga, tapi ditegaskan).
      tulis(res, 'retry: 3000\n\n');
    },
    kirim,
    daftarPeserta(req, koneksi) {
      peserta.add(koneksi);
      const lama = putus.get(koneksi.pesertaId);
      if (lama) {
        putus.delete(koneksi.pesertaId);
        if (lama.eventId !== null) kembali.push({ eventId: lama.eventId, pada: jam() });
      }
      req.on('close', () => {
        peserta.delete(koneksi);
        if (koneksi.ditutupServer) return;
        const masihAda = [...peserta].some((k) => k.pesertaId === koneksi.pesertaId);
        if (!masihAda && !putus.has(koneksi.pesertaId)) {
          putus.set(koneksi.pesertaId, { pesertaId: koneksi.pesertaId, ujianId: koneksi.ujianId, sejak: jam(), eventId: null });
        }
      });
    },
    koneksiPeserta(saring) {
      return [...peserta].filter(saring);
    },
    tutupPeserta(saring, event, data) {
      let jumlah = 0;
      for (const k of [...peserta]) {
        if (!saring(k)) continue;
        k.ditutupServer = true;
        kirim(k.res, event, data);
        k.res.end();
        peserta.delete(k);
        jumlah += 1;
      }
      return jumlah;
    },
    jumlahKoneksi() {
      return peserta.size + pantau.size;
    },
    daftarPantau(req, aliran) {
      pantau.add(aliran);
      req.on('close', () => pantau.delete(aliran));
    },
    aliranPantau(saring) {
      return [...pantau].filter(saring);
    },
    tutupPantau(saring, event, data) {
      let jumlah = 0;
      for (const a of [...pantau]) {
        if (!saring(a)) continue;
        kirim(a.res, event, data);
        a.res.end();
        pantau.delete(a);
        jumlah += 1;
      }
      return jumlah;
    },
    putus,
    ambilKembali() {
      const hasil = kembali;
      kembali = [];
      return hasil;
    },
    tunda(kunci, ms, fn) {
      if (tertunda.has(kunci)) return;
      const timer = setTimeout(() => {
        tertunda.delete(kunci);
        fn();
      }, ms);
      timer.unref();
      tertunda.set(kunci, timer);
    },
    tutupSemua() {
      clearInterval(detak);
      for (const t of tertunda.values()) clearTimeout(t);
      tertunda.clear();
      for (const k of peserta) {
        k.ditutupServer = true;
        k.res.end();
      }
      peserta.clear();
      for (const a of pantau) a.res.end();
      pantau.clear();
    },
  };
}
