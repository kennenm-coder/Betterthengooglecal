-- ============================================================
-- Migration 012: Cheap "did any linked job change?" fingerprint
--
-- The app periodically checks whether any submitted material job changed, so it
-- can show the "data changed — refresh" banner. The old check pulled one row per
-- job (id + savedAt) and built a fingerprint client-side — a full list every
-- time, just to see if anything moved.
--
-- This function returns a TINY scalar instead: "<count>:<newest savedAt>".
--   * A job added   → count changes.
--   * A job deleted → count changes.
--   * A job edited  → savedAt is set to "now", so the newest savedAt changes.
-- Comparing that one string detects any add/edit/delete with near-zero egress.
--
-- SECURITY INVOKER (the default) means the aggregate runs under the caller's
-- row-level security: allowlisted users see the real numbers; anyone else sees
-- 0 rows (empty fingerprint), exactly like the old behavior.
--
-- Run in Supabase SQL Editor.
-- ============================================================

create or replace function public.jobs_signature()
returns text
language sql
stable
security invoker
as $$
  select coalesce(count(*)::text, '0') || ':' || coalesce(max(data->>'savedAt'), '')
  from public.jobs
  where data->>'submitted' = 'true';
$$;

-- Let logged-in (and anon, harmlessly) clients call it; RLS still gates the data.
grant execute on function public.jobs_signature() to authenticated, anon;
