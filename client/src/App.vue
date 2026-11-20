<!--
  client/src/App.vue — halaman status fondasi (Fase 0).
  Dipanggil oleh: client/src/main.ts.
  Memanggil: GET /api/health, shared/health.ts (validasi respons), shared/time.ts (format WIB & selisih jam).
  Tujuan: membuktikan rantai Vue → Express → SQLite berjalan, dan mendemokan cara aplikasi
  memakai JAM SERVER (bukan jam laptop) — pola yang sama dipakai timer ujian nanti.
  Halaman ini diganti oleh halaman masuk penguji/peserta di Fase 2.
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { HealthResponseSchema } from '../../shared/health.ts';
import { computeClockOffset, formatWib } from '../../shared/time.ts';

type Status = 'memuat' | 'siap' | 'gagal';

const status = ref<Status>('memuat');
const errorMessage = ref('');
// Selisih (ms) jam server terhadap jam laptop; null sampai server pertama kali menjawab.
const clockOffset = ref<number | null>(null);
const now = ref(Date.now());

const serverClock = computed(() =>
  clockOffset.value === null ? '—' : formatWib(now.value + clockOffset.value),
);
const offsetText = computed(() => {
  if (clockOffset.value === null) return '—';
  const seconds = Math.abs(clockOffset.value) / 1000;
  if (seconds < 1) return 'jam laptop sesuai server';
  const direction = clockOffset.value > 0 ? 'terlambat' : 'terlalu cepat';
  return `jam laptop ${direction} ${seconds.toFixed(1)} detik dari server`;
});

async function checkServer(): Promise<void> {
  status.value = 'memuat';
  try {
    const sentAt = Date.now();
    const response = await fetch('/api/health', { cache: 'no-store' });
    const receivedAt = Date.now();
    if (!response.ok) throw new Error(`Server menjawab status ${response.status}`);
    // Respons divalidasi dengan skema yang sama dengan server; bentuk yang aneh langsung ketahuan.
    const body = HealthResponseSchema.parse(await response.json());
    clockOffset.value = computeClockOffset(sentAt, receivedAt, body.serverTime);
    status.value = 'siap';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
    status.value = 'gagal';
  }
}

let ticker: number | undefined;
onMounted(() => {
  void checkServer();
  ticker = window.setInterval(() => {
    now.value = Date.now();
  }, 1000);
});
onUnmounted(() => window.clearInterval(ticker));
</script>

<template>
  <main class="min-h-screen bg-base-200 flex items-center justify-center p-6">
    <div class="card bg-base-100 shadow-xl w-full max-w-md">
      <div class="card-body gap-4">
        <h1 class="card-title text-2xl">
          <i class="fa-solid fa-pen-to-square text-primary" aria-hidden="true"></i>
          Ujian Esai
        </h1>
        <p class="text-base-content/70">Fondasi aplikasi (Fase 0).</p>

        <div v-if="status === 'memuat'" class="flex items-center gap-2">
          <span class="loading loading-spinner loading-sm"></span>
          Menghubungi server…
        </div>

        <div v-else-if="status === 'siap'" role="status" class="alert alert-success">
          <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
          <span>Server &amp; database terhubung.</span>
        </div>

        <div v-else role="alert" class="alert alert-error">
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          <span>Server tidak terhubung: {{ errorMessage }}</span>
        </div>

        <div class="stats stats-vertical bg-base-200">
          <div class="stat">
            <div class="stat-figure text-secondary">
              <i class="fa-solid fa-clock text-3xl" aria-hidden="true"></i>
            </div>
            <div class="stat-title">Jam server</div>
            <div class="stat-value font-mono text-3xl">{{ serverClock }}</div>
            <div class="stat-desc">{{ offsetText }}</div>
          </div>
        </div>

        <div class="card-actions justify-end">
          <button class="btn btn-primary" type="button" :disabled="status === 'memuat'" @click="checkServer">
            <i class="fa-solid fa-rotate" aria-hidden="true"></i>
            Cek ulang
          </button>
        </div>
      </div>
    </div>
  </main>
</template>
