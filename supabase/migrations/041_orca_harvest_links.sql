-- ============================================================
-- Migration 041: harvest the links the data already contains
--
-- The join looked like a process problem — get the factory job
-- number into rForce, or have the warehouse retype our order number
-- at receiving. Both cost somebody something, every day, forever.
--
-- But some Orca rows already carry BOTH: our 8-digit order number in
-- `Customer PO` and the factory's job number in `Job Order Number`.
-- Each of those rows is a confirmed link, free, sitting in data we
-- already have. And a link places every row that shares its job
-- number — so one row that happens to carry both can place the
-- fifteen siblings that carry only one.
--
-- This turns that into one function the office can run. It is
-- additive and conservative:
--
--   * a job number pointing at two different order numbers is NOT a
--     link, it is a data problem — those are skipped, never guessed
--   * it never overwrites a link someone made by hand
--   * re-running it is harmless
--
-- Run `supabase/orca_join_probe.sql` first to see what it would do.
--
-- 039 and 040 must be applied first.
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
-- ============================================================

BEGIN;

create or replace function public.orca_harvest_links()
returns table (links_added integer, rows_placed integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_links integer := 0;
  v_rows  integer := 0;
begin
  -- Every job number that resolves to exactly one order number across
  -- the rows that carry both. `having count(distinct ...) = 1` is what
  -- keeps a contradictory pair out: two answers is not an answer.
  with pairs as (
    select distinct
      btrim(job_order_number) as job_order_number,
      btrim(customer_po)      as order_number
    from public.orca_rows
    where deleted_at is null
      and btrim(coalesce(customer_po, '')) ~ '^[0-9]{8}$'
      and coalesce(btrim(job_order_number), '') <> ''
  ),
  clean as (
    select job_order_number, min(order_number) as order_number
    from pairs
    group by job_order_number
    having count(distinct order_number) = 1
  ),
  inserted as (
    insert into public.orca_job_links (job_order_number, order_number, source)
    select c.job_order_number, c.order_number, 'harvested'
    from clean c
    -- Never clobber a hand-made link. If the office decided something
    -- different, they had a reason and they are closer to it.
    on conflict (job_order_number) do nothing
    returning 1
  )
  select count(*) into v_links from inserted;

  -- The trigger from 040 re-resolves as each link lands, so the rows
  -- are already placed by the time we get here. Count what that was
  -- worth rather than doing it again.
  select count(*) into v_rows
  from public.orca_rows r
  join public.orca_job_links l on l.job_order_number = r.job_order_number
  where r.deleted_at is null
    and r.order_number is not null
    and l.source = 'harvested';

  return query select v_links, v_rows;
end;
$$;

comment on function public.orca_harvest_links() is
  'Creates orca_job_links from the Orca rows that already carry both our '
  'order number and the factory job number. Skips any job number with two '
  'competing answers, and never overwrites a hand-made link.';

revoke all on function public.orca_harvest_links() from public, anon;
grant execute on function public.orca_harvest_links() to authenticated, service_role;

COMMIT;

-- ============================================================
-- Verify (run separately)
--
--   -- see what it would do first
--   \i supabase/orca_join_probe.sql
--
--   -- then do it
--   select * from public.orca_harvest_links();
--
--   -- and check the damage
--   select source, count(*) from public.orca_job_links group by source;
--   select count(*) from public.orca_rows
--    where order_number is not null and deleted_at is null;
--
-- To undo a harvest (it only ever adds rows marked 'harvested'):
--   delete from public.orca_job_links where source = 'harvested';
--   select public.orca_reresolve_order_numbers();
--   -- note: that re-resolve only fills blanks; to take the harvested
--   -- order numbers back OFF the rows, re-resolve each job instead:
--   --   select public.orca_reresolve_job(job_order_number) from ...
-- ============================================================
