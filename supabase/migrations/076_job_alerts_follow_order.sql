-- ============================================================
-- Migration 076: Job Alert notes follow the ORDER, not one work order
--
-- Kennen, 2026-11-20: when the office cancels a work order and makes a new
-- one for a later date, the notes must not disappear with the cancelled one.
-- Notes now belong to the sales order number + the kind of appointment
-- (Install, Service, Job Site Visit, Tech Measure):
--   * a cancelled install's notes show on the new install for that order;
--   * they keep riding along to later appointments of the same kind on that
--     order until someone deletes them;
--   * a different kind (a later service on the same order) does NOT get them.
-- If an order has two upcoming appointments of the same kind, the notes show
-- on both and the buzz goes out for the soonest (job-alerts-server.ts).
--
-- `work_order_id` stays as the appointment the note was written on.
-- `order_number` (already in 064) and the new `work_order_type` are filled in
-- HERE by the 071 trigger from the job itself -- the app can't pick them -- and
-- none of the three keys can change after the note is written.
-- Live data 2026-11-20: every Install/Service/Job Site Visit/Tech Measure work
-- order has an order number; 43 order+kind pairs already show the
-- cancel-and-recreate pattern.
--
-- Needs 064-066 + 071. Safe to re-run. Run in Supabase SQL Editor.
-- ============================================================

BEGIN;

alter table public.job_alerts
  add column if not exists work_order_type text;

comment on column public.job_alerts.work_order_type is
  'Kind of appointment the note belongs to (with order_number). Set by trigger from the job. Migration 076.';

-- Existing notes: take the order number and kind from their job.
update public.job_alerts a
   set order_number = w.order_number,
       work_order_type = w.work_order_type
  from public.work_orders w
 where w.id = a.work_order_id
   and (a.order_number is distinct from w.order_number
        or a.work_order_type is distinct from w.work_order_type);

create index if not exists idx_job_alerts_order_type
  on public.job_alerts (order_number, work_order_type);

-- ── The job decides the group, the order and the kind; none ever change ────
create or replace function public.job_alerts_set_audience()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wtype text;
  wnum  text;
begin
  if tg_op = 'UPDATE' then
    new.audience        := old.audience;
    new.work_order_id   := old.work_order_id;
    new.order_number    := old.order_number;
    new.work_order_type := old.work_order_type;
    return new;
  end if;
  select work_order_type, nullif(order_number, '')
    into wtype, wnum
    from public.work_orders where id = new.work_order_id;
  new.audience        := case when wtype = 'Tech Measure' then 'measure' else 'field' end;
  new.order_number    := wnum;
  new.work_order_type := wtype;
  return new;
end;
$$;

COMMIT;

-- Check: expect the column, the index, and every note filled in.
--   select column_name from information_schema.columns where table_name = 'job_alerts' and column_name = 'work_order_type';   -- 1 row
--   select indexname from pg_indexes where indexname = 'idx_job_alerts_order_type';                                          -- 1 row
--   select count(*) from job_alerts where order_number is null or work_order_type is null;                                   -- 0
