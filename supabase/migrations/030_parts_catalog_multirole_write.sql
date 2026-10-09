-- ============================================================
-- 030 - parts_catalog / work_catalog: honour ALL of a user's roles
--
-- The write policies for these two catalogs were written with
-- get_user_role(), which returns ONLY the legacy single `role`
-- column. Everything else moved to multi-role in 017 (the `roles`
-- array + has_role / has_any_role), and the app's own UI gate,
-- canDoFieldWork(roles), already checks every role slot.
--
-- So today a person whose `field-manager` sits in the `roles`
-- array while `role` says something else (say 'member') is shown
-- the catalog editor and then refused by the database. This swaps
-- both policies to has_any_role(), which checks the array AND the
-- legacy column -- the UI and the database finally agree.
--
-- It does NOT widen who may edit: still admin or field-manager.
--
-- Second reason this matters now: the NWO material-list app
-- (cut-list-pro) edits parts_catalog as of 2026-10-09, from its
-- Material Catalog -> Service Parts tab. Same table, same rule,
-- one place to maintain the parts list.
--
-- Both DROPs below name both historical policy names, because this
-- file's predecessor shipped as 014 and was renumbered to 018 -- so
-- depending on the order the live database ran them, it may hold
-- `admins_write_parts_catalog`, `editors_write_parts_catalog`, or
-- both. Dropping both names makes the outcome the same either way.
--
-- Run in Supabase SQL Editor. Idempotent -- safe to re-run.
-- ============================================================

BEGIN;

-- ── parts_catalog ────────────────────────────────────────────
drop policy if exists "admins_write_parts_catalog" on public.parts_catalog;
drop policy if exists "editors_write_parts_catalog" on public.parts_catalog;
create policy "editors_write_parts_catalog"
  on public.parts_catalog for all
  using (public.has_any_role(array['admin', 'field-manager']))
  with check (public.has_any_role(array['admin', 'field-manager']));

-- ── work_catalog (same bug, same fix) ────────────────────────
drop policy if exists "admins_write_work_catalog" on public.work_catalog;
drop policy if exists "editors_write_work_catalog" on public.work_catalog;
create policy "editors_write_work_catalog"
  on public.work_catalog for all
  using (public.has_any_role(array['admin', 'field-manager']))
  with check (public.has_any_role(array['admin', 'field-manager']));

COMMIT;

-- Verify:
--   select policyname, cmd, qual from pg_policies
--    where tablename in ('parts_catalog', 'work_catalog') order by tablename, policyname;
-- Expect one read policy (allowlisted_read_*) and one
-- editors_write_* per table, the write one using has_any_role.
