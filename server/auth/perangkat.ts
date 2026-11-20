// server/auth/perangkat.ts — meringkas User-Agent menjadi teks pendek seperti "Edge / Windows".
// Dipanggil oleh: server/routes/*-auth.ts (disimpan di sesi.info_perangkat dan detail event masuk_ulang).
// Memanggil: tidak ada.
// Tujuan: membantu guru mengenali laptop mana yang dipakai ("masuk ulang dari Chrome / Windows"),
// BUKAN untuk melacak siswa. Urutan pengecekan penting: UA Edge juga memuat kata "Chrome".

export function ringkasPerangkat(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser lain';
  const sistem = /Windows/.test(ua)
    ? 'Windows'
    : /CrOS/.test(ua)
      ? 'ChromeOS'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Android/.test(ua)
          ? 'Android'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'OS lain';
  return `${browser} / ${sistem}`;
}
