-- ============================================================
-- 038 - standalone_trim_orders: let the write-up handoff in, and
--       let the standalone-trim role save its own orders
--
-- Two live breakages, both the same policy.
--
-- 1. THE WRITE-UP TRIM HANDOFF HAS NEVER WORKED.
--    Since 2026-10-12 a submitted write-up's trim lines are meant
--    to open a standalone trim order (WU-<job>-<n>) in the
--    material-list maker's queue -- src/lib/trim-order-handoff.ts.
--    019 had already restricted writes on this table to
--    admin / configuring / configuring-editing, which are
--    cut-list roles. Write-ups are created by FIELD MANAGERS, who
--    hold none of those, so every insert was refused by RLS.
--    The handoff is deliberately built never to fail a write-up,
--    so the refusal was swallowed and the trim order silently did
--    not exist. Verified on 2026-10-15: zero WU- rows in the live
--    table, including for a write-up on job 04223726 with two
--    orderable ANDERSEN lines that should have opened one.
--
--    Field managers get INSERT only. A write-up edit always opens
--    a NEW order and never touches an earlier one, so they have no
--    reason to update or delete rows in this table.
--
-- 2. THE standalone-trim ROLE COULD NOT SAVE ITS OWN ORDERS.
--    That role exists in the material-list app to build, save and
--    hold standalone (QO-) trim orders and nothing else, but 019
--    left it out of the write list -- so Save and Hold were refused
--    while the vendor PO insert (trim_purchase_orders, allowlisted
--    write) went through. Half an order. It joins the write list.
--
-- Does NOT widen reads (already any allowlisted user) and does not
-- touch the other tables 019 locked down in the same loop.
--
-- Run in Supabase SQL Editor. Idempotent -- safe to re-run.
-- ============================================================

BEGIN;

-- ── cut-list write, plus the standalone-trim role ────────────
drop policy if exists "cutlist_write_standalone_trim_orders" on public.standalone_trim_orders;
create policy "cutlist_write_standalone_trim_orders"
  on public.standalone_trim_orders for all
  using (
    public.has_any_role(array['admin', 'configuring', 'configuring-editing', 'standalone-trim'])
  )
  with check (
    public.has_any_role(array['admin', 'configuring', 'configuring-editing', 'standalone-trim'])
  );

-- ── the write-up handoff: insert only ────────────────────────
drop policy if exists "fieldmgr_insert_standalone_trim_orders" on public.standalone_trim_orders;
create policy "fieldmgr_insert_standalone_trim_orders"
  on public.standalone_trim_orders for insert
  with check (public.has_any_role(array['admin', 'field-manager']));

COMMIT;

-- Verify:
--   select policyname, cmd from pg_policies
--    where tablename = 'standalone_trim_orders' order by policyname;
-- Expect three: allowlisted_read_standalone_trim_orders (SELECT),
-- cutlist_write_standalone_trim_orders (ALL),
-- fieldmgr_insert_standalone_trim_orders (INSERT).
