-- ============================================================
-- Migration 079: Job Site Visits -- payroll admins can read the history
--
-- Kennen, 2026-11-20: the Payroll Admin page gets a Site Visits tab with
-- every visit the measure techs logged (078). Payroll admins (and admins)
-- see it there, read-only. This widens READ only: logging, editing and
-- deleting stay with measure techs and admins exactly as 078 set them.
-- Payroll admins can also see which months the monthly email went out.
--
-- Needs 078. Safe to re-run. Run in Supabase SQL Editor.
-- ============================================================

BEGIN;

drop policy if exists "measure_read_site_visits" on public.job_site_visits;
create policy "measure_read_site_visits"
  on public.job_site_visits for select
  using (public.has_any_role(array['admin', 'measure-tech', 'payroll-admin']));

drop policy if exists "admin_read_site_visit_reports" on public.job_site_visit_reports;
create policy "admin_read_site_visit_reports"
  on public.job_site_visit_reports for select
  using (public.has_any_role(array['admin', 'payroll-admin']));

COMMIT;

-- Check: both policies now name payroll-admin.
--   select tablename, policyname, qual from pg_policies
--    where tablename in ('job_site_visits', 'job_site_visit_reports') and cmd = 'SELECT';
