-- ============================================================
-- Migration 021: server-maintained jobs.updated_at + v2 jobs_signature
--
-- The calendar caches the material-jobs map (every submitted job's data blob,
-- ~8 MB and growing) and now syncs it INCREMENTALLY: on boot it fetches only
-- the jobs changed since its last sync. That needs a change timestamp the
-- app can trust. data->>'savedAt' is written by the cut-list app from the
-- DEVICE clock, so a phone a few minutes behind can save a job that looks
-- older than the newest one already cached and be silently skipped.
--
-- This migration:
--   1. Adds a BEFORE INSERT OR UPDATE trigger that stamps jobs.updated_at with
--      the database clock on every write, regardless of what the client sent.
--   2. Backfills updated_at where it's null (the trigger sets now()).
--   3. Indexes updated_at for the "changed since" query.
--   4. Re-defines jobs_signature() (migration 012) to key off updated_at and
--      prefix the result with "v2:" so the app can tell old vs new format and
--      fall back to a full download until this is applied.
--        v2:<submitted count>:<max updated_at, ISO-8601 UTC, microseconds>
--
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
-- ============================================================

begin;

create or replace function public.jobs_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists trg_jobs_touch_updated_at on public.jobs;
create trigger trg_jobs_touch_updated_at
  before insert or update on public.jobs
  for each row execute function public.jobs_touch_updated_at();

update public.jobs set updated_at = now() where updated_at is null;

create index if not exists idx_jobs_updated_at on public.jobs (updated_at);

create or replace function public.jobs_signature()
returns text
language sql
stable
security invoker
as $$
  select 'v2:' || count(*)::text || ':'
    || coalesce(to_char(max(updated_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '')
  from public.jobs
  where data->>'submitted' = 'true';
$$;

commit;

-- Verify (run separately):
-- select public.jobs_signature();
-- select tgname from pg_trigger where tgrelid = 'public.jobs'::regclass and not tgisinternal;
