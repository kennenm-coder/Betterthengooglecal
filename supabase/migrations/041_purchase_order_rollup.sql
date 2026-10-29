-- ============================================================
-- Migration 041: one row per order from the vendor-PO feed
--
-- 040 stores one row per vendor PO. The material-list app's job cards want
-- the opposite shape: per JOB, what does the product cost, when does it ship,
-- and is it on the dock yet. An order carries up to nine POs, so the card
-- would otherwise pull the whole table and add it up in the browser.
--
-- That app already went to some trouble to stop its job list downloading
-- things it only summarises (cut-list-pro/supabase-job-tiles.sql), so this
-- aggregates in the database for the same reason: ~475 small rows instead of
-- ~700 full ones, and it stays flat as the PO table grows.
--
-- SECURITY INVOKER, so 040's read policy still applies — an installer gets
-- nothing here either, and costs stay out of their hands.
--
-- Stale rows are excluded, matching the rule the confirmation auditor's
-- auto-confirm uses (confirmation-auditor/lib/rforceAutoConfirm.ts): cancelled
-- POs are filtered out of the report upstream, so a PO that has dropped out of
-- the feed must not keep counting against its job forever. The cutoff is
-- measured from the newest row in the table rather than from the clock, so a
-- morning when the 4 am import failed reads the same as any other.
--
-- 040 must be applied first.
--
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
-- ============================================================

BEGIN;

create or replace function public.purchase_order_rollup()
returns table (
  order_number text,
  -- Live POs on this order.
  po_count integer,
  -- How many the vendor has acknowledged (Confirmed or further along).
  acknowledged_count integer,
  -- How many have landed (Received, or Partially Received).
  received_count integer,
  -- Sum of what we pay across the order's POs; null when none carried a cost.
  total_cost numeric,
  -- The last PO to ship is when the job is actually complete, so the LATEST
  -- date is the one a card should show, not the earliest.
  latest_ship_date date,
  -- When the most recent PO was first seen received. On a daily feed this is
  -- a date, not a time — see 040.
  last_received_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with live as (
    select p.*
    from public.purchase_orders p
    where p.last_seen_at >= (
      select max(q.last_seen_at) - interval '36 hours' from public.purchase_orders q
    )
  )
  select
    live.order_number,
    count(*)::integer                                              as po_count,
    count(*) filter (
      where live.po_status in ('Confirmed', 'Partially Received', 'Received')
    )::integer                                                     as acknowledged_count,
    count(*) filter (
      where live.po_status in ('Partially Received', 'Received')
    )::integer                                                     as received_count,
    sum(live.cost)                                                 as total_cost,
    max(live.estimated_ship_date)                                  as latest_ship_date,
    max(live.received_at)                                          as last_received_at
  from live
  group by live.order_number
$$;

comment on function public.purchase_order_rollup() IS
  'One row per sold order number summarising its vendor POs (count, how many '
  'acknowledged, how many received, total cost, latest ship date). Excludes '
  'POs that have dropped out of the daily feed, which are almost certainly '
  'cancelled. SECURITY INVOKER: 040''s read policy still applies.';

grant execute on function public.purchase_order_rollup() to authenticated;

COMMIT;

-- Verify (run separately):
--   select count(*) from public.purchase_order_rollup();
--   -- orders not fully on the dock yet, soonest ship first:
--   select * from public.purchase_order_rollup()
--    where received_count < po_count
--    order by latest_ship_date nulls last
--    limit 20;
--
-- As a test installer, this must return 0 rows.

-- ---- ROLLBACK ---------------------------------------------------------------
-- drop function if exists public.purchase_order_rollup();
