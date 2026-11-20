// tests/config.test.ts — memastikan .env dibaca dengan benar dan nilai salah ditolak saat start.
// Dipanggil oleh: `npm test` (node:test). Memanggil: server/config.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig, loadEnvFileFromRoot } from '../server/config.ts';
import { ROOT_DIR } from '../server/paths.ts';

test('memakai nilai bawaan bila .env kosong; DB_PATH dihitung dari akar proyek', () => {
  const config = loadConfig({}, { mode: 'production' });
  assert.deepEqual(config, {
    mode: 'production',
    port: 3000,
    host: '127.0.0.1',
    dbPath: resolve(ROOT_DIR, 'data/ujian.db'),
    trustProxy: false,
  });
});

test('mode berasal dari pemanggil, bukan dari NODE_ENV di .env', () => {
  const config = loadConfig({ NODE_ENV: 'development' }, { mode: 'production' });
  assert.equal(config.mode, 'production');
});

test('DB_PATH relatif mengikuti akar proyek, bukan folder kerja; :memory: dibiarkan', () => {
  const root = resolve('/proyek/ujian');
  assert.equal(loadConfig({ DB_PATH: 'x/y.db' }, { mode: 'test', rootDir: root }).dbPath, resolve(root, 'x/y.db'));
  assert.equal(loadConfig({ DB_PATH: ':memory:' }, { mode: 'test' }).dbPath, ':memory:');
});

test('membaca nilai dari .env, termasuk TRUST_PROXY=true', () => {
  const config = loadConfig({ PORT: '4300', HOST: '0.0.0.0', TRUST_PROXY: 'true' }, { mode: 'production' });
  assert.equal(config.port, 4300);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.trustProxy, true);
});

test('TRUST_PROXY=false benar-benar dibaca sebagai false', () => {
  assert.equal(loadConfig({ TRUST_PROXY: 'false' }, { mode: 'production' }).trustProxy, false);
});

test('menolak PORT yang bukan angka dengan pesan yang menyebut PORT', () => {
  assert.throws(() => loadConfig({ PORT: 'tigaribu' }, { mode: 'production' }), /PORT/);
});

test('menolak TRUST_PROXY selain true/false (mis. "ya")', () => {
  assert.throws(() => loadConfig({ TRUST_PROXY: 'ya' }, { mode: 'production' }), /TRUST_PROXY/);
});

test('loadEnvFileFromRoot memuat .env tanpa menimpa variabel yang sudah ada', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ujian-env-'));
  const keyA = 'UJIAN_TES_SUDAH_ADA';
  const keyB = 'UJIAN_TES_DARI_FILE';
  try {
    writeFileSync(join(dir, '.env'), `${keyA}=dari_file\n${keyB}=dari_file\n`);
    process.env[keyA] = 'dari_shell';
    assert.equal(loadEnvFileFromRoot(dir), join(dir, '.env'));
    assert.equal(process.env[keyA], 'dari_shell');
    assert.equal(process.env[keyB], 'dari_file');
  } finally {
    delete process.env[keyA];
    delete process.env[keyB];
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadEnvFileFromRoot mengembalikan null bila .env tidak ada', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ujian-env-'));
  try {
    assert.equal(loadEnvFileFromRoot(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
