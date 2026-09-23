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
-- This function returns jobs with that one key removed (~4.6 MB total for
-- ~300 jobs, <1 s), in KEYSET pages so each request only touches the rows
-- it returns (offset paging through a set-returning function would re-run
-- the whole function per page):
--   since      → only rows written at/after this timestamp (incremental
--                sync, see migration 021); null = all
--   after_id   → rows with id > after_id (pass the last id of the previous
--                page); null = from the start
--   page_limit → rows per page
-- SECURITY INVOKER, so the caller's RLS on jobs still applies.
--
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
-- ============================================================

-- Earlier draft of this migration had a single-argument signature.
drop function if exists public.calendar_jobs(timestamptz);

create or replace function public.calendar_jobs(
  since timestamptz default null,
  after_id text default null,
  page_limit int default 100
)
returns table (id text, updated_at timestamptz, data jsonb)
language sql
stable
security invoker
set search_path = public
as $$
  select j.id, j.updated_at, (j.data #- '{job,originalImport}') as data
  from public.jobs j
  where (since is null or j.updated_at >= since)
    and (after_id is null or j.id > after_id)
  order by j.id
  limit greatest(1, least(page_limit, 500));
$$;

grant execute on function public.calendar_jobs(timestamptz, text, int) to authenticated;

-- Verify (run separately):
-- select count(*), pg_size_pretty(sum(length(data::text))) from public.calendar_jobs(null, null, 500);
