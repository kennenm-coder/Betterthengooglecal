-- ============================================================
-- Migration 040: vendor purchase orders (cost, ETA, dock status)
--
-- A third rForce report now lands in /api/upload beside the work-order
-- export and the accounts CSV: one row per VENDOR purchase order, with
-- the PO's status, our cost, and the vendor's estimated ship date. It is
-- scheduled daily at 4:00 am, clear of the hourly work-order import.
--
-- Naming, because this ecosystem already overloads the words:
--   * order_number      — the 8-digit SOLD ORDER number (04961974). This is
--                         what the material-list app stores as
--                         data.job.poNumber ("Agreement or P.O. #") and what
--                         work_orders.order_number holds. It is the join key.
--   * vendor_po_number  — the actual purchase order (ZX3345099P). A different
--                         thing entirely, and the primary key here.
-- One order carries one to nine vendor POs, which is why this is its own
-- table rather than columns on work_orders or keys in jobs.data.
--
-- Three stamps this table keeps that the report does not give us:
--   confirmed_at   first run where the PO reached Confirmed
--   received_at    first run where it reached (Partially) Received — i.e.
--                  roughly when the product hit the dock. rForce does not
--                  expose a received date in this report, so this is the
--                  best we have, and on a daily feed it means "seen received
--                  by this morning" — it can lag the actual dock by up to a
--                  day, and never leads it. Show it as a date, not a time.
--                  If a real "Received Date" column is ever added to the
--                  report, backfill from it and keep the trigger as the
--                  fallback for rows it does not cover.
--   last_seen_at   the last feed this PO appeared in.
--
-- last_seen_at matters because CANCELLED POs are filtered out of the report
-- upstream. A PO that stops appearing has almost certainly been cancelled,
-- so rows are never deleted — they just go stale:
--   select * from public.purchase_orders
--    where last_seen_at < now() - interval '2 days';   -- ~2 missed runs
-- Same absence-detection idea as the scheduling app's dropped-from-rForce
-- check, but note the opposite rule applies to the WRITES: unlike the
-- work-order import, this one must NOT re-touch unchanged rows just to bump
-- a timestamp. last_seen_at is the liveness signal; updated_at means the PO
-- actually changed.
--
-- Costs are not installer business, so the read policy carves installers out
-- the same way 036 did for jobs / install_docs / legacy_install_links.
-- Writes are the import's, which runs on the service-role key and bypasses
-- RLS; the admin policy exists so a bad row can be fixed by hand.
--
-- 019 (is_allowlisted, has_any_role) and 033 (is_installer) must be applied
-- first.
--
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
-- ============================================================

BEGIN;

create table if not exists public.purchase_orders (
  -- The vendor PO itself: "ZX3345099P". Also seen with C and S suffixes.
  vendor_po_number    text primary key,
  -- The sold order number this PO belongs to: "04961974". Not unique here.
  order_number        text not null,
  -- In Process -> Released -> Confirmed -> Partially Received -> Received.
  -- (Cancelled is filtered out of the report upstream; see last_seen_at.)
  po_status           text not null default '',
  -- "Renewal by Andersen", "Renewal by Andersen - Door", "Pro Via Door Inc
  -- ARO", "Bayworld", "Project Materials".
  vendor              text not null default '',
  -- What we pay for this PO. Sum per order_number = product cost on the job.
  cost                numeric(12, 2),
  -- The vendor's estimated SHIP date — not a delivery date, and not the
  -- confirmation PDF's "Plan. Del. Date" that the auditor stores on the job.
  -- Null until the PO is Confirmed; every Confirmed/Received PO has one.
  estimated_ship_date date,
  -- Informational copies of the two order-level columns the report repeats on
  -- every row. Neither is the source of truth: order_status duplicates
  -- work_orders.status, and retail_total disagrees with itself across rows on
  -- about one order in nine.
  order_status        text not null default '',
  retail_total        numeric(12, 2),
  -- Derived stamps; see the trigger below.
  confirmed_at        timestamptz,
  received_at         timestamptz,
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.purchase_orders is
  'One row per vendor purchase order from the daily rForce PO/ETA report. '
  'order_number is the 8-digit sold order number (the join key to '
  'work_orders.order_number and jobs.data.job.poNumber); vendor_po_number is '
  'the vendor PO (ZX...P) and the primary key.';

-- The join every consumer makes: all POs on one order.
create index if not exists idx_purchase_orders_order_number
  on public.purchase_orders (order_number);

-- "What is still coming?" — the dock view. Partial, because once a PO is
-- Received it stops being interesting to that screen.
create index if not exists idx_purchase_orders_open
  on public.purchase_orders (estimated_ship_date)
  where po_status <> 'Received';

-- The stale/cancelled sweep.
create index if not exists idx_purchase_orders_last_seen
  on public.purchase_orders (last_seen_at);

-- ── Derived stamps ───────────────────────────────────────────
-- Kept in a trigger rather than in the importer so the stamps are right no
-- matter who writes the row, and so a bulk upsert does not have to read the
-- old values back first.

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
     and NEW.order_number is not distinct from OLD.order_number then
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

-- ── Access ───────────────────────────────────────────────────

alter table public.purchase_orders enable row level security;

-- Grants are wide open across this database by convention; RLS is the gate.
grant select, insert, update, delete on public.purchase_orders
  to anon, authenticated, service_role;

-- Read: any allowlisted account except an installer. The material-list app
-- (admin / configuring / configuring-editing) and the confirmation auditor
-- both read through this.
drop policy if exists "allowlisted_read_purchase_orders" on public.purchase_orders;
create policy "allowlisted_read_purchase_orders"
  on public.purchase_orders
  for select
  using (public.is_allowlisted() and not public.is_installer());

-- Write: the importer uses the service-role key and bypasses RLS entirely.
-- This policy is only so an admin can correct a row by hand.
drop policy if exists "admin_write_purchase_orders" on public.purchase_orders;
create policy "admin_write_purchase_orders"
  on public.purchase_orders
  for all
  using (public.has_any_role(ARRAY['admin']))
  with check (public.has_any_role(ARRAY['admin']));

COMMIT;

-- Verify (run separately):
--   select count(*) from public.purchase_orders;
--   select po_status, count(*) from public.purchase_orders group by 1 order by 2 desc;
--   -- how many orders in the feed match a job the material-list app knows:
--   select count(distinct p.order_number)
--     from public.purchase_orders p
--     join public.jobs j on j.data -> 'job' ->> 'poNumber' = p.order_number;
--   -- and how many match a work order on the calendar:
--   select count(distinct p.order_number)
--     from public.purchase_orders p
--     join public.work_orders w on w.order_number = p.order_number;
--
-- As a test installer, this must return 0 rows:
--   select count(*) from public.purchase_orders;
