-- ============================================================
-- Migration 052: Write-up stage from rForce + Job Closed auto-close
--
-- Every hourly work-order import now looks at each OPEN write-up's address
-- and the rForce orders behind it, and records where that work stands:
--
--   rforce_stage         one key for the tile's stage tag and the Open tab's
--                        filters: past_due, needs_scheduling, waiting_product,
--                        scheduled, jip, not_started, complete_not_closed,
--                        legacy, job_closed, closed_reopened.
--   rforce_stage_detail  what the tag shows: the order it came from, that
--                        order's rForce status, the date, how many orders at
--                        the address are still open.
--   rforce_checked_at    when the import last changed any of the above.
--   job_closed_since     set the first import that sees the write-up's own
--                        order AND every service order at the address closed.
--                        Seven days later the write-up closes itself. Cleared
--                        when anything reopens — or when the write-up's
--                        status changes at all (trigger below).
--   auto_closed_at       stamped when the import closed it. A write-up that
--                        was auto-closed and then reopened by hand is never
--                        auto-closed again.
--
-- rForce never sends a "Closed" status: its report filters closed orders out.
-- So "closed" here means "missing from the last 10 imports", and the import
-- keeps its own run ledger (rforce_import_runs) to count those — the hourly
-- feed only runs 8am-5pm on weekdays, so wall-clock time would call every
-- order closed on a Monday morning.
--
-- The ledger is written only by the server (service role). RLS on with no
-- policies keeps every signed-in user out of it.
--
-- Run in Supabase SQL Editor.
-- ============================================================

alter table public.field_work_orders
  add column if not exists rforce_stage text;

alter table public.field_work_orders
  add column if not exists rforce_stage_detail jsonb;

alter table public.field_work_orders
  add column if not exists rforce_checked_at timestamptz;

alter table public.field_work_orders
  add column if not exists job_closed_since timestamptz;

alter table public.field_work_orders
  add column if not exists auto_closed_at timestamptz;

comment on column public.field_work_orders.rforce_stage is
  'Where the rForce orders behind this write-up stand, worked out by the hourly import.';
comment on column public.field_work_orders.job_closed_since is
  'Every rForce order behind this write-up is closed since this time; it auto-closes 7 days later.';
comment on column public.field_work_orders.auto_closed_at is
  'Closed by the import, not a person. Reopened by hand = never auto-closed again.';

-- Any status change resets the Job Closed clock. Done in the database rather
-- than the app because a write-up's status is saved from several places (the
-- tile buttons, the edit form, the review flow); a reopened write-up must not
-- keep an old clock and close itself on the next import.
create or replace function public.field_work_orders_reset_job_closed()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    new.job_closed_since := null;
  end if;
  return new;
end;
$$;

drop trigger if exists field_work_orders_reset_job_closed on public.field_work_orders;
create trigger field_work_orders_reset_job_closed
  before update on public.field_work_orders
  for each row execute function public.field_work_orders_reset_job_closed();

create table if not exists public.rforce_import_runs (
  ran_at timestamptz primary key default now(),
  row_count integer not null
);

alter table public.rforce_import_runs enable row level security;

comment on table public.rforce_import_runs is
  'One row per work-order import. Counts how many imports an order has been missing from.';
