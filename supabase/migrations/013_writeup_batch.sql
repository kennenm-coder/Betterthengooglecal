-- ============================================================
-- Migration 013: Group a write-up's per-unit rows into one submission
--
-- A single write-up submission fans out to one field_work_orders row per unit.
-- Until now those rows were only linked by order_number, so two separate
-- write-ups on the same job blurred together. batch_id tags every row created
-- in the same submission with one shared id, so the doc/PDF can render each
-- write-up as its own numbered section with its own material total.
--
-- Nullable: existing rows stay null and fall back to created-time grouping.
--
-- Run in Supabase SQL Editor.
-- ============================================================

alter table public.field_work_orders
  add column if not exists batch_id uuid;

create index if not exists idx_field_work_orders_batch on public.field_work_orders (batch_id);
