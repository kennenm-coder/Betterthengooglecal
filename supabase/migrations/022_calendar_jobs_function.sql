-- ============================================================
-- Migration 022: calendar_jobs() — the jobs feed without originalImport
--
-- Measured on the live DB (2026-09-23): the jobs table is ~8 MB on disk
-- (compressed), but serialized as JSON it is ~45 MB, and 39 MB of that is a
-- single key, data->job->originalImport (the raw rForce import kept on each
-- job). The calendar never reads it. Selecting `id, data` made PostgREST
-- serialize all 45 MB, which blew through the authenticated role's 8 s
-- statement_timeout (error 57014) on almost every boot — so linked-job
-- badges rarely appeared and the DB burned 8 s of CPU per attempt.
--
-- This function returns every job with that one key removed (~6 MB total),
-- optionally only those written since a timestamp (incremental sync, see
-- migration 021). SECURITY INVOKER, so the caller's RLS on jobs still
-- applies. The app pages through it with order/limit/offset.
--
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
-- ============================================================

create or replace function public.calendar_jobs(since timestamptz default null)
returns table (id text, updated_at timestamptz, data jsonb)
language sql
stable
security invoker
set search_path = public
as $$
  select j.id, j.updated_at, (j.data #- '{job,originalImport}') as data
  from public.jobs j
  where since is null or j.updated_at >= since
  order by j.id;
$$;

grant execute on function public.calendar_jobs(timestamptz) to authenticated;

-- Verify (run separately):
-- select count(*), pg_size_pretty(sum(pg_column_size(data::text))) from public.calendar_jobs();
