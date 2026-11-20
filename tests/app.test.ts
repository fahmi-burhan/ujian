// tests/app.test.ts — menguji aplikasi Express lewat HTTP sungguhan (port acak, database di RAM).
// Dipanggil oleh: `npm test`. Memanggil: server/app.ts, shared/health.ts.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.ts';
import { loadConfig } from '../server/config.ts';
import type { Mode } from '../server/config.ts';
import { openDatabase } from '../server/db/connection.ts';
import type { Db } from '../server/db/connection.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { MIGRATIONS_DIR } from '../server/paths.ts';
import { HealthResponseSchema } from '../shared/health.ts';

type Running = { baseUrl: string; stop: () => void };

// Database di RAM yang sudah dimigrasi (rute menyiapkan query ke tabel saat aplikasi dibuat).
function dbUji(): Db {
  const db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  return db;
}

async function start(mode: Mode, distDir?: string): Promise<Running> {
  const db = dbUji();
  const { app } = await createApp({ config: loadConfig({}, { mode }), db, distDir });
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    stop: () => {
      server.close();
      db.close();
    },
  };
}

describe('API (mode test: tanpa Vite dan tanpa dist/)', () => {
  let run: Running;
  before(async () => {
    run = await start('test');
  });
  after(() => run.stop());

  test('GET /api/health menjawab sesuai kontrak bersama dan memakai jam server', async () => {
    const before = Date.now();
    const response = await fetch(`${run.baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = HealthResponseSchema.parse(await response.json());
    assert.ok(body.serverTime >= before && body.serverTime <= Date.now());
  });

  test('rute /api yang tidak dikenal dijawab JSON 404', async () => {
    const response = await fetch(`${run.baseUrl}/api/tidak-ada`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'tidak_ditemukan' });
  });

  test('header keamanan dikirim dan x-powered-by tidak', async () => {
    const response = await fetch(`${run.baseUrl}/api/health`);
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('content-security-policy'), "frame-ancestors 'none'");
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  });

  test('JSON rusak dijawab 400 json_tidak_valid (bukan 500)', async () => {
    const response = await fetch(`${run.baseUrl}/api/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"token": "RAHASIA-123",',
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'json_tidak_valid' });
  });

  test('kiriman lebih dari 1 MB dijawab 413 terlalu_besar (bukan 500)', async () => {
    const response = await fetch(`${run.baseUrl}/api/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isi: 'a'.repeat(1_100_000) }),
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: 'terlalu_besar' });
  });
});

describe('Penyajian dist/ (mode production dengan folder build palsu)', () => {
  let run: Running;
  let distDir: string;
  before(async () => {
    distDir = mkdtempSync(join(tmpdir(), 'ujian-dist-'));
    mkdirSync(join(distDir, 'assets'));
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>Ujian</title>');
    writeFileSync(join(distDir, 'assets', 'app-abc123.js'), 'console.log(1)');
    run = await start('production', distDir);
  });
  after(() => {
    run.stop();
    rmSync(distDir, { recursive: true, force: true });
  });

  test('alamat halaman dijawab index.html tanpa cache', async () => {
    const response = await fetch(`${run.baseUrl}/peserta/ujian`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
  });

  test('aset ber-hash di-cache lama', async () => {
    const response = await fetch(`${run.baseUrl}/assets/app-abc123.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') ?? '', /immutable/);
  });

  test('aset yang tidak ada dijawab 404, bukan index.html', async () => {
    const missingAsset = await fetch(`${run.baseUrl}/assets/app-lama999.js`);
    assert.equal(missingAsset.status, 404);
    const missingFile = await fetch(`${run.baseUrl}/pdf.worker-lama.mjs`);
    assert.equal(missingFile.status, 404);
  });

  test('menolak start production bila dist/ belum dibangun', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'ujian-dist-kosong-'));
    try {
      await assert.rejects(
        createApp({ config: loadConfig({}, { mode: 'production' }), db: dbUji(), distDir: empty }),
        /npm run build/,
      );
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

test('mode development tanpa httpServer ditolak (Vite butuh server untuk hot reload)', async () => {
  await assert.rejects(
    createApp({ config: loadConfig({}, { mode: 'development' }), db: dbUji() }),
    /httpServer/,
  );
});
