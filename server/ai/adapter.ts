// server/ai/adapter.ts — antarmuka penyedia AI. Antrean hanya mengenal antarmuka ini, jadi penyedia lain (mis.
// OpenAI atau model lokal lewat terowongan SSH) kelak cukup menambah satu implementasi tanpa mengubah alur.
// Dipanggil oleh: server/ai/antrean.ts, server/ai/claude.ts (implementasi), tes (adapter tiruan).
// Memanggil: server/ai/harga.ts (tipe Pemakaian).
// Keputusan pemilik 22 Nov 2026: sekarang hanya Claude + adapter tiruan untuk tes; adapter lain menyusul.
import type { Pemakaian } from './harga.ts';
import type { ModelAi } from '../../shared/ai.ts';

export type PermintaanAi = {
  model: ModelAi;
  // Instruksi tetap (sama untuk semua jawaban, jadi bisa di-cache penyedia).
  sistem: string;
  // Soal, rubrik, acuan: sama untuk semua jawaban satu soal (bagian awal pesan, bisa di-cache).
  konteksSoal: string;
  // Jawaban siswa yang sudah dibungkus pembatas (aturan keras #6).
  jawaban: string;
  // JSON Schema keluaran (structured outputs). Tetap divalidasi Zod setelah diterima (aturan keras #7).
  skema: Record<string, unknown>;
  maksTokenKeluar: number;
  effort: 'low' | 'medium' | 'high';
};

export type JawabanAi = {
  // Teks keluaran (JSON), atau null bila tidak ada blok teks.
  teks: string | null;
  // 'selesai' = berhenti wajar; selain itu keluaran dianggap tidak bisa dipakai.
  berhenti: 'selesai' | 'batas_token' | 'ditolak' | 'lain';
  pemakaian: Pemakaian;
};

// Jenis galat menentukan reaksi antrean:
// - 'sementara' (jaringan, server penyedia sibuk/429/5xx setelah dicoba ulang SDK): tugas dicoba lagi (terbatas).
// - 'fatal' (kunci API salah/dicabut, saldo habis, batas Console tercapai, permintaan ditolak): seluruh run
//   dihentikan, karena permintaan berikutnya pasti gagal dengan cara yang sama.
export class GalatAi extends Error {
  readonly jenis: 'sementara' | 'fatal';
  readonly kode: string;

  constructor(jenis: 'sementara' | 'fatal', kode: string, pesan: string) {
    super(pesan);
    this.jenis = jenis;
    this.kode = kode;
  }
}

export interface AdapterAi {
  nilai(p: PermintaanAi): Promise<JawabanAi>;
}
