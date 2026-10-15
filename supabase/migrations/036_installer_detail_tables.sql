-- ============================================================
-- Migration 036: the other three doors into job detail
--
-- 035 trims the calendar feed, but the calendar is not the only way
-- to reach a job. The product specs live in `jobs`, the install
-- instructions in `install_docs`, and the old install PDFs behind
-- `legacy_install_links`. Each is readable today by any allowlisted
-- account, so without this an installer simply opens another table
-- and reads what 035 just blanked.
--
-- Each is keyed by order number, so each gets the same rule: an
-- installer may read a row only when that order is one of theirs.
--
-- `jobs` also carries a write hole worth naming: its one policy is
-- FOR ALL, so every allowlisted account can edit or delete any job.
-- That predates this work and is not an installer problem, but the
-- rewrite below is the moment to stop it spreading to a role that
-- has no business writing there at all. Existing writers (member
-- signatures, the cut-list, the auditor) are unchanged.
--
-- 033 and 035 must be applied first.
--
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
-- ============================================================

BEGIN;

-- ── Is this order number one of mine? ────────────────────────
-- The three tables below hold no crew information of their own —
-- they hang off a work order — so ownership is answered by looking
-- the order up in work_orders.
--
-- SECURITY DEFINER because an installer cannot read work_orders
-- directly any more (035). It leaks nothing: it answers yes or no
-- about an order number the caller already named.
--
-- The CTE pins my_crew_names() to one evaluation per call rather
-- than one per candidate row.

CREATE OR REPLACE FUNCTION public.order_is_mine(p_order_number text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS MATERIALIZED (SELECT public.my_crew_names() AS names)
  SELECT COALESCE(p_order_number, '') <> ''
     AND EXISTS (
       SELECT 1
       FROM public.work_orders w, me
       WHERE w.order_number = p_order_number
         AND public.wo_is_mine(w.installer, w.primary_resource,
                               w.service_rep, w.day_crews, me.names)
     );
$$;

COMMENT ON FUNCTION public.order_is_mine(text) IS
  'True when the named order number belongs to one of the calling installer''s '
  'crews. Used to gate jobs / install_docs / legacy_install_links, none of '
  'which carry crew information themselves.';

REVOKE ALL ON FUNCTION public.order_is_mine(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.order_is_mine(text) TO authenticated;

-- ── jobs — product specs (material-list app) ─────────────────
-- Everyone who could read and write before still can. Installers
-- are carved out of that policy and given read-only access to their
-- own jobs instead, so they never gain a write path here.
--
-- calendar_jobs() is SECURITY INVOKER, so the incremental jobs feed
-- the calendar uses picks this up with no change of its own.

DROP POLICY IF EXISTS "allowlisted_access_jobs" ON public.jobs;
CREATE POLICY "allowlisted_access_jobs"
  ON public.jobs
  FOR ALL
  USING (public.get_user_role() IS NOT NULL AND NOT public.is_installer())
  WITH CHECK (public.get_user_role() IS NOT NULL AND NOT public.is_installer());

DROP POLICY IF EXISTS "installers_read_own_jobs" ON public.jobs;
CREATE POLICY "installers_read_own_jobs"
  ON public.jobs
  FOR SELECT
  USING (
    public.is_installer()
    AND public.order_is_mine(data -> 'job' ->> 'poNumber')
  );

-- ── install_docs — install instructions ──────────────────────

DROP POLICY IF EXISTS "allowlisted_read_install_docs" ON public.install_docs;
CREATE POLICY "allowlisted_read_install_docs"
  ON public.install_docs
  FOR SELECT
  USING (public.is_allowlisted() AND NOT public.is_installer());

DROP POLICY IF EXISTS "installers_read_own_install_docs" ON public.install_docs;
CREATE POLICY "installers_read_own_install_docs"
  ON public.install_docs
  FOR SELECT
  USING (public.is_installer() AND public.order_is_mine(order_number));

-- ── legacy_install_links — Drive links to the old PDFs ───────

DROP POLICY IF EXISTS "allowlisted_read_legacy_links" ON public.legacy_install_links;
CREATE POLICY "allowlisted_read_legacy_links"
  ON public.legacy_install_links
  FOR SELECT
  USING (public.get_user_role() IS NOT NULL AND NOT public.is_installer());

DROP POLICY IF EXISTS "installers_read_own_legacy_links" ON public.legacy_install_links;
CREATE POLICY "installers_read_own_legacy_links"
  ON public.legacy_install_links
  FOR SELECT
  USING (public.is_installer() AND public.order_is_mine(order_number));

COMMIT;

-- Verify (run separately, signed in as a test installer):
--   select count(*) from public.jobs;                   -- only their own
--   select count(*) from public.install_docs;           -- only their own
--   select count(*) from public.legacy_install_links;   -- only their own
--   insert into public.jobs (id, data) values ('x', '{}'::jsonb);  -- must fail
--
-- And as an admin, confirm nothing moved:
--   select count(*) from public.jobs;
