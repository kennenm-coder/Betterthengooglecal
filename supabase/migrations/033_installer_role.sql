-- ============================================================
-- Migration 033: Installer role — the login → crew link
--
-- An installer sees their own crew's jobs in full and everything
-- else trimmed (035). Both halves need one thing first: a way to
-- answer "which crew is this login, and who is their lead".
--
-- The roster already exists. RBANWO-Scheduling keeps sched_crews,
-- where a helper is typed 'second' and carries primary_crew_id
-- pointing at the lead they ride with, maintained by schedulers in
-- the Resources screen. This migration links a login to a row in
-- that table rather than keeping a second copy here that drifts.
--
-- 019 locked every sched_* table to the scheduling roles, so an
-- installer cannot read sched_crews to work this out themselves.
-- my_crew_names() is SECURITY DEFINER for that reason — same shape
-- as sched_free_install_leads() in 026: the definer right answers
-- one narrow question and nothing more. It returns only the
-- caller's OWN names, never the roster.
--
-- Nothing here changes anyone's access. The column is nullable and
-- unused until 035, and both functions are inert until a policy or
-- the app calls them. Safe to apply ahead of the rest.
--
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
-- ============================================================

BEGIN;

-- ── 1. The link ──────────────────────────────────────────────
-- An id, not a name: renaming a crew in the scheduling app must not
-- orphan the login. ON DELETE SET NULL so deleting a resource leaves
-- the account standing but unassigned — which fails closed (the app
-- shows "ask an admin to finish setting up your account"), rather
-- than failing open to the whole board.

ALTER TABLE public.allowed_emails
  ADD COLUMN IF NOT EXISTS sched_crew_id uuid
    REFERENCES public.sched_crews(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.allowed_emails.sched_crew_id IS
  'Which RBANWO-Scheduling resource (sched_crews) this login is. Required for '
  'the installer role; ignored for every other role. Set by admins on the '
  'calendar Team page.';

-- ── 2. Who is restricted ─────────────────────────────────────
-- Fail closed: holding `installer` restricts you, even alongside
-- another role. Roles normally stack — the union of every role's
-- yeses — so the usual rule would let `installer` + `member` read
-- everything and quietly undo 035. This one inverts that.
--
-- `admin` is the single exception, so an admin who tags themselves
-- as a crew to test the role can never lock themselves out.
--
-- The Team page refuses to save `installer` next to anything else,
-- so these combinations should not exist. This is the backstop for
-- when one does.

CREATE OR REPLACE FUNCTION public.is_installer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.allowed_emails
    WHERE email = lower(auth.jwt() ->> 'email')
      AND (roles && ARRAY['installer'] OR role = 'installer')
      AND NOT (roles && ARRAY['admin'] OR role = 'admin')
  );
$$;

COMMENT ON FUNCTION public.is_installer() IS
  'True when the caller holds the installer role and is not an admin. Unlike '
  'has_any_role(), holding another role alongside it does NOT lift the '
  'restriction — installer is subtractive, not additive.';

-- ── 3. The caller's own crew names ───────────────────────────
-- Their name and their lead's, plus the aliases of both.
--
-- Aliases matter: work_orders.installer is free text straight from
-- rForce and may read "Tim" where sched_crews says "Tim Fitzpatrick".
-- sched_crews.aliases exists for exactly this, and skipping it would
-- hide a crew's own jobs from them.
--
-- A lead has no primary_crew_id, so they match on themselves alone.
-- An unassigned login gets an empty array, which matches no job.

CREATE OR REPLACE FUNCTION public.my_crew_names()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(DISTINCT n) FILTER (WHERE n IS NOT NULL AND n <> ''), '{}')
  FROM (
    SELECT unnest(ARRAY[c.name] || COALESCE(c.aliases, '{}')) AS n
    FROM public.allowed_emails ae
    JOIN public.sched_crews c ON c.id = ae.sched_crew_id
    WHERE ae.email = lower(auth.jwt() ->> 'email')
    UNION ALL
    SELECT unnest(ARRAY[lead.name] || COALESCE(lead.aliases, '{}'))
    FROM public.allowed_emails ae
    JOIN public.sched_crews c    ON c.id = ae.sched_crew_id
    JOIN public.sched_crews lead ON lead.id = c.primary_crew_id
    WHERE ae.email = lower(auth.jwt() ->> 'email')
  ) s;
$$;

COMMENT ON FUNCTION public.my_crew_names() IS
  'Crew names whose jobs belong to the caller: their own resource and their '
  'install lead, including both rosters aliases. Empty when the login has no '
  'resource assigned, which matches no job (fail closed).';

REVOKE ALL ON FUNCTION public.is_installer() FROM public, anon;
REVOKE ALL ON FUNCTION public.my_crew_names() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_installer() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_crew_names() TO authenticated;

COMMIT;

-- Verify (run separately, signed in as an installer):
--   select public.is_installer(), public.my_crew_names();
-- Expect: true, and {their name, their lead's name, any aliases}.
