-- ============================================================
-- Migration 078: Job Site Visits -- the measure tech's visit log
--
-- Kennen, 2026-11-20: measure techs log every trip out to a job site, with
-- notes. They log it from the Submissions tab (pick any job) or from the
-- "Log Job Site Visit" button on a job's tile, and see the visits already
-- logged on that job right there.
--
-- On the 1st of every month the daily cron emails ALL of last month's visits
-- to the addresses typed in the NWO Hub (Duck Force settings ->
-- hub_app_settings app "calendar", key "site_visit_recipients": [emails]).
-- job_site_visit_reports records each month that went out so the email is
-- never sent twice.
--
-- Who may do what:
--   read    measure techs + admins (every visit, so a tile shows the job's
--           whole history)
--   insert  measure techs + admins, as themselves
--   update  the tech who logged it, or an admin
--   delete  the tech who logged it, or an admin
--
-- Needs 019 (has_any_role). Safe to re-run. Run in Supabase SQL Editor.
-- ============================================================

BEGIN;

create table if not exists public.job_site_visits (
  id                uuid primary key default gen_random_uuid(),
  -- The job, copied at log time so the visit still reads right after rForce
  -- changes or drops the appointment.
  order_number      text not null,
  work_order_id     text,
  work_order_number text,
  job_name          text not null default '',
  address           text,
  visit_date        date not null default current_date,
  notes             text not null,
  created_by        text not null default lower(auth.jwt() ->> 'email'),
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_job_site_visits_order on public.job_site_visits (order_number);
create index if not exists idx_job_site_visits_date  on public.job_site_visits (visit_date);

comment on table public.job_site_visits is
  'Measure tech job site visits with notes; emailed monthly (1st of the month, last month''s visits) by the daily cron. Migration 078.';

-- The writer is always the login, and never changes afterwards.
create or replace function public.job_site_visits_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Server routes (service role) and the SQL editor carry no login.
  if auth.jwt() is null then
    new.updated_at := now();
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := lower(auth.jwt() ->> 'email');
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists job_site_visits_guard on public.job_site_visits;
create trigger job_site_visits_guard
  before insert or update on public.job_site_visits
  for each row execute function public.job_site_visits_guard();

alter table public.job_site_visits enable row level security;
revoke all on public.job_site_visits from anon, authenticated;
grant select, insert, update, delete on public.job_site_visits to authenticated;

drop policy if exists "measure_read_site_visits" on public.job_site_visits;
create policy "measure_read_site_visits"
  on public.job_site_visits for select
  using (public.has_any_role(array['admin', 'measure-tech']));

drop policy if exists "measure_insert_site_visits" on public.job_site_visits;
create policy "measure_insert_site_visits"
  on public.job_site_visits for insert
  with check (
    public.has_any_role(array['admin', 'measure-tech'])
    and lower(created_by) = lower(auth.jwt() ->> 'email')
  );

drop policy if exists "measure_update_site_visits" on public.job_site_visits;
create policy "measure_update_site_visits"
  on public.job_site_visits for update
  using (
    public.has_any_role(array['admin'])
    or (public.has_any_role(array['measure-tech']) and lower(created_by) = lower(auth.jwt() ->> 'email'))
  )
  with check (
    public.has_any_role(array['admin'])
    or (public.has_any_role(array['measure-tech']) and lower(created_by) = lower(auth.jwt() ->> 'email'))
  );

drop policy if exists "measure_delete_site_visits" on public.job_site_visits;
create policy "measure_delete_site_visits"
  on public.job_site_visits for delete
  using (
    public.has_any_role(array['admin'])
    or (public.has_any_role(array['measure-tech']) and lower(created_by) = lower(auth.jwt() ->> 'email'))
  );

-- ── Monthly email ledger (server only) ──────────────────────
-- One row per month emailed ('2026-11'). Only the server's service-role key
-- writes it; admins can read it to see when each month went out.
create table if not exists public.job_site_visit_reports (
  month        text primary key check (month ~ '^\d{4}-\d{2}$'),
  sent_at      timestamptz not null default now(),
  recipients   text[] not null default '{}',
  visit_count  integer not null default 0
);

alter table public.job_site_visit_reports enable row level security;
revoke all on public.job_site_visit_reports from anon, authenticated;
grant select on public.job_site_visit_reports to authenticated;

drop policy if exists "admin_read_site_visit_reports" on public.job_site_visit_reports;
create policy "admin_read_site_visit_reports"
  on public.job_site_visit_reports for select
  using (public.has_any_role(array['admin']));

COMMIT;

-- Check: expect true / 4, and true / 1.
--   select rowsecurity from pg_tables where tablename = 'job_site_visits';
--   select count(*) from pg_policies where tablename = 'job_site_visits';          -- 4
--   select rowsecurity from pg_tables where tablename = 'job_site_visit_reports';
--   select count(*) from pg_policies where tablename = 'job_site_visit_reports';   -- 1
