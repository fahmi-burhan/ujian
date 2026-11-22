<!--
  client/src/komponen/LogoUjian.vue — logo aplikasi (bintang delapan di atas buku terbuka) sebagai SVG di dalam halaman,
  jadi tidak perlu unduhan tambahan dan tetap tajam di ukuran berapa pun. Warnanya tetap (punya latar sendiri), sehingga
  terbaca di tema terang maupun gelap. Ukuran diatur lewat class dari pemanggil (mis. class="w-8 h-8").
  Dipanggil oleh: KepalaGuru.vue, MasukGuru.vue, MasukPeserta.vue, Proyektor.vue.
  Memanggil: tidak ada. Berkas yang sama untuk ikon tab browser: client/public/logo.svg.
-->
<template>
  <svg viewBox="0 0 64 64" role="img" aria-label="Logo Ujian" class="shrink-0">
    <rect x="2" y="2" width="60" height="60" rx="15" fill="#1e3a8a" />
    <g fill="#fbbf24">
      <rect x="25" y="9" width="14" height="14" />
      <rect x="25" y="9" width="14" height="14" transform="rotate(45 32 16)" />
    </g>
    <path d="M31 33.5C25.5 30 18 29.5 11 31.5V51C18 49 25.5 49.5 31 53Z" fill="#ffffff" />
    <path d="M33 33.5C38.5 30 46 29.5 53 31.5V51C46 49 38.5 49.5 33 53Z" fill="#dbeafe" />
  </svg>
</template>
