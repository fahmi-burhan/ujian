// client/src/uuid.ts — membuat UUID v4 untuk ID tab dan ID kiriman autosave (docs/DESAIN.md §5).
// Dipanggil oleh: client/src/halaman/UjianPeserta.vue.
// Memanggil: Web Crypto bawaan browser.
// Alasan ada cadangan: crypto.randomUUID hanya tersedia di "secure context" (HTTPS atau 127.0.0.1).
// Di VPS (HTTPS) selalu tersedia; cadangan getRandomValues dipakai bila halaman dibuka lewat alamat lain.
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  // Bit versi (4) dan varian (10xx) sesuai RFC 4122, supaya lolos validasi z.uuid() di server.
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
