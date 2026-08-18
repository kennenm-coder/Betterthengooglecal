-- ============================================================
-- Migration 006: Write-up photos
--
-- Adds a photos column to field_work_orders and a private storage
-- bucket for field photos. Photos are uploaded per unit during a
-- write-up; the office views them (signed URLs) behind the app's
-- sign-in wall and downloads them before the 30-day cleanup.
--
-- Access model (mirrors src/lib/roles.ts):
--   • admin, field-manager → upload photos
--   • any allowlisted user  → view (signed URLs)
--   • admin                 → delete
--
-- Run in Supabase SQL Editor AFTER 005.
-- ============================================================

-- ── 1. Photos metadata + manually-added product on the write-up row ──
alter table public.field_work_orders
  add column if not exists photos jsonb not null default '[]'::jsonb; -- WriteUpPhoto[]

alter table public.field_work_orders
  add column if not exists new_product jsonb; -- WriteUpNewProduct | null

-- ── 2. Private storage bucket ──
insert into storage.buckets (id, name, public)
values ('writeup-photos', 'writeup-photos', false)
on conflict (id) do nothing;

-- ── 3. Storage RLS (storage.objects already has RLS enabled) ──

drop policy if exists "allowlisted_read_writeup_photos" on storage.objects;
create policy "allowlisted_read_writeup_photos"
  on storage.objects
  for select
  using (bucket_id = 'writeup-photos' and public.get_user_role() is not null);

drop policy if exists "fieldworkers_insert_writeup_photos" on storage.objects;
create policy "fieldworkers_insert_writeup_photos"
  on storage.objects
  for insert
  with check (bucket_id = 'writeup-photos' and public.get_user_role() in ('admin', 'field-manager'));

drop policy if exists "admins_delete_writeup_photos" on storage.objects;
create policy "admins_delete_writeup_photos"
  on storage.objects
  for delete
  using (bucket_id = 'writeup-photos' and public.get_user_role() = 'admin');
