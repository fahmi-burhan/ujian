// tests/bantuan.ts — alat bantu tes HTTP: aplikasi dengan DB di RAM, jam palsu, dan "klien" ber-cookie.
// Dipanggil oleh: tests/*.test.ts. Memanggil: server/app.ts, server/db/*, server/auth/*.
// Bukan berkas tes (tidak berakhiran .test.ts), jadi tidak dijalankan sendiri oleh `npm test`.
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.ts';
import { loadConfig } from '../server/config.ts';
import { openDatabase } from '../server/db/connection.ts';
import type { Db } from '../server/db/connection.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { hashRahasia } from '../server/auth/kata-sandi.ts';
import type { OpsiKeamanan } from '../server/konteks.ts';
import { MIGRATIONS_DIR } from '../server/paths.ts';

export const T0 = 1_795_000_000_000;

export type AplikasiUji = {
  db: Db;
  // Folder unggahan sementara khusus tes ini (dihapus saat berhenti).
  uploadDir: string;
  baseUrl: string;
  // Jam palsu yang bisa dimajukan: aplikasi.majukan(10 * 60_000).
  majukan: (ms: number) => void;
  // Satu putaran pengecek ujian (detak, jeda otomatis, kumpul otomatis), seperti yang dijalankan start.ts.
  pengecek: () => void;
  // Memajukan jam sambil menjalankan pengecek tiap 1 dtk, seperti server yang hidup normal (tanpa ini,
  // pengecek menganggap server "mati" selama jam dimajukan dan menjeda ujian otomatis).
  majukanBerdetak: (ms: number) => void;
  klien: () => Klien;
  berhenti: () => void;
};

export type Respons = { status: number; body: unknown; header: Headers };

// Klien sederhana yang meniru browser: menyimpan cookie dari Set-Cookie dan mengirim Origin.
export class Klien {
  baseUrl: string;
  cookie: Map<string, string>;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.cookie = new Map();
  }

  async minta(
    method: string,
    path: string,
    opsi: {
      body?: unknown;
      // Body mentah (mis. isi PDF) beserta Content-Type-nya; menggantikan body JSON.
      mentah?: { isi: Uint8Array; tipe: string };
      origin?: string | null;
      headers?: Record<string, string>;
    } = {},
  ): Promise<Respons> {
    const headers: Record<string, string> = { ...opsi.headers };
    if (opsi.origin !== null) headers.origin = opsi.origin ?? this.baseUrl;
    if (opsi.body !== undefined) headers['content-type'] = 'application/json';
    if (opsi.mentah) headers['content-type'] = opsi.mentah.tipe;
    const cookie = this.headerCookie(path);
    if (cookie) headers.cookie = cookie;
    const respons = await fetch(this.baseUrl + path, {
      method,
      headers,
      body: opsi.mentah ? opsi.mentah.isi : opsi.body === undefined ? undefined : JSON.stringify(opsi.body),
    });
    for (const baris of respons.headers.getSetCookie()) {
      const [pasangan] = baris.split(';');
      const [nama, ...sisa] = (pasangan ?? '').split('=');
      const nilai = sisa.join('=');
      if (!nama) continue;
      if (nilai === '' || /Expires=Thu, 01 Jan 1970/i.test(baris)) this.cookie.delete(nama);
      else this.cookie.set(nama, nilai);
    }
    const teks = await respons.text();
    let body: unknown = null;
    if (teks.length > 0) {
      try {
        body = JSON.parse(teks);
      } catch {
        body = teks;
      }
    }
    return { status: respons.status, body, header: respons.headers };
  }

  // Meniru atribut Path di browser: cookie proyektor hanya ke /api/proyektor, cookie perangkat guru
  // hanya ke /api/penguji/masuk.
  headerCookie(path: string): string | null {
    const cocok = [...this.cookie].filter(([nama]) => {
      if (nama === 'sesi_proyektor') return path.startsWith('/api/proyektor');
      if (nama === 'perangkat_guru') return path === '/api/penguji/masuk';
      return true;
    });
    return cocok.length > 0 ? cocok.map(([n, v]) => `${n}=${v}`).join('; ') : null;
  }

  // Membuka aliran SSE seperti EventSource (tanpa sambung ulang) dan mengumpulkan event-nya.
  async aliran(path: string): Promise<AliranUji> {
    const kendali = new AbortController();
    const cookie = this.headerCookie(path);
    const respons = await fetch(this.baseUrl + path, {
      headers: cookie ? { cookie, accept: 'text/event-stream' } : { accept: 'text/event-stream' },
      signal: kendali.signal,
    });
    const event: EventSse[] = [];
    const penunggu: (() => void)[] = [];
    let berakhir = false;
    const bangunkan = (): void => {
      for (const f of penunggu.splice(0)) f();
    };
    const selesai = (async () => {
      if (!respons.body) return;
      const pembaca = respons.body.pipeThrough(new TextDecoderStream()).getReader();
      let sisa = '';
      try {
        for (;;) {
          const { value, done } = await pembaca.read();
          if (done) break;
          sisa += value;
          let batas = sisa.indexOf('\n\n');
          while (batas !== -1) {
            const blok = sisa.slice(0, batas);
            sisa = sisa.slice(batas + 2);
            const nama = /^event: (.*)$/m.exec(blok)?.[1];
            const data = /^data: (.*)$/m.exec(blok)?.[1];
            if (nama && data !== undefined) event.push({ event: nama, data: JSON.parse(data) as unknown });
            batas = sisa.indexOf('\n\n');
          }
          bangunkan();
        }
      } catch {
        // Dibatalkan oleh tutup().
      } finally {
        berakhir = true;
        bangunkan();
      }
    })();
    return {
      status: respons.status,
      header: respons.headers,
      event,
      async tunggu(nama, jumlah = 1, batasMs = 2000) {
        const mulai = Date.now();
        for (;;) {
          const cocok = event.filter((e) => e.event === nama);
          if (cocok.length >= jumlah) return cocok[jumlah - 1]?.data;
          if (berakhir) throw new Error(`Aliran berakhir sebelum event "${nama}" ke-${jumlah}`);
          const sisaMs = batasMs - (Date.now() - mulai);
          if (sisaMs <= 0) throw new Error(`Event "${nama}" ke-${jumlah} tidak datang dalam ${batasMs} ms`);
          await new Promise<void>((resolve) => {
            const pewaktu = setTimeout(resolve, sisaMs);
            penunggu.push(() => {
              clearTimeout(pewaktu);
              resolve();
            });
          });
        }
      },
      async berakhir(batasMs = 2000) {
        await Promise.race([
          selesai,
          new Promise((_, tolak) => setTimeout(() => tolak(new Error('Aliran tidak ditutup server')), batasMs)),
        ]);
      },
      tutup() {
        kendali.abort();
      },
    };
  }
}

export type EventSse = { event: string; data: unknown };
export type AliranUji = {
  status: number;
  header: Headers;
  event: EventSse[];
  // Menunggu event bernama `nama` yang ke-`jumlah` lalu mengembalikan datanya.
  tunggu: (nama: string, jumlah?: number, batasMs?: number) => Promise<unknown>;
  // Selesai bila server menutup aliran.
  berakhir: (batasMs?: number) => Promise<void>;
  tutup: () => void;
};

// `env` meniru isi .env (mis. { ORIGIN_PUBLIK: 'https://ujian.contoh.id' }).
export async function mulaiAplikasiUji(
  opsi: Partial<OpsiKeamanan> = {},
  env: Record<string, string> = {},
): Promise<AplikasiUji> {
  const db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  const uploadDir = mkdtempSync(join(tmpdir(), 'ujian-tes-'));
  let sekarang = T0;
  const { app, close, pengecek } = await createApp({
    config: loadConfig({ UPLOAD_DIR: uploadDir, ...env }, { mode: 'test' }),
    db,
    jam: () => sekarang,
    opsi: { jedaGagalLoginMs: 0, jedaKodeSalahMs: 0, ...opsi },
  });
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    db,
    uploadDir,
    baseUrl,
    majukan: (ms) => {
      sekarang += ms;
    },
    pengecek,
    majukanBerdetak: (ms) => {
      const akhir = sekarang + ms;
      while (sekarang < akhir) {
        sekarang = Math.min(akhir, sekarang + 1000);
        pengecek();
      }
    },
    klien: () => new Klien(baseUrl),
    berhenti: () => {
      void close();
      server.closeAllConnections();
      server.close();
      db.close();
      rmSync(uploadDir, { recursive: true, force: true });
    },
  };
}

// Data awal: 2 guru, ujian 1 (milik guru 1, status sesuai argumen) dengan 3 peserta, ujian 2 milik guru 2.
export const PASSWORD_GURU = 'rahasia-guru-123';

export async function isiDataAwal(db: Db, statusUjian1: 'draf' | 'menunggu' | 'berlangsung' = 'menunggu'): Promise<void> {
  const hash = await hashRahasia(PASSWORD_GURU);
  const insertGuru = db.prepare('INSERT INTO penguji (id, username, nama, password_hash, dibuat_at) VALUES (?, ?, ?, ?, ?)');
  insertGuru.run(1, 'guru1', 'Bu Rina', hash, T0);
  insertGuru.run(2, 'guru2', 'Pak Budi', hash, T0);
  const insertUjian = db.prepare(
    'INSERT INTO ujian (id, penguji_id, judul, kode, durasi_menit, status, dibuka_at, dimulai_at, detak_at, dibuat_at, diubah_at) VALUES (?, ?, ?, ?, 90, ?, ?, ?, ?, ?, ?)',
  );
  const dibuka = statusUjian1 === 'draf' ? null : T0;
  const dimulai = statusUjian1 === 'berlangsung' ? T0 : null;
  insertUjian.run(1, 1, 'Latihan Ekonomi', 'ABC234', statusUjian1, dibuka, dimulai, dimulai, T0, T0);
  insertUjian.run(2, 2, 'Latihan Guru Lain', 'XYZ789', 'menunggu', T0, null, null, T0, T0);
  const insertPeserta = db.prepare('INSERT INTO peserta (id, ujian_id, nama, nomor, id_anonim, dibuat_at) VALUES (?, ?, ?, ?, ?, ?)');
  insertPeserta.run(1, 1, 'Budi', '01', 'anon-1', T0);
  insertPeserta.run(2, 1, 'Ani', '02', 'anon-2', T0);
  insertPeserta.run(3, 1, 'Cici', '03', 'anon-3', T0);
  insertPeserta.run(4, 2, 'Dodi', '01', 'anon-4', T0);
}
