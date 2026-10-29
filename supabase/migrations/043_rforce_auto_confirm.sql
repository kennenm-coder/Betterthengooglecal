-- ============================================================
-- Migration 043: confirm jobs from the rForce feed, unattended
--
-- The sweep started life as a button in the confirmation auditor. It should
-- not be: the feed arrives at 4:00 am on its own, and a job the vendor
-- acknowledged weeks ago should not sit in the queue until somebody remembers
-- to click something.
--
-- Running on a schedule means the rule cannot live in one app's TypeScript.
-- Both apps share this database, and the import that triggers it runs in the
-- calendar app while the confirmation it writes belongs to the auditor — so
-- the rule lives here, once, and both call it.
--
-- WHAT IT DOES
--   For every job in the confirmation queue (data.status = 'trim_ordered'),
--   look up its purchase orders by the job's PO field. If the vendor has
--   acknowledged EVERY live PO on that order — Confirmed, Partially Received
--   or Received — mark the job confirmed.
--
-- WHAT IT IS NOT
--   Not an audit. A confirmation saved by hand in the auditor proves, unit by
--   unit, that the confirmation PDF matches what the install package ordered.
--   This proves only that the vendor said "got it". So it writes
--   source = 'rforce_feed' and NO confidence score, and the auditor shows it
--   as "Confirmed in rForce" rather than as an audited confirmation. Never
--   collapse the two.
--
-- WHAT IT WILL NOT TOUCH
--   A job someone already confirmed, and a job someone has a draft open on.
--   A person's work always beats the feed.
--
-- p_apply = false (the default) writes nothing and reports what it would do,
-- which is what the auditor's screen shows before anyone commits to it.
--
-- STALE POs are excluded on the same 36-hour rule as 041's rollup: cancelled
-- POs are filtered out of the report upstream, so one that has dropped out of
-- the feed must not hold its job back forever. The cutoff is measured from the
-- newest row in the table, not the clock, so a morning the import failed reads
-- like any other.
--
-- SECURITY INVOKER on purpose. The nightly run is the importer on the service
-- role, which bypasses RLS; a person calling it gets exactly the jobs and POs
-- their own role can see, and the auditor still gates the button to admins.
--
-- 040 and 042 must be applied first.
--
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
-- ============================================================

BEGIN;

create or replace function public.rforce_auto_confirm(
  p_apply boolean default false,
  p_actor text default 'rForce feed'
)
returns table (
  job_id text,
  customer text,
  po text,
  -- 'eligible', or why not: 'already-confirmed', 'audit-in-progress',
  -- 'no-order-number', 'not-in-rforce', 'vendor-has-not-confirmed'.
  verdict text,
  po_count integer,
  acknowledged_count integer,
  latest_ship_date date,
  total_cost numeric,
  -- "2 Confirmed, 1 Released" — the evidence, for the screen to show.
  detail text,
  -- True only for rows this call actually wrote.
  confirmed boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  return query
  with live as (
    select p.*
    from public.purchase_orders p
    where p.last_seen_at >= (
      select max(q.last_seen_at) - interval '36 hours' from public.purchase_orders q
    )
  ),
  per_status as (
    select l.order_number, l.po_status, count(*) as cnt
    from live l
    group by 1, 2
  ),
  agg as (
    select
      l.order_number,
      count(*)::integer as po_count,
      count(*) filter (
        where l.po_status in ('Confirmed', 'Partially Received', 'Received')
      )::integer as acknowledged_count,
      max(l.estimated_ship_date) as latest_ship_date,
      sum(l.cost) as total_cost,
      jsonb_agg(l.vendor_po_number order by l.vendor_po_number) as vendor_po_numbers,
      (select string_agg(s.cnt || ' ' || s.po_status, ', ' order by s.cnt desc, s.po_status)
         from per_status s where s.order_number = l.order_number) as detail,
      (select jsonb_object_agg(s.po_status, s.cnt)
         from per_status s where s.order_number = l.order_number) as statuses
    from live l
    group by l.order_number
  ),
  queue as (
    select
      j.id::text as job_id,
      j.data as data,
      btrim(coalesce(j.data->'job'->>'poNumber', '')) as po,
      j.data->'job'->>'customerName' as customer,
      j.data->'confirmation'->>'status' as conf_status
    from public.jobs j
    where j.data->>'status' = 'trim_ordered'
  ),
  judged as (
    select
      q.*,
      a.po_count, a.acknowledged_count, a.latest_ship_date, a.total_cost,
      a.vendor_po_numbers, a.statuses, a.detail,
      case
        -- Order matters: a job somebody already settled is reported as
        -- settled, not as something the feed has an opinion about.
        when q.conf_status = 'confirmed' then 'already-confirmed'
        when q.conf_status = 'draft'     then 'audit-in-progress'
        when q.po = ''                   then 'no-order-number'
        when a.order_number is null      then 'not-in-rforce'
        when a.acknowledged_count < a.po_count then 'vendor-has-not-confirmed'
        else 'eligible'
      end as verdict
    from queue q
    left join agg a on a.order_number = q.po
  ),
  written as (
    update public.jobs j
       set data = jsonb_set(
             j.data,
             '{confirmation}',
             coalesce(j.data->'confirmation', '{}'::jsonb) || jsonb_build_object(
               'status',   'confirmed',
               'savedAt',  v_now,
               'savedBy',  p_actor,
               'source',   'rforce_feed',
               'rforce',   jsonb_build_object(
                 'confirmedAt',     v_now,
                 'poCount',         d.po_count,
                 'vendorPoNumbers', d.vendor_po_numbers,
                 'statuses',        d.statuses,
                 'latestShipDate',  d.latest_ship_date,
                 'totalCost',       d.total_cost
               )
             ),
             true
           ),
           updated_at = now()
      from judged d
     where p_apply
       and j.id::text = d.job_id
       and d.verdict = 'eligible'
       -- Re-read the row's own confirmation rather than trusting the CTE:
       -- between judging and writing, someone may have confirmed it by hand.
       and coalesce(j.data->'confirmation'->>'status', '') not in ('confirmed', 'draft')
    returning j.id::text as job_id
  )
  select
    d.job_id,
    coalesce(d.customer, '')                       as customer,
    d.po                                           as po,
    d.verdict                                      as verdict,
    coalesce(d.po_count, 0)                        as po_count,
    coalesce(d.acknowledged_count, 0)              as acknowledged_count,
    d.latest_ship_date                             as latest_ship_date,
    d.total_cost                                   as total_cost,
    coalesce(d.detail, '')                         as detail,
    (w.job_id is not null)                         as confirmed
  from judged d
  left join written w on w.job_id = d.job_id;
end;
$$;

comment on function public.rforce_auto_confirm(boolean, text) IS
  'Confirms queued jobs whose vendor has acknowledged every live purchase '
  'order, writing data.confirmation with source=rforce_feed and no confidence '
  'score. Never touches a job that is already confirmed or has a draft open. '
  'p_apply=false reports what it would do and writes nothing. Called nightly '
  'by the calendar app''s PO import and on demand by the confirmation auditor.';

revoke all on function public.rforce_auto_confirm(boolean, text) from public, anon;
grant execute on function public.rforce_auto_confirm(boolean, text) to authenticated, service_role;

COMMIT;

-- Verify (run separately):
--
--   -- what it WOULD do; writes nothing
--   select verdict, count(*)
--     from public.rforce_auto_confirm(false)
--    group by 1 order by 2 desc;
--
--   -- the evidence behind the ones it would leave alone
--   select po, customer, detail
--     from public.rforce_auto_confirm(false)
--    where verdict = 'vendor-has-not-confirmed'
--    order by po;
--
--   -- after a real run, these are the feed's confirmations
--   select count(*) from public.jobs
--    where data->'confirmation'->>'source' = 'rforce_feed';
--
--   -- and this must stay 0: the feed never claims a confidence score
--   select count(*) from public.jobs
--    where data->'confirmation'->>'source' = 'rforce_feed'
--      and data->'confirmation' ? 'confidencePct';

-- ---- ROLLBACK ---------------------------------------------------------------
-- drop function if exists public.rforce_auto_confirm(boolean, text);
