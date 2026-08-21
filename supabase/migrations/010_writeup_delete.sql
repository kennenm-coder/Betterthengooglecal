-- ============================================================
-- Migration 010: Let field managers delete write-ups
--
-- The write-up editor (admin + field-manager) gets a "Delete write-up"
-- button. Migration 005 restricted deletes to admins; widen it to
-- field-manager so the editor's delete works for both roles.
--
-- If you'd rather keep deletes admin-only, skip this migration and the
-- delete button will only succeed for admins (field managers get an RLS
-- error) — tell me and I'll gate the button to admins in the UI too.
--
-- Run in Supabase SQL Editor.
-- ============================================================

drop policy if exists "admins_delete_field_work_orders" on public.field_work_orders;
drop policy if exists "editors_delete_field_work_orders" on public.field_work_orders;
create policy "editors_delete_field_work_orders"
  on public.field_work_orders
  for delete
  using (public.get_user_role() in ('admin', 'field-manager'));
