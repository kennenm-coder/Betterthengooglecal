-- ============================================================
-- Migration 016: Multi-role RLS for legacy_install_links
--
-- Migration 015 gated writes with get_user_role(), which only returns
-- the single PRIMARY role. Accounts that hold a qualifying role as a
-- SECONDARY role (e.g. primary "payroll-admin" + also "scheduling_manager")
-- were wrongly blocked. Switch to has_role() (from migration 004), which
-- checks BOTH the multi-role array and the legacy primary column, so a
-- person gets every capability any of their roles grants.
--
-- Read stays open to any allowlisted user. Only the write policies change.
--
-- Run in Supabase SQL Editor AFTER 015.
-- ============================================================

-- Insert: scheduling roles + admin (any held role qualifies)
drop policy if exists "scheduling_insert_legacy_links" on public.legacy_install_links;
create policy "scheduling_insert_legacy_links"
  on public.legacy_install_links
  for insert
  with check (
    public.has_role('admin')
    or public.has_role('scheduling')
    or public.has_role('scheduling_manager')
  );

-- Update: scheduling roles + admin
drop policy if exists "scheduling_update_legacy_links" on public.legacy_install_links;
create policy "scheduling_update_legacy_links"
  on public.legacy_install_links
  for update
  using (
    public.has_role('admin')
    or public.has_role('scheduling')
    or public.has_role('scheduling_manager')
  )
  with check (
    public.has_role('admin')
    or public.has_role('scheduling')
    or public.has_role('scheduling_manager')
  );

-- Delete: scheduling roles + admin (also used for auto-delete-on-override)
drop policy if exists "scheduling_delete_legacy_links" on public.legacy_install_links;
create policy "scheduling_delete_legacy_links"
  on public.legacy_install_links
  for delete
  using (
    public.has_role('admin')
    or public.has_role('scheduling')
    or public.has_role('scheduling_manager')
  );
