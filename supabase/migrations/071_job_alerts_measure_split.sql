-- ============================================================
-- Migration 071: Job Alert -- measure appointments get their own group
--
-- Kennen, 2026-11-20: Job Alert is split in two.
--   * 'field'   -- every job EXCEPT Tech Measure. Field managers + admins
--                  read and write the notes and get the buzzes (as before).
--   * 'measure' -- Tech Measure appointments. Measure techs + admins read and
--                  write the notes and get the buzzes; field managers no longer
--                  see them.
-- Same feature, same timing, separate audiences.
--
-- `audience` is decided HERE, from the job itself (work_orders.work_order_type),
-- by a trigger on insert -- the app never gets to say which group a note is in,
-- so nobody can file a note into the wrong one. It can't be changed afterwards.
-- Notes already written on Tech Measure jobs are moved into 'measure'.
--
-- Policies keep their 064 names; each now also requires the right role for the
-- note's audience. Admins hold both groups.
--
-- Needs 064-066. Safe to re-run. Run in Supabase SQL Editor.
-- ============================================================

BEGIN;

alter table public.job_alerts
  add column if not exists audience text not null default 'field';

alter table public.job_alerts drop constraint if exists job_alerts_audience_check;
alter table public.job_alerts
  add constraint job_alerts_audience_check check (audience in ('field', 'measure'));

comment on column public.job_alerts.audience is
  'field = every job but Tech Measure (field managers + admins); measure = Tech Measure (measure techs + admins). Set by trigger from the job. Migration 071.';

-- Notes already sitting on Tech Measure jobs belong to the measure group.
update public.job_alerts a
   set audience = 'measure'
  from public.work_orders w
 where w.id = a.work_order_id
   and w.work_order_type = 'Tech Measure'
   and a.audience <> 'measure';

-- ── The job decides the group, and it never changes ─────────────────────────
create or replace function public.job_alerts_set_audience()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wtype text;
begin
  if tg_op = 'UPDATE' then
    new.audience := old.audience;
    return new;
  end if;
  select work_order_type into wtype from public.work_orders where id = new.work_order_id;
  new.audience := case when wtype = 'Tech Measure' then 'measure' else 'field' end;
  return new;
end;
$$;

drop trigger if exists job_alerts_set_audience on public.job_alerts;
create trigger job_alerts_set_audience
  before insert or update on public.job_alerts
  for each row execute function public.job_alerts_set_audience();

-- ── Who may touch which group ───────────────────────────────────────────────
drop policy if exists "fieldmgr_read_job_alerts" on public.job_alerts;
create policy "fieldmgr_read_job_alerts"
  on public.job_alerts for select
  using (
    (audience = 'field'   and public.has_any_role(array['admin', 'field-manager']))
    or (audience = 'measure' and public.has_any_role(array['admin', 'measure-tech']))
  );

drop policy if exists "fieldmgr_insert_own_job_alerts" on public.job_alerts;
create policy "fieldmgr_insert_own_job_alerts"
  on public.job_alerts for insert
  with check (
    lower(created_by) = lower(auth.jwt() ->> 'email')
    and (
      (audience = 'field'   and public.has_any_role(array['admin', 'field-manager']))
      or (audience = 'measure' and public.has_any_role(array['admin', 'measure-tech']))
    )
  );

drop policy if exists "fieldmgr_update_own_job_alerts" on public.job_alerts;
create policy "fieldmgr_update_own_job_alerts"
  on public.job_alerts for update
  using (
    lower(created_by) = lower(auth.jwt() ->> 'email')
    and (
      (audience = 'field'   and public.has_any_role(array['admin', 'field-manager']))
      or (audience = 'measure' and public.has_any_role(array['admin', 'measure-tech']))
    )
  )
  with check (
    lower(created_by) = lower(auth.jwt() ->> 'email')
    and (
      (audience = 'field'   and public.has_any_role(array['admin', 'field-manager']))
      or (audience = 'measure' and public.has_any_role(array['admin', 'measure-tech']))
    )
  );

drop policy if exists "fieldmgr_delete_own_job_alerts" on public.job_alerts;
create policy "fieldmgr_delete_own_job_alerts"
  on public.job_alerts for delete
  using (
    lower(created_by) = lower(auth.jwt() ->> 'email')
    and (
      (audience = 'field'   and public.has_any_role(array['admin', 'field-manager']))
      or (audience = 'measure' and public.has_any_role(array['admin', 'measure-tech']))
    )
  );

COMMIT;

-- Check: expect the column, the trigger, and 'measure-tech' in the read policy.
--   select column_name from information_schema.columns where table_name = 'job_alerts' and column_name = 'audience';
--   select tgname from pg_trigger where tgname = 'job_alerts_set_audience';
--   select count(*) from pg_policies where tablename = 'job_alerts' and qual like '%measure-tech%';   -- 3 (read, update, delete)
