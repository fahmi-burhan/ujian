<!--
  client/src/komponen/guru/PerangkatDikenal.vue — daftar "perangkat dikenal" guru (browser yang pernah berhasil login
  dan boleh melewati antrean login; keputusan pemilik, docs/DESAIN.md §8 Batas laju) dan tombol "Lupakan".
  Penting bila guru pernah login di PC kelas bersama: perangkat itu bisa dilupakan dari laptop guru.
  Dipanggil oleh: client/src/halaman/BerandaGuru.vue.
  Memanggil: GET /api/penguji/masuk/perangkat, DELETE /api/penguji/masuk/perangkat/:id.
-->
<script setup lang="ts">
import { ref } from 'vue';
import { DaftarPerangkatGuruSchema } from '../../../../shared/pantau.ts';
import type { PerangkatGuru } from '../../../../shared/pantau.ts';
import { api, pesanGalat } from '../../api.ts';
import { konfirmasi } from '../../konfirmasi.ts';
import { waktuWib } from '../../label.ts';

const terbuka = ref(false);
const daftar = ref<PerangkatGuru[] | null>(null);
const galat = ref('');

async function muat(): Promise<void> {
  galat.value = '';
  try {
    daftar.value = await api('GET', '/api/penguji/masuk/perangkat', { skema: DaftarPerangkatGuruSchema });
  } catch (e) {
    galat.value = pesanGalat(e);
  }
}

async function buka(): Promise<void> {
  terbuka.value = !terbuka.value;
  if (terbuka.value) await muat();
}

async function lupakan(p: PerangkatGuru): Promise<void> {
  const ok = await konfirmasi({
    judul: p.ini ? 'Lupakan browser ini?' : 'Lupakan perangkat ini?',
    subjek: p.info_perangkat || 'tanpa nama',
    rincian: [
      p.ini
        ? 'Login berikutnya dari browser ini lewat antrean biasa (bisa lebih lambat saat banyak percobaan login).'
        : 'Perangkat itu tidak lagi dikenali; login berikutnya darinya lewat antrean biasa.',
    ],
    labelOk: 'Lupakan',
    ikon: 'laptop',
    warna: 'warning',
  });
  if (!ok) return;
  try {
    await api('DELETE', `/api/penguji/masuk/perangkat/${p.id}`);
  } catch (e) {
    galat.value = pesanGalat(e);
  }
  await muat();
}
</script>

<template>
  <section class="card bg-base-100 shadow">
    <div class="card-body gap-2">
      <button type="button" class="flex items-center gap-2 text-left" :aria-expanded="terbuka" @click="buka">
        <i class="fa-solid" :class="terbuka ? 'fa-chevron-down' : 'fa-chevron-right'" aria-hidden="true"></i>
        <h2 class="card-title"><i class="fa-solid fa-laptop" aria-hidden="true"></i> Perangkat dikenal</h2>
      </button>
      <template v-if="terbuka">
        <p class="text-sm text-base-content/70">
          Browser yang pernah berhasil login sebagai Anda. Login dari browser ini tidak ikut antrean, jadi tetap cepat walau
          ada banyak percobaan login. Lupakan perangkat yang bukan milik Anda (mis. PC kelas).
        </p>
        <div v-if="galat" role="alert" class="alert alert-error"><span>{{ galat }}</span></div>
        <p v-if="daftar && daftar.length === 0" class="text-base-content/60">Tidak ada perangkat dikenal.</p>
        <ul v-else-if="daftar" class="flex flex-col divide-y divide-base-200">
          <li v-for="p in daftar" :key="p.id" class="py-2 flex flex-wrap items-center gap-2">
            <span class="font-medium">{{ p.info_perangkat || 'Perangkat tanpa nama' }}</span>
            <span v-if="p.ini" class="badge badge-sm badge-primary">browser ini</span>
            <span class="text-sm text-base-content/60 flex-1">terakhir dipakai {{ waktuWib(p.dipakai_at) }}</span>
            <button type="button" class="btn btn-xs btn-ghost text-error" @click="lupakan(p)">
              <i class="fa-solid fa-trash" aria-hidden="true"></i> Lupakan
            </button>
          </li>
        </ul>
      </template>
    </div>
  </section>
</template>
