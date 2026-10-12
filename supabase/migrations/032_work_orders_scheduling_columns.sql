-- ============================================================
-- 032 - Scheduling columns on work_orders
--
-- RECORDED LATE. These columns were applied out-of-band in
-- August 2026 from a loose supabase-migration-unified-work-orders.sql
-- that sat in the GitHub folder root, outside any repo, and so
-- never made it into this history. This repo CREATES work_orders
-- (005_field_work_orders.sql) yet had no record of eleven of its
-- columns -- that gap is what this file closes.
--
-- They are almost certainly already present in the shared project:
-- RBANWO-Scheduling reads total_units and product_count in
-- production. Every statement is ADD COLUMN IF NOT EXISTS, so
-- running this is a no-op on a database that already has them.
--
-- Why they exist: both this calendar and RBANWO-Scheduling read
-- work_orders, and the scheduler needs the product breakdown and
-- the scheduler-facing notes alongside the fields the calendar
-- already used.
--
-- Run in the Supabase SQL Editor. Idempotent -- safe to re-run.
-- ============================================================

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS description text DEFAULT '',
  ADD COLUMN IF NOT EXISTS combined_retail_total numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS product_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_units integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS windows integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS patio_doors integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS doors integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS order_alerts text DEFAULT '',
  ADD COLUMN IF NOT EXISTS scheduler_notes text DEFAULT '',
  ADD COLUMN IF NOT EXISTS account_name text DEFAULT '',
  ADD COLUMN IF NOT EXISTS job_close_date text DEFAULT '';
