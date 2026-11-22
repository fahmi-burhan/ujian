<!--
  client/src/komponen/DialogIsian.vue — dialog kecil serbaguna pengganti window.prompt/confirm bawaan browser:
  konfirmasi, isian teks (mis. catatan guru), atau isian angka (mis. menit perpanjangan).
  Tampil tanpa animasi/transisi (permintaan pemilik 22 Nov), langsung fokus ke isian, Enter = OK, Esc = batal.
  Dipanggil oleh: client/src/halaman/PantauUjian.vue.
  Memanggil: tidak ada.
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';

export type PermintaanDialog = {
  judul: string;
  pesan?: string;
  jenis: 'konfirmasi' | 'teks' | 'angka';
  nilai?: string;
  min?: number;
  max?: number;
  maksPanjang?: number;
  labelOk?: string;
  bahaya?: boolean;
};

const props = defineProps<{ permintaan: PermintaanDialog }>();
const emit = defineEmits<{ ok: [nilai: string]; batal: [] }>();

const nilai = ref(props.permintaan.nilai ?? '');
const isian = ref<HTMLInputElement | HTMLTextAreaElement | null>(null);
const tombolOk = ref<HTMLButtonElement | null>(null);

const salah = computed(() => {
  const p = props.permintaan;
  if (p.jenis !== 'angka') return '';
  const n = Number(nilai.value.trim());
  if (nilai.value.trim() === '' || !Number.isInteger(n)) return 'Isi angka bulat.';
  if ((p.min !== undefined && n < p.min) || (p.max !== undefined && n > p.max) || n === 0) {
    return `Isi angka ${p.min ?? ''}…${p.max ?? ''} (bukan 0).`;
  }
  return '';
});

function kirim(): void {
  if (salah.value) return;
  emit('ok', nilai.value.trim());
}

onMounted(async () => {
  await nextTick();
  if (isian.value) {
    isian.value.focus();
    isian.value.select();
  } else tombolOk.value?.focus();
});
</script>

<template>
  <!-- Transisi & animasi bawaan daisyUI dimatikan: dialog langsung muncul dan hilang. -->
  <dialog
    class="modal modal-open"
    style="transition: none; animation: none"
    open
    aria-labelledby="judul-dialog-isian"
    @keydown.esc.prevent="emit('batal')"
  >
    <form class="modal-box flex flex-col gap-3" style="transition: none; animation: none; transform: none" @submit.prevent="kirim">
      <h3 id="judul-dialog-isian" class="font-bold text-lg">{{ permintaan.judul }}</h3>
      <p v-if="permintaan.pesan" class="whitespace-pre-line">{{ permintaan.pesan }}</p>
      <textarea
        v-if="permintaan.jenis === 'teks'"
        ref="isian"
        v-model="nilai"
        class="textarea w-full h-24"
        :maxlength="permintaan.maksPanjang"
        @keydown.enter.exact.prevent="kirim"
      ></textarea>
      <input
        v-else-if="permintaan.jenis === 'angka'"
        ref="isian"
        v-model="nilai"
        class="input w-32"
        type="number"
        :min="permintaan.min"
        :max="permintaan.max"
      />
      <p v-if="salah" class="text-sm text-error">{{ salah }}</p>
      <div class="modal-action mt-0">
        <button type="button" class="btn" @click="emit('batal')">Batal</button>
        <button ref="tombolOk" type="submit" class="btn" :class="permintaan.bahaya ? 'btn-error' : 'btn-primary'" :disabled="!!salah">
          {{ permintaan.labelOk ?? 'OK' }}
        </button>
      </div>
    </form>
    <div class="modal-backdrop" @click="emit('batal')"></div>
  </dialog>
</template>
