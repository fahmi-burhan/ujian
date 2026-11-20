<!--
  client/src/komponen/guru/DaftarPeserta.vue — tab "Peserta": daftar siswa, tambah satu, impor CSV/tempel dari
  Excel, ubah & hapus (draf), reset PIN & buka kunci (setelah dibuka).
  Dipanggil oleh: client/src/halaman/PenyusunanUjian.vue.
  Memanggil: GET/POST /api/ujian/:id/peserta, POST .../peserta/impor, PATCH/DELETE .../peserta/:pid,
  POST .../peserta/:pid/{reset-pin,buka-kunci}; shared/csv.ts untuk pratinjau impor.
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { pesertaDariCsv } from '../../../../shared/csv.ts';
import { BATAS, DaftarPesertaGuruSchema, ImporHasilSchema, PesertaGuruSchema } from '../../../../shared/ujian.ts';
import type { ImporHasil, PesertaGuru, UjianDetail } from '../../../../shared/ujian.ts';
import { api, pesanGalat } from '../../api.ts';
import { LABEL_STATUS_PESERTA } from '../../label.ts';

const props = defineProps<{ ujian: UjianDetail }>();
const emit = defineEmits<{ 'muat-ulang': [] }>();

const daftar = ref<PesertaGuru[] | null>(null);
const galat = ref('');
const nama = ref('');
const nomor = ref('');
const csv = ref('');
const hasilImpor = ref<ImporHasil | null>(null);
const diubah = ref<{ id: number; nama: string; nomor: string } | null>(null);

const draf = computed(() => props.ujian.status === 'draf');
const bolehTambah = computed(() => ['draf', 'menunggu', 'berlangsung', 'dijeda'].includes(props.ujian.status));
const calonImpor = computed(() => (csv.value.trim() ? pesertaDariCsv(csv.value) : []));
// Contoh nama yang terbaca, agar guru melihat sebelum mengimpor bila kolomnya tertukar.
const contohImpor = computed(() => calonImpor.value.slice(0, 5).map((c) => (c.nomor ? `${c.nama} (${c.nomor})` : c.nama)));
// Format "No;Nama" yang umum di sekolah: kolom pertama berisi angka semua → kolom tertukar.
const kolomTertukar = computed(() => calonImpor.value.length > 0 && calonImpor.value.every((c) => /^\d+$/.test(c.nama)));
// U+FFFD muncul bila berkas bukan UTF-8 (mis. disimpan Excel sebagai "CSV (Comma delimited)").
const encodingRusak = computed(() => csv.value.includes('�'));

const base = computed(() => `/api/ujian/${props.ujian.id}/peserta`);

async function muat(): Promise<void> {
  try {
    daftar.value = await api('GET', base.value, { skema: DaftarPesertaGuruSchema });
  } catch (e) {
    galat.value = pesanGalat(e);
  }
}

async function setelahUbah(): Promise<void> {
  await muat();
  emit('muat-ulang');
}

async function coba(kerja: () => Promise<unknown>): Promise<void> {
  galat.value = '';
  try {
    await kerja();
  } catch (e) {
    galat.value = pesanGalat(e);
  }
  await setelahUbah();
}

async function tambah(): Promise<void> {
  await coba(async () => {
    await api('POST', base.value, { body: { nama: nama.value, nomor: nomor.value }, skema: PesertaGuruSchema });
    nama.value = '';
    nomor.value = '';
  });
}

async function bacaBerkas(e: Event): Promise<void> {
  const berkas = (e.target as HTMLInputElement).files?.[0];
  if (berkas) csv.value = await berkas.text();
}

async function impor(): Promise<void> {
  hasilImpor.value = null;
  await coba(async () => {
    hasilImpor.value = await api('POST', `${base.value}/impor`, { body: { csv: csv.value }, skema: ImporHasilSchema });
    csv.value = '';
  });
}

async function simpanUbah(): Promise<void> {
  const d = diubah.value;
  if (!d) return;
  await coba(async () => {
    await api('PATCH', `${base.value}/${d.id}`, { body: { nama: d.nama, nomor: d.nomor }, skema: PesertaGuruSchema });
    diubah.value = null;
  });
}

async function hapus(p: PesertaGuru): Promise<void> {
  if (!window.confirm(`Hapus ${p.nama} dari daftar peserta?`)) return;
  await coba(() => api('DELETE', `${base.value}/${p.id}`));
}

async function resetPin(p: PesertaGuru): Promise<void> {
  if (!window.confirm(`Reset PIN ${p.nama}? Sesinya akan dikeluarkan dan ia membuat PIN baru saat masuk.`)) return;
  await coba(() => api('POST', `${base.value}/${p.id}/reset-pin`));
}

async function bukaKunci(p: PesertaGuru): Promise<void> {
  await coba(() => api('POST', `${base.value}/${p.id}/buka-kunci`));
}

const ALASAN: Record<string, string> = { duplikat: 'sudah ada', tidak_valid: 'nama kosong / terlalu panjang' };

onMounted(muat);
</script>

<template>
  <section class="card bg-base-100 shadow">
    <div class="card-body gap-4">
      <div v-if="galat" role="alert" class="alert alert-error"><span>{{ galat }}</span></div>

      <div v-if="bolehTambah" class="grid gap-4 lg:grid-cols-2">
        <form class="flex flex-col gap-2" @submit.prevent="tambah">
          <h3 class="font-semibold"><i class="fa-solid fa-user-plus" aria-hidden="true"></i> Tambah satu</h3>
          <div class="flex gap-2">
            <input v-model="nama" class="input flex-1" :maxlength="BATAS.nama" placeholder="Nama" required aria-label="Nama" />
            <input v-model="nomor" class="input w-28" :maxlength="BATAS.nomor" placeholder="No. (opsional)" aria-label="Nomor absen" />
            <button class="btn btn-primary" type="submit" :disabled="!nama.trim()">Tambah</button>
          </div>
          <p class="text-xs text-base-content/60">Nomor membedakan dua siswa bernama sama di daftar pilihan nama.</p>
        </form>

        <form class="flex flex-col gap-2" @submit.prevent="impor">
          <h3 class="font-semibold"><i class="fa-solid fa-file-import" aria-hidden="true"></i> Impor banyak</h3>
          <textarea v-model="csv" class="textarea w-full h-24 font-mono text-sm" :maxlength="BATAS.csvKarakter"
            placeholder="Tempel dari Excel (kolom Nama, Nomor) atau pilih berkas CSV"></textarea>
          <div class="flex flex-wrap items-center gap-2">
            <input type="file" accept=".csv,text/csv,text/plain" class="file-input file-input-sm" aria-label="Pilih berkas CSV" @change="bacaBerkas" />
            <span v-if="calonImpor.length" class="text-sm">{{ calonImpor.length }} baris terbaca</span>
            <button class="btn btn-sm btn-primary ml-auto" type="submit" :disabled="calonImpor.length === 0 || calonImpor.length > BATAS.barisImpor || kolomTertukar">
              Impor
            </button>
          </div>
          <p v-if="contohImpor.length" class="text-xs text-base-content/70 break-words">
            Contoh: {{ contohImpor.join(', ') }}<template v-if="calonImpor.length > contohImpor.length">, …</template>
          </p>
          <p v-if="kolomTertukar" class="text-sm text-warning">
            Kolom pertama berisi angka. Urutan kolom harus Nama lalu Nomor — tukar kolomnya di Excel dulu.
          </p>
          <p v-if="encodingRusak" class="text-sm text-warning">
            Ada huruf yang rusak. Di Excel simpan ulang sebagai "CSV UTF-8", atau salin-tempel langsung dari Excel.
          </p>
          <p v-if="calonImpor.length > BATAS.barisImpor" class="text-sm text-warning">Paling banyak {{ BATAS.barisImpor }} nama sekali impor.</p>
        </form>
      </div>

      <div v-if="hasilImpor" role="status" class="alert" :class="hasilImpor.dilewati.length ? 'alert-warning' : 'alert-success'">
        <div class="text-sm">
          <p>{{ hasilImpor.ditambah.length }} nama ditambahkan<template v-if="hasilImpor.dilewati.length">, {{ hasilImpor.dilewati.length }} dilewati:</template></p>
          <ul v-if="hasilImpor.dilewati.length" class="list-disc ml-5">
            <li v-for="d in hasilImpor.dilewati" :key="d.baris">Baris {{ d.baris }} "{{ d.nama }}" — {{ ALASAN[d.alasan] }}</li>
          </ul>
        </div>
      </div>

      <div v-if="!daftar" class="flex items-center gap-2"><span class="loading loading-spinner"></span> Memuat…</div>
      <p v-else-if="daftar.length === 0" class="text-base-content/70">Belum ada peserta.</p>
      <div v-else class="overflow-x-auto">
        <table class="table table-sm">
          <thead>
            <tr><th>Nama</th><th>No.</th><th>Status</th><th>PIN</th><th class="text-right">Aksi</th></tr>
          </thead>
          <tbody>
            <tr v-for="p in daftar" :key="p.id">
              <template v-if="diubah?.id === p.id">
                <td><input v-model="diubah.nama" class="input input-sm w-full" :maxlength="BATAS.nama" aria-label="Nama" /></td>
                <td><input v-model="diubah.nomor" class="input input-sm w-20" :maxlength="BATAS.nomor" aria-label="Nomor" /></td>
                <td colspan="2"></td>
                <td class="text-right whitespace-nowrap">
                  <button type="button" class="btn btn-xs btn-primary" @click="simpanUbah">Simpan</button>
                  <button type="button" class="btn btn-xs btn-ghost" @click="diubah = null">Batal</button>
                </td>
              </template>
              <template v-else>
                <td class="break-words">{{ p.nama }}</td>
                <td class="font-mono">{{ p.nomor }}</td>
                <td>{{ LABEL_STATUS_PESERTA[p.status] }}</td>
                <td>
                  <span v-if="p.terkunci" class="badge badge-warning badge-sm gap-1"><i class="fa-solid fa-lock" aria-hidden="true"></i> Terkunci</span>
                  <span v-else-if="p.punya_pin" class="badge badge-success badge-sm">Sudah dibuat</span>
                  <span v-else class="badge badge-ghost badge-sm">Belum</span>
                </td>
                <td class="text-right whitespace-nowrap">
                  <template v-if="draf">
                    <button type="button" class="btn btn-xs btn-ghost" :aria-label="`Ubah ${p.nama}`" @click="diubah = { id: p.id, nama: p.nama, nomor: p.nomor }">
                      <i class="fa-solid fa-pen" aria-hidden="true"></i>
                    </button>
                    <button type="button" class="btn btn-xs btn-ghost text-error" :aria-label="`Hapus ${p.nama}`" @click="hapus(p)">
                      <i class="fa-solid fa-trash" aria-hidden="true"></i>
                    </button>
                  </template>
                  <template v-else>
                    <button v-if="p.terkunci" type="button" class="btn btn-xs" @click="bukaKunci(p)">
                      <i class="fa-solid fa-lock-open" aria-hidden="true"></i> Buka kunci
                    </button>
                    <button v-if="p.punya_pin" type="button" class="btn btn-xs btn-ghost" @click="resetPin(p)">
                      <i class="fa-solid fa-key" aria-hidden="true"></i> Reset PIN
                    </button>
                  </template>
                </td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
