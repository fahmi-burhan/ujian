// server/sse.ts — pusat koneksi Server-Sent Events (SSE): mendaftar koneksi, mengirim event, detak
// komentar tiap 15 dtk, dan menutup koneksi.
// Dipanggil oleh: server/app.ts (membuat hub), server/siaran.ts (mengirim event ke peserta),
//                 server/routes/peserta-ujian.ts (membuka aliran), rute login/reset PIN (menutup aliran).
// Memanggil: objek Response Express saja (tanpa dependensi).
// Alasan satu modul: semua kode real-time terkumpul di sini, jadi bisa diganti (mis. ke WebSocket) tanpa
// menyentuh rute lain (CLAUDE.md, keputusan real-time). Fase 5 menambah aliran guru & proyektor di sini.
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
};

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
  tutupSemua: () => void;
};

export const JEDA_DETAK_SSE_MS = 15_000;

export function buatHubSse(): HubSse {
  const peserta = new Set<KoneksiPeserta>();

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
      req.on('close', () => peserta.delete(koneksi));
    },
    koneksiPeserta(saring) {
      return [...peserta].filter(saring);
    },
    tutupPeserta(saring, event, data) {
      let jumlah = 0;
      for (const k of [...peserta]) {
        if (!saring(k)) continue;
        kirim(k.res, event, data);
        k.res.end();
        peserta.delete(k);
        jumlah += 1;
      }
      return jumlah;
    },
    jumlahKoneksi() {
      return peserta.size;
    },
    tutupSemua() {
      clearInterval(detak);
      for (const k of peserta) k.res.end();
      peserta.clear();
    },
  };
}
