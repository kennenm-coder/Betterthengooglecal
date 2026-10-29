-- ============================================================
-- Migration 042: separate the JOB a PO belongs to from the SOLD ORDER
--
-- The daily rForce PO report gained a column. It now reports two order
-- numbers per row instead of one:
--
--   Order: Sold Order Number   the original order the customer bought
--   Order: Order Number        the job this PO actually belongs to   <- NEW
--
-- For the original product those are always the same number: across a 704-row
-- sample, all 544 purchase orders ending in "P" had them identical. They
-- diverge for SERVICE parts — the ones ending in "S" or "C" — where the sold
-- number stays on the original install and the new column points at the
-- service job that was opened later. 134 of 139 "S" rows and 20 of 21 "C" rows
-- differed in that sample.
--
-- That matters because a service job carries its OWN order number, and until
-- now we had no way to reach it. Keyed on the sold number, 6 of our 292 open
-- service jobs had parts we could see. Keyed on the new column: 95.
--
-- So `order_number` keeps its name and its job — the join key — but changes
-- MEANING from "the sold order" to "the job this PO belongs to", and the sold
-- order moves into a column of its own. Keeping the name is deliberate: every
-- consumer (the confirmation auditor's rForce sweep, 041's rollup, the service
-- tiles still to be built) wants the job, not the parent, and renaming would
-- quietly repoint all of them at the wrong thing.
--
-- Two consequences worth knowing about:
--
--   * 041's purchase_order_rollup() groups by order_number, so it becomes a
--     per-JOB rollup for free. An install's cost no longer silently includes
--     service parts reordered against it months later. That is the behaviour
--     we want, but it will move some numbers on the job cards.
--
--   * The confirmation auditor's install sweep stops being held back by
--     service parts. One job (04921238) was stuck behind a $5 part,
--     ZX3368257S, which belongs to service job 05020108 — it now keys there.
--
-- The backfill below is exact, not a guess: every row already in this table
-- was imported by the OLD parser, which read `Order: Sold Order Number` into
-- order_number. So for all 702 existing rows, order_number IS the sold order
-- number, and copying it across is right.
--
-- What this migration CANNOT do is correct order_number on the ~154 service
-- rows that are still filed under their parent order — only the report knows
-- the service job numbers. The next import fixes them automatically, because
-- vendor_po_number is the primary key and the upsert rewrites order_number in
-- place. Either wait for the 4:00 am run or upload the newest report by hand.
--
-- 040 must be applied first.
--
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
-- ============================================================

BEGIN;

-- The original order the customer bought. Not unique here, and NOT the join
-- key — one sold order can own both its own install POs and the service POs
-- of every service job opened against it later.
alter table public.purchase_orders
  add column if not exists sold_order_number text not null default '';

-- Exact for every row imported by the old parser; see the header. The guard
-- keeps a re-run from clobbering values a later import has set.
update public.purchase_orders
   set sold_order_number = order_number
 where sold_order_number = '';

comment on column public.purchase_orders.order_number is
  'The JOB this PO belongs to — an install order or a service order. From the '
  'report''s "Order: Order Number". The join key, to work_orders.order_number '
  'and to jobs.data.job.poNumber.';

comment on column public.purchase_orders.sold_order_number is
  'The original sold order the customer bought, from the report''s "Order: '
  'Sold Order Number". Equal to order_number for the original product; for a '
  'service part it is the parent install while order_number is the service '
  'job. Informational — never the join key.';

comment on table public.purchase_orders is
  'One row per vendor purchase order from the daily rForce PO/ETA report. '
  'order_number is the job the PO belongs to (install OR service) and is the '
  'join key; sold_order_number is the original order it descends from; '
  'vendor_po_number is the vendor PO (ZX...P) and the primary key.';

-- "Everything ever ordered against this customer's original order", which is
-- the install plus every service job hung off it.
create index if not exists idx_purchase_orders_sold_order_number
  on public.purchase_orders (sold_order_number);

-- ── Trigger: teach it about the new column ───────────────────
-- Unchanged except for the sold_order_number comparison at the end. Without
-- it, a row whose sold order was corrected would keep a stale updated_at and
-- the "what actually moved in this feed" question would answer wrongly.

create or replace function public.purchase_orders_stamp()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'UPDATE' then
    -- The feed re-sends every row; the first sighting is the real one.
    NEW.first_seen_at := OLD.first_seen_at;
    -- A stamp, once set, is history. Never move it, even if the PO's status
    -- goes backwards (a revised PO can drop from Received to Confirmed).
    NEW.confirmed_at := OLD.confirmed_at;
    NEW.received_at := OLD.received_at;
  end if;

  if NEW.confirmed_at is null
     and NEW.po_status in ('Confirmed', 'Partially Received', 'Received') then
    NEW.confirmed_at := now();
  end if;

  if NEW.received_at is null
     and NEW.po_status in ('Partially Received', 'Received') then
    NEW.received_at := now();
  end if;

  -- updated_at means "this PO changed", not "the import ran". Every run
  -- re-sends all ~730 rows, so bumping it unconditionally would make the
  -- column useless for spotting what actually moved. last_seen_at, which the
  -- importer sets on every row, is the liveness signal instead.
  if TG_OP = 'UPDATE'
     and NEW.po_status is not distinct from OLD.po_status
     and NEW.vendor is not distinct from OLD.vendor
     and NEW.cost is not distinct from OLD.cost
     and NEW.estimated_ship_date is not distinct from OLD.estimated_ship_date
     and NEW.order_status is not distinct from OLD.order_status
     and NEW.retail_total is not distinct from OLD.retail_total
     and NEW.order_number is not distinct from OLD.order_number
     and NEW.sold_order_number is not distinct from OLD.sold_order_number then
    NEW.updated_at := OLD.updated_at;
  else
    NEW.updated_at := now();
  end if;

  return NEW;
end;
$$;

comment on function public.purchase_orders_stamp() IS
  'Stamps confirmed_at / received_at the first time a PO reaches those '
  'statuses, and protects first_seen_at and both stamps from being reset by '
  'the next import run.';

drop trigger if exists trg_purchase_orders_stamp on public.purchase_orders;
create trigger trg_purchase_orders_stamp
  before insert or update on public.purchase_orders
  for each row execute function public.purchase_orders_stamp();

COMMIT;

-- Verify (run separately):
--
--   -- the column exists and nothing was left blank
--   select count(*) as total,
--          count(*) filter (where sold_order_number = '') as blank
--     from public.purchase_orders;
--
--   -- BEFORE the next import these must be equal on every row, because the
--   -- old parser only ever had the sold number to work with:
--   select count(*) filter (where order_number = sold_order_number) as same,
--          count(*) filter (where order_number <> sold_order_number) as differs
--     from public.purchase_orders;
--
--   -- AFTER the next import, "differs" should be ~154, and every one of them
--   -- should be a service part (a PO ending in S or C):
--   select right(vendor_po_number, 1) as suffix, count(*)
--     from public.purchase_orders
--    where order_number <> sold_order_number
--    group by 1 order by 2 desc;
--
--   -- and the payoff: open service jobs whose parts we can now see
--   select count(distinct w.order_number)
--     from public.work_orders w
--     join public.purchase_orders p on p.order_number = w.order_number
--    where w.work_order_type = 'Service'
--      and w.appointment_status <> 'Appt Complete / Closed';
--
--   -- the chase list: service jobs with a part the vendor has not acknowledged
--   select w.order_number, w.customer_name, w.status,
--          p.vendor_po_number, p.po_status, p.estimated_ship_date
--     from public.work_orders w
--     join public.purchase_orders p on p.order_number = w.order_number
--    where w.work_order_type = 'Service'
--      and p.po_status = 'Released'
--    order by w.order_number;
--
-- As a test installer, this must still return 0 rows:
--   select count(*) from public.purchase_orders;
