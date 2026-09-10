-- ============================================================
-- Migration 020: Responsibility matrix on field write-ups
--
-- Field managers now record who an issue is on. `responsibility` is one of
-- 'customer' | 'manufacturing' | 'retail'. When it's 'retail', `defect_code`
-- carries the responsibility-matrix source code (A2 Ordering, A3 Install,
-- A5 Measurement, A6 Warehouse, A9 Sales, A15 Stain Shop); it's blank
-- otherwise. Both live on the whole-job row of a submission, alongside notes.
--
-- Shown only on the Write-Ups page expanded tile — not in the PDF export.
--
-- Run in Supabase SQL Editor.
-- ============================================================

alter table public.field_work_orders
  add column if not exists responsibility text;

alter table public.field_work_orders
  add column if not exists defect_code text;
