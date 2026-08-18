-- ============================================================
-- Migration 007: Fix field write-up RLS (field-manager insert)
--
-- Symptom: field managers get
--   "new row violates row-level security policy for table
--    field_work_orders"
-- when saving a write-up, even though the app lets them open the
-- write-up modal.
--
-- Cause: the INSERT/UPDATE policies live on the database predate the
-- 'field-manager' role (they only allowed 'admin'), so get_user_role()
-- = 'field-manager' is rejected. This re-asserts the policies from
-- migration 005/006 so 'field-manager' is allowed. Idempotent — safe
-- to run more than once.
--
-- Run in Supabase SQL Editor.
-- ============================================================

-- ── 0. Diagnostic (optional) ──
-- Run these two SELECTs first to see what the database currently thinks.
-- Replace the email with the field manager's login email.
--
--   select email, role from public.allowed_emails
--   where email = 'someone@rbanwo.com';
--
--   select policyname, cmd, qual, with_check
--   from pg_policies where tablename = 'field_work_orders';
--
-- If the insert policy's with_check only mentions 'admin', that confirms
-- the stale policy this migration fixes.

-- ── 1. field_work_orders: insert (field workers) ──
drop policy if exists "field_workers_insert_field_work_orders" on public.field_work_orders;
create policy "field_workers_insert_field_work_orders"
  on public.field_work_orders
  for insert
  with check (public.get_user_role() in ('admin', 'field-manager'));

-- ── 2. field_work_orders: update (field workers + office) ──
drop policy if exists "manage_update_field_work_orders" on public.field_work_orders;
create policy "manage_update_field_work_orders"
  on public.field_work_orders
  for update
  using (public.get_user_role() in ('admin', 'field-manager', 'payroll-admin'))
  with check (public.get_user_role() in ('admin', 'field-manager', 'payroll-admin'));

-- ── 3. Storage: field workers can upload write-up photos ──
drop policy if exists "fieldworkers_insert_writeup_photos" on storage.objects;
create policy "fieldworkers_insert_writeup_photos"
  on storage.objects
  for insert
  with check (bucket_id = 'writeup-photos' and public.get_user_role() in ('admin', 'field-manager'));
