-- ============================================================
-- Migration 064: Job Alert -- a field manager's reminder note on a job
--
-- A field manager (or admin) types a note in the "Job Alert" box above Install
-- Notes on a job card. Five workdays before that appointment (Saturday and
-- Sunday skipped -- a Monday job is reminded the Monday before), the daily cron
-- (/api/cron/daily -> src/lib/job-alerts-server.ts) emails the note to whoever
-- wrote it, and buzzes / bells them through the notification channel (063).
--
-- One note per person per appointment (work order). Every field manager can
-- SEE everyone's notes on a job; only the writer can change or delete theirs.
-- The appointment date is read fresh each morning from work_orders, so a
-- rescheduled job's reminder moves with it; sent_for_date records which date
-- a reminder already went out for, so a job moved after sending is reminded
-- again for its new date.
--
-- Needs 019 (has_any_role). Safe to re-run. Run in Supabase SQL Editor.
-- ============================================================

BEGIN;

create table if not exists public.job_alerts (
  id              uuid primary key default gen_random_uuid(),
  -- work_orders.id = rForce's Work Order Number: one appointment, stable
  -- across imports and reschedules.
  work_order_id   text not null,
  order_number    text,
  note            text not null,
  created_by      text not null,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  sent_at         timestamptz,
  sent_for_date   date,
  send_error      text,
  unique (work_order_id, created_by)
);

create index if not exists idx_job_alerts_work_order on public.job_alerts (work_order_id);

comment on table public.job_alerts is
  'Field-manager Job Alert notes; emailed to the writer 5 workdays before the appointment by the daily cron. Migration 064.';

alter table public.job_alerts enable row level security;
revoke all on public.job_alerts from anon, authenticated;
grant select, insert, update, delete on public.job_alerts to authenticated;

drop policy if exists "fieldmgr_read_job_alerts" on public.job_alerts;
create policy "fieldmgr_read_job_alerts"
  on public.job_alerts for select
  using (public.has_any_role(array['admin', 'field-manager']));

drop policy if exists "fieldmgr_insert_own_job_alerts" on public.job_alerts;
create policy "fieldmgr_insert_own_job_alerts"
  on public.job_alerts for insert
  with check (
    public.has_any_role(array['admin', 'field-manager'])
    and lower(created_by) = lower(auth.jwt() ->> 'email')
  );

drop policy if exists "fieldmgr_update_own_job_alerts" on public.job_alerts;
create policy "fieldmgr_update_own_job_alerts"
  on public.job_alerts for update
  using (
    public.has_any_role(array['admin', 'field-manager'])
    and lower(created_by) = lower(auth.jwt() ->> 'email')
  )
  with check (
    public.has_any_role(array['admin', 'field-manager'])
    and lower(created_by) = lower(auth.jwt() ->> 'email')
  );

drop policy if exists "fieldmgr_delete_own_job_alerts" on public.job_alerts;
create policy "fieldmgr_delete_own_job_alerts"
  on public.job_alerts for delete
  using (
    public.has_any_role(array['admin', 'field-manager'])
    and lower(created_by) = lower(auth.jwt() ->> 'email')
  );

COMMIT;

-- Check: expect rowsecurity = true and 4 policies.
--   select rowsecurity from pg_tables where tablename = 'job_alerts';
--   select count(*) from pg_policies where tablename = 'job_alerts';   -- 4
