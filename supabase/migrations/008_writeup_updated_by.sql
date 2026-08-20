-- ============================================================
-- Migration 008: Track who last edited a field write-up
--
-- Write-ups become editable after submission (admin + field-manager).
-- Record who made the last edit and when so the doc/list can show
-- "updated <when> by <who>". updated_at already exists; add the editor.
--
-- Run in Supabase SQL Editor.
-- ============================================================

alter table public.field_work_orders
  add column if not exists updated_by text;

alter table public.field_work_orders
  add column if not exists updated_by_name text;
