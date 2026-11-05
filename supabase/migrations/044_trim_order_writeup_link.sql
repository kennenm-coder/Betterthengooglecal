-- ============================================================
-- 044 - Tie a standalone trim order to the write-up that opened it
--
-- Until now a write-up's trim order (WU-<job>-<n>) was linked to its
-- write-up only by the SHAPE OF ITS NAME. Two things followed:
--
--   1. Renaming the order in the material-list app (which is how the
--      office puts the real service-order number on it) saves the
--      order under the new number and deletes the WU- row. The
--      write-up could never find its order again.
--   2. Nothing could update an earlier order when the write-up's
--      trim changed, so an edit always opened a second one.
--
-- writeup_job is the write-up's order number. It lives in a column,
-- not in the name, so it survives a rename (the material-list app
-- copies it across -- storage.js renameStandaloneOrder).
--
-- writeup_changed_at is stamped when an edit to the write-up's TRIM
-- changes an order that has not been placed yet. The queue shows a
-- "write-up changed" badge until someone saves the order again
-- (a save moves updated_at past it).
--
-- Field managers may now UPDATE -- but only an order that came from a
-- write-up and has not been placed. A placed order (status 'ordered')
-- is never touched from the calendar; a trim change after that opens
-- a new order instead.
--
-- Run in Supabase SQL Editor. Idempotent -- safe to re-run.
-- ============================================================

BEGIN;

alter table public.standalone_trim_orders
  add column if not exists writeup_job text,
  add column if not exists writeup_changed_at timestamptz;

create index if not exists idx_sto_writeup_job
  on public.standalone_trim_orders (writeup_job)
  where writeup_job is not null;

-- Orders opened before this column existed: the PO name carries the job.
update public.standalone_trim_orders
   set writeup_job = substring(po from '^WU-(.+)-[0-9]+$')
 where writeup_job is null
   and po ~ '^WU-.+-[0-9]+$';

drop policy if exists "fieldmgr_update_writeup_trim_orders" on public.standalone_trim_orders;
create policy "fieldmgr_update_writeup_trim_orders"
  on public.standalone_trim_orders for update
  using (
    public.has_any_role(array['admin', 'field-manager'])
    and writeup_job is not null
    and status in ('ready_to_order', 'on_hold')
  )
  with check (
    public.has_any_role(array['admin', 'field-manager'])
    and writeup_job is not null
    and status in ('ready_to_order', 'on_hold')
  );

COMMIT;

-- Verify:
--   select policyname, cmd from pg_policies
--    where tablename = 'standalone_trim_orders' order by policyname;
-- Expect four: allowlisted_read_standalone_trim_orders (SELECT),
-- cutlist_write_standalone_trim_orders (ALL),
-- fieldmgr_insert_standalone_trim_orders (INSERT),
-- fieldmgr_update_writeup_trim_orders (UPDATE).
--   select column_name from information_schema.columns
--    where table_name = 'standalone_trim_orders'
--      and column_name in ('writeup_job', 'writeup_changed_at');
