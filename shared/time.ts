// shared/time.ts — utilitas waktu yang dipakai server dan klien.
// Dipanggil oleh: client/src/App.vue (dan nanti timer ujian, dasbor, proyektor, ekspor).
// Memanggil: Intl.DateTimeFormat bawaan JavaScript.
// Alasan: aturan proyek menampilkan waktu dalam format 24 jam WIB. Zona waktu ditetapkan eksplisit
// ke Asia/Jakarta agar tampilan sama walau laptop peserta salah mengatur zona waktunya.

const WIB_FORMAT = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

// Contoh: formatWib(Date.UTC(2026, 11, 4, 7, 30, 5)) → "14:30:05 WIB"
export function formatWib(epochMs: number): string {
  // id-ID memisahkan jam dengan titik (14.30.05); diganti titik dua agar mudah dibaca di proyektor.
  return `${WIB_FORMAT.format(epochMs).replaceAll('.', ':')} WIB`;
}

// Selisih jam server terhadap jam lokal, memakai titik tengah perjalanan request.
// Contoh: request dikirim pukul 1000, balasan tiba 1200, server menulis 5000 → selisih 5000 - 1100 = 3900.
// Timer ujian nanti menampilkan Date.now() + selisih ini, sehingga jam laptop yang salah tidak berpengaruh.
export function computeClockOffset(sentAt: number, receivedAt: number, serverTime: number): number {
  return serverTime - Math.round((sentAt + receivedAt) / 2);
}
