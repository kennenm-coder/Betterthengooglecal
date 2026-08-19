-- ============================================================
-- Migration 009: Let field managers delete write-up photos
--
-- Closed write-ups get a "Delete photos" button (admin + field-manager).
-- The storage delete policy from 006 only allowed admins, so widen it to
-- field-manager too. Row updates (clearing the photos array) are already
-- permitted for admin/field-manager by 005/007.
--
-- Run in Supabase SQL Editor.
-- ============================================================

drop policy if exists "admins_delete_writeup_photos" on storage.objects;
drop policy if exists "fieldworkers_delete_writeup_photos" on storage.objects;
create policy "fieldworkers_delete_writeup_photos"
  on storage.objects
  for delete
  using (bucket_id = 'writeup-photos' and public.get_user_role() in ('admin', 'field-manager'));
