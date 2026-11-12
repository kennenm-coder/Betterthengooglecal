-- ============================================================
-- Migration 053: Is a write-up JIP or Service work?
--
-- Decided once, by the calendar, and stored on the write-up so the other
-- apps read the answer instead of re-deriving it. First reader: the paint &
-- stain shop's Work Tracker in the material-list maker, which ticks its
-- "JIP / Service" box for a trim order opened from a write-up.
--
-- The rule (src/lib/writeup-kind.ts, pinned by
-- scripts/checks/writeup-kind.check.ts):
--   * the job's install date is its Install work order's last scheduled day;
--   * the FIRST write-up on the job more than 30 days after that = Service,
--     and so is every later one;
--   * otherwise every write-up is JIP until the job reaches closed (the
--     import's Job Closed, migration 052), and Service after.
--
--   writeup_kind         'jip' | 'service'; null = not decided yet (drafts,
--                        or no install date on file — the import retries).
--   writeup_kind_detail  why: { rule, installDay, firstWriteUpDay,
--                        daysAfterInstall, jobClosedDay }.
--   writeup_kind_at      when it was stamped.
--
-- Written by the server only (hourly import + POST /api/writeups/kind, both
-- service role), and never changed once set. Every unit row of one
-- submission (batch_id) carries the same answer.
--
-- Run in Supabase SQL Editor. The next import stamps every existing
-- write-up.
-- ============================================================

alter table public.field_work_orders
  add column if not exists writeup_kind text;

alter table public.field_work_orders
  add column if not exists writeup_kind_detail jsonb;

alter table public.field_work_orders
  add column if not exists writeup_kind_at timestamptz;

alter table public.field_work_orders
  drop constraint if exists field_work_orders_writeup_kind_check;
alter table public.field_work_orders
  add constraint field_work_orders_writeup_kind_check
  check (writeup_kind is null or writeup_kind in ('jip', 'service'));

-- The import reads "write-ups still without an answer" on every run.
create index if not exists idx_fwo_writeup_kind_pending
  on public.field_work_orders (order_number)
  where writeup_kind is null;

comment on column public.field_work_orders.writeup_kind is
  'JIP or Service, decided by the calendar (src/lib/writeup-kind.ts). Null = not decided yet. Never changed once set.';
comment on column public.field_work_orders.writeup_kind_detail is
  'Why: rule, install day, first write-up day, days after install, job closed day.';
