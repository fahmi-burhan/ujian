// server/cli/penguji-buat.ts — perintah `npm run penguji:buat` untuk membuat akun guru di terminal.
// Dipanggil oleh: script "penguji:buat" di package.json (di laptop atau di VPS lewat SSH).
// Memanggil: server/config.ts, server/db/*, server/auth/penguji.ts.
// Password diketik tersembunyi (muncul sebagai *) dan diminta dua kali, supaya tidak tercatat di
// riwayat terminal seperti bila ditulis sebagai argumen perintah.
import { createInterface } from 'node:readline/promises';
import { loadConfig, loadEnvFileFromRoot } from '../config.ts';
import { openDatabase } from '../db/connection.ts';
import { runMigrations } from '../db/migrate.ts';
import { buatPenguji } from '../auth/penguji.ts';
import { MIGRATIONS_DIR } from '../paths.ts';

// Membaca input tanpa menampilkannya (mode "raw" terminal). Backspace dan Ctrl+C didukung.
function tanyaTersembunyi(pertanyaan: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error('Perintah ini harus dijalankan di terminal interaktif (PowerShell/SSH).'));
      return;
    }
    process.stdout.write(pertanyaan);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let isi = '';
    const selesai = (): void => {
      stdin.off('data', saatData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
    };
    const saatData = (potongan: string): void => {
      for (const huruf of potongan) {
        if (huruf === '\r' || huruf === '\n') {
          selesai();
          resolve(isi);
          return;
        }
        if (huruf === '\u0003') {
          selesai();
          reject(new Error('Dibatalkan.'));
          return;
        }
        if (huruf === '\u007f' || huruf === '\b') {
          if (isi.length > 0) {
            isi = isi.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        isi += huruf;
        process.stdout.write('*');
      }
    };
    stdin.on('data', saatData);
  });
}

async function utama(): Promise<void> {
  // Dicek paling awal: tanpa terminal interaktif, password tidak bisa diketik tersembunyi.
  if (!process.stdin.isTTY) {
    throw new Error('Perintah ini harus dijalankan di terminal interaktif (PowerShell/SSH), bukan lewat pipe.');
  }
  loadEnvFileFromRoot();
  const config = loadConfig(process.env, { mode: 'production' });
  const db = openDatabase(config.dbPath);
  try {
    runMigrations(db, MIGRATIONS_DIR);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const username = (await rl.question('Username guru (3–32 karakter, tanpa spasi): ')).trim();
    const nama = (await rl.question('Nama tampil (mis. Bu Rina): ')).trim();
    rl.close();
    const password = await tanyaTersembunyi('Password (minimal 10 karakter): ');
    const ulang = await tanyaTersembunyi('Ulangi password: ');
    if (password !== ulang) throw new Error('Kedua password tidak sama.');
    const id = await buatPenguji(db, Date.now(), { username, nama, password });
    console.log(`Akun guru "${username}" dibuat (id ${id}) di ${config.dbPath}.`);
  } finally {
    db.close();
  }
}

utama().catch((galat: unknown) => {
  console.error(`Gagal: ${galat instanceof Error ? galat.message : String(galat)}`);
  process.exit(1);
});
