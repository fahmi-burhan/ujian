<!--
  client/src/halaman/MasukPeserta.vue — halaman masuk siswa (alamat "/"), tiga langkah:
    1. ketik kode ujian (tampil di layar depan),
    2. pilih nama sendiri dari daftar,
    3. buat PIN 4 angka (pertama kali, diketik dua kali) atau ketik PIN yang sudah dibuat.
  Dipanggil oleh: client/src/router.ts.
  Memanggil: POST /api/peserta/daftar-nama, POST /api/peserta/masuk (lewat client/src/api.ts).
  Semua teks netral & ramah: siswa yang namanya "sudah dipakai" diarahkan meminta bantuan guru.
-->
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { useRouter } from 'vue-router';
import { DaftarNamaResponsSchema } from '../../../shared/auth.ts';
import type { DaftarNamaRespons } from '../../../shared/auth.ts';
import { PANJANG_KODE_UJIAN, rapikanKode } from '../../../shared/alfabet.ts';
import { api, GalatApi, pesanGalat } from '../api.ts';
import LogoUjian from '../komponen/LogoUjian.vue';

type Langkah = 'kode' | 'nama' | 'pin';
type PesertaPilihan = DaftarNamaRespons['peserta'][number];

const router = useRouter();
const langkah = ref<Langkah>('kode');
const kode = ref('');
const daftar = ref<DaftarNamaRespons | null>(null);
const cari = ref('');
const dipilih = ref<PesertaPilihan | null>(null);
const pin = ref('');
const pinUlang = ref('');
const galat = ref('');
const memuat = ref(false);
const inputPin = ref<HTMLInputElement | null>(null);

const kodeRapi = computed(() => rapikanKode(kode.value));
const pesertaTersaring = computed(() => {
  const kata = cari.value.trim().toLowerCase();
  const semua = daftar.value?.peserta ?? [];
  return kata === '' ? semua : semua.filter((p) => p.nama.toLowerCase().includes(kata) || p.nomor.includes(kata));
});
const pinLengkap = computed(() => /^[0-9]{4}$/.test(pin.value));
const bolehMasuk = computed(() => {
  if (!pinLengkap.value) return false;
  return dipilih.value?.punya_pin ? true : pinUlang.value === pin.value;
});

async function cekKode(): Promise<void> {
  galat.value = '';
  memuat.value = true;
  try {
    daftar.value = await api('POST', '/api/peserta/daftar-nama', {
      body: { kode: kodeRapi.value },
      skema: DaftarNamaResponsSchema,
    });
    cari.value = '';
    langkah.value = 'nama';
  } catch (e) {
    galat.value = pesanGalat(e);
  } finally {
    memuat.value = false;
  }
}

async function pilihNama(peserta: PesertaPilihan): Promise<void> {
  dipilih.value = peserta;
  pin.value = '';
  pinUlang.value = '';
  galat.value = '';
  langkah.value = 'pin';
  await nextTick();
  inputPin.value?.focus();
}

function kembali(ke: Langkah): void {
  galat.value = '';
  langkah.value = ke;
}

async function masuk(): Promise<void> {
  if (!dipilih.value || !bolehMasuk.value) return;
  galat.value = '';
  memuat.value = true;
  try {
    await api('POST', '/api/peserta/masuk', {
      body: {
        kode: kodeRapi.value,
        peserta_id: dipilih.value.id,
        pin: pin.value,
        pin_ulang: dipilih.value.punya_pin ? undefined : pinUlang.value,
      },
    });
    await router.replace('/ujian');
  } catch (e) {
    // PIN baru saja direset guru (daftar nama di layar sudah basi): muat ulang daftar dan kembali ke
    // pilihan nama, supaya siswa membuat PIN baru. "pin_tidak_sama" padahal layar mengira sudah punya PIN
    // berarti hal yang sama (server menganggapnya pembuatan PIN baru tanpa ulangan).
    const pinDireset =
      e instanceof GalatApi && (e.kode === 'pin_berubah' || (e.kode === 'pin_tidak_sama' && dipilih.value.punya_pin));
    if (pinDireset) {
      await cekKode();
      // cekKode berhasil → langkah 'nama'. Bila gagal (mis. ujian baru ditutup), pesannya dari cekKode
      // dipertahankan dan siswa kembali ke langkah kode.
      if (langkah.value === 'nama') galat.value = pesanGalat(new GalatApi(409, 'pin_berubah'));
      else langkah.value = 'kode';
      return;
    }
    galat.value = pesanGalat(e);
    pin.value = '';
    pinUlang.value = '';
    await nextTick();
    inputPin.value?.focus();
  } finally {
    memuat.value = false;
  }
}

// Hanya angka, maksimal 4 digit, walau siswa mengetik huruf atau menempel teks.
function hanyaAngka(nilai: string): string {
  return nilai.replace(/[^0-9]/g, '').slice(0, 4);
}
</script>

<template>
  <main class="min-h-screen bg-base-200 flex items-center justify-center p-4">
    <div class="card bg-base-100 shadow-xl w-full max-w-lg">
      <div class="card-body gap-4">
        <h1 class="card-title text-2xl">
          <LogoUjian class="w-10 h-10" />
          Masuk Ujian
        </h1>

        <ul class="steps steps-horizontal w-full text-sm">
          <li class="step" :class="{ 'step-primary': true }">Kode</li>
          <li class="step" :class="{ 'step-primary': langkah !== 'kode' }">Nama</li>
          <li class="step" :class="{ 'step-primary': langkah === 'pin' }">PIN</li>
        </ul>

        <div v-if="galat" role="alert" class="alert alert-error">
          <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
          <span>{{ galat }}</span>
        </div>

        <!-- Langkah 1: kode ujian -->
        <form v-if="langkah === 'kode'" class="flex flex-col gap-3" @submit.prevent="cekKode">
          <label class="form-control w-full">
            <span class="label-text mb-1">Kode ujian (lihat layar depan kelas)</span>
            <input
              v-model="kode"
              class="input input-bordered input-lg w-full font-mono tracking-[0.4em] uppercase text-center"
              :maxlength="PANJANG_KODE_UJIAN + 2"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              placeholder="ABC234"
              autofocus
            />
          </label>
          <button class="btn btn-primary btn-lg" type="submit" :disabled="memuat || kodeRapi.length !== PANJANG_KODE_UJIAN">
            <span v-if="memuat" class="loading loading-spinner"></span>
            Lanjut
            <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
          </button>
        </form>

        <!-- Langkah 2: pilih nama -->
        <div v-else-if="langkah === 'nama' && daftar" class="flex flex-col gap-3">
          <p class="text-base-content/80">
            <span class="font-semibold">{{ daftar.judul }}</span> | pilih namamu.
          </p>
          <label class="input input-bordered flex items-center gap-2">
            <i class="fa-solid fa-magnifying-glass text-base-content/50" aria-hidden="true"></i>
            <input v-model="cari" type="search" class="grow" placeholder="Cari nama atau nomor absen" />
          </label>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-1">
            <button
              v-for="p in pesertaTersaring"
              :key="p.id"
              type="button"
              class="btn btn-outline justify-start h-auto py-2 normal-case"
              @click="pilihNama(p)"
            >
              <span v-if="p.nomor" class="badge badge-ghost font-mono">{{ p.nomor }}</span>
              <span class="text-left">{{ p.nama }}</span>
            </button>
            <p v-if="pesertaTersaring.length === 0" class="text-base-content/60 col-span-full">
              Nama tidak ditemukan. Bila namamu tidak ada di daftar, beri tahu guru.
            </p>
          </div>
          <button type="button" class="btn btn-ghost btn-sm self-start" @click="kembali('kode')">
            <i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Ganti kode
          </button>
        </div>

        <!-- Langkah 3: PIN -->
        <form v-else-if="langkah === 'pin' && dipilih" class="flex flex-col gap-3" @submit.prevent="masuk">
          <p class="text-lg">
            Halo, <span class="font-semibold">{{ dipilih.nama }}</span>
            <span v-if="dipilih.nomor" class="text-base-content/60"> ({{ dipilih.nomor }})</span>
          </p>

          <div v-if="dipilih.punya_pin" class="alert alert-info text-sm">
            <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
            <span>
              Ketik PIN yang kamu buat sebelumnya. Bila kamu <strong>belum pernah</strong> masuk tetapi nama ini
              sudah punya PIN, atau kamu lupa PIN, minta guru menekan <strong>Reset PIN</strong>.
            </span>
          </div>
          <div v-else class="alert text-sm">
            <i class="fa-solid fa-key" aria-hidden="true"></i>
            <span>Buat PIN 4 angka. Ingat baik-baik, PIN ini dipakai bila kamu perlu masuk lagi.</span>
          </div>

          <label class="form-control w-full">
            <span class="label-text mb-1">{{ dipilih.punya_pin ? 'PIN' : 'PIN baru (4 angka)' }}</span>
            <input
              ref="inputPin"
              :value="pin"
              class="input input-bordered input-lg w-full font-mono tracking-[0.6em] text-center"
              type="password"
              inputmode="numeric"
              autocomplete="off"
              maxlength="4"
              @input="pin = hanyaAngka(($event.target as HTMLInputElement).value)"
            />
          </label>
          <label v-if="!dipilih.punya_pin" class="form-control w-full">
            <span class="label-text mb-1">Ulangi PIN</span>
            <input
              :value="pinUlang"
              class="input input-bordered input-lg w-full font-mono tracking-[0.6em] text-center"
              type="password"
              inputmode="numeric"
              autocomplete="off"
              maxlength="4"
              @input="pinUlang = hanyaAngka(($event.target as HTMLInputElement).value)"
            />
            <span v-if="pinUlang.length === 4 && pinUlang !== pin" class="text-error text-sm mt-1">PIN belum sama.</span>
          </label>

          <button class="btn btn-primary btn-lg" type="submit" :disabled="memuat || !bolehMasuk">
            <span v-if="memuat" class="loading loading-spinner"></span>
            Masuk
            <i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn btn-ghost btn-sm self-start" @click="kembali('nama')">
            <i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Bukan namaku
          </button>
        </form>
      </div>
    </div>
  </main>
</template>
