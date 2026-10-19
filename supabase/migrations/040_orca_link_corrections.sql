-- ============================================================
-- Migration 040: make an Orca job link correctable
--
-- 039 added `orca_job_links` and a trigger that back-fills the
-- mirror when a link is inserted. That trigger only ever fills a
-- row whose order_number is NULL, which is right for a first link
-- and wrong for everything after it:
--
--   * Correcting a link — pointing job 8124444 at a different
--     order — left every row already stamped with the old one.
--   * Deleting a link didn't take the order number back off the
--     rows, so a wrong link could not be undone at all.
--
-- Both are fixed by re-running the resolver over that job's rows
-- rather than filling blanks. The resolver already encodes the
-- right precedence (an 8-digit Customer PO on the row beats any
-- link), so re-running it is always safe: a row that can work out
-- its own order number keeps it, and a row that cannot goes back
-- to null.
--
-- 039 must be applied first.
--
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
-- ============================================================

BEGIN;

-- ── Re-resolve one factory job's rows ───────────────────────
-- Returns how many rows ended up with a different answer, which is
-- the only number worth showing the office: "that placed 14 rows",
-- or "that took 14 rows back".

create or replace function public.orca_reresolve_job(p_job_order_number text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  with updated as (
    update public.orca_rows r
       set order_number = public.orca_resolve_order_number(
             r.customer_po, r.job_order_number, r.barcode, r.name),
           updated_at = now()
     where r.job_order_number = btrim(coalesce(p_job_order_number, ''))
       and r.order_number is distinct from public.orca_resolve_order_number(
             r.customer_po, r.job_order_number, r.barcode, r.name)
    returning 1
  )
  select count(*) into v_count from updated;
  return v_count;
end;
$$;

comment on function public.orca_reresolve_job(text) is
  'Re-runs the resolver over every mirror row for one factory job order '
  'number, and returns how many changed. Used when a link is added, '
  'corrected or removed.';

revoke all on function public.orca_reresolve_job(text) from public, anon;
grant execute on function public.orca_reresolve_job(text) to authenticated, service_role;

-- ── The admin screen's delete path ──────────────────────────
-- Named separately from the function above so the intent reads at
-- the call site: the link is already gone, put the rows back to
-- whatever they can work out on their own.

create or replace function public.orca_clear_job_order(p_job_order_number text)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.orca_reresolve_job(p_job_order_number);
$$;

comment on function public.orca_clear_job_order(text) is
  'After a link is deleted: re-resolve that job''s rows so the order number '
  'comes back off the ones that only had it because of the link. Returns how '
  'many rows changed.';

revoke all on function public.orca_clear_job_order(text) from public, anon;
grant execute on function public.orca_clear_job_order(text) to authenticated, service_role;

-- ── Replace 039's trigger ───────────────────────────────────
-- Same trigger, better body: re-resolve instead of filling blanks,
-- so a corrected link re-points the rows it used to own.

create or replace function public.orca_job_links_reresolve()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- A correction changes which job number the rows hang off, so both
  -- the old and the new one need re-resolving.
  if TG_OP = 'UPDATE' and old.job_order_number is distinct from new.job_order_number then
    perform public.orca_reresolve_job(old.job_order_number);
  end if;
  perform public.orca_reresolve_job(new.job_order_number);
  return new;
end;
$$;

COMMIT;

-- ============================================================
-- Verify (run separately)
--
--   -- a first link places the rows
--   insert into public.orca_job_links (job_order_number, order_number, source)
--     values ('8124444', '04717321', 'manual');
--   select count(*) from public.orca_rows
--    where job_order_number = '8124444' and order_number = '04717321';
--
--   -- a correction re-points them, rather than leaving the old value
--   update public.orca_job_links set order_number = '04717322'
--    where job_order_number = '8124444';
--   select count(*) from public.orca_rows
--    where job_order_number = '8124444' and order_number = '04717321';  -- 0
--
--   -- and deleting it takes the order number back off
--   delete from public.orca_job_links where job_order_number = '8124444';
--   select public.orca_clear_job_order('8124444');
--   select count(*) from public.orca_rows
--    where job_order_number = '8124444' and order_number is not null;   -- 0,
--        -- unless a row carries its own 8-digit Customer PO, which wins
-- ============================================================
