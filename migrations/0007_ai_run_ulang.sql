-- 0007_ai_run_ulang.sql — menandai run AI "nilai ulang" (permintaan pemilik 24 Nov 2026).
-- Hanya run dengan ulang = 1 yang boleh mengganti draf AI yang belum disentuh guru (server/ai/antrean.ts); run biasa
-- tetap hanya menulis ke jawaban yang belum punya nilai sama sekali. Run lama otomatis 0.
ALTER TABLE ai_run ADD COLUMN ulang INTEGER NOT NULL DEFAULT 0 CHECK (ulang IN (0, 1));
