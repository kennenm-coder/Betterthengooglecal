-- ============================================================
-- 048 - More for More: paper sheets + excluded jobs
--
-- Payroll's new Jobs view lists every install and whether a More for
-- More is in for it. Two things come with it:
--
--   PAPER. Some leads still hand in the paper sheet. Payroll ticks
--     "On paper" for the job (more_for_more_jobs.paper) and can type
--     the sheet in themselves. A sheet payroll types in is flagged
--     more_for_more.on_paper. To allow that, payroll-admin may now
--     INSERT sheets (045 allowed only installer-lead and admin).
--
--   EXCLUDE (admin only, temporary). Jobs from before More for More
--     moved into the app need no sheet. An admin can exclude a job,
--     or every job shown at once. Excluded jobs drop out of the Jobs
--     view and the leads' lists. Expected to go once the process is
--     established; the column can simply stop being used.
--
-- more_for_more_jobs holds one row per job that has been flagged,
-- keyed by order number. No row = not on paper, not excluded.
--
-- Run in Supabase SQL Editor. Idempotent -- safe to re-run.
-- 045 and 046 must be applied first.
-- ============================================================

BEGIN;

-- ── 1. Sheets payroll typed in from paper ────────────────────

ALTER TABLE public.more_for_more
  ADD COLUMN IF NOT EXISTS on_paper boolean NOT NULL DEFAULT false;

DROP POLICY IF EXISTS "mfm_insert" ON public.more_for_more;
CREATE POLICY "mfm_insert" ON public.more_for_more FOR INSERT
  WITH CHECK (public.has_any_role(ARRAY['installer-lead', 'admin', 'payroll-admin']));

-- 046's guard, plus: only payroll can set on_paper.
CREATE OR REPLACE FUNCTION public.mfm_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  office boolean := public.has_any_role(ARRAY['admin', 'payroll-admin']);
  me     text    := lower(auth.jwt() ->> 'email');
  ack    timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by   := me;
    NEW.created_at   := now();
    NEW.submitted_at := now();
    NEW.lead_ack_at  := NULL;
    IF NOT office THEN
      IF NEW.status IS DISTINCT FROM 'draft' THEN NEW.status := 'submitted'; END IF;
      NEW.office_data       := '{}'::jsonb;
      NEW.final_total       := NULL;
      NEW.completed_at      := NULL;
      NEW.completed_by      := NULL;
      NEW.completed_by_name := NULL;
      NEW.reject_reason     := NULL;
      NEW.rejected_at       := NULL;
      NEW.rejected_by       := NULL;
      NEW.rejected_by_name  := NULL;
      NEW.on_paper          := false;
    END IF;
    NEW.submit_count := CASE WHEN NEW.status = 'draft' THEN 0 ELSE 1 END;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- UPDATE
  IF office THEN
    NEW.created_by   := OLD.created_by;
    NEW.created_at   := OLD.created_at;
    NEW.submitted_at := OLD.submitted_at;
    NEW.submit_count := OLD.submit_count;
    IF NEW.status = 'rejected' THEN
      IF coalesce(btrim(NEW.reject_reason), '') = '' THEN
        RAISE EXCEPTION 'A reason is required to send a More for More back.';
      END IF;
      IF OLD.status IS DISTINCT FROM 'rejected' THEN
        NEW.rejected_at := now();
        NEW.rejected_by := me;
      END IF;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- The lead only dismissing a notice: nothing else may change.
  IF NEW.lead_data IS NOT DISTINCT FROM OLD.lead_data
     AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    ack := NEW.lead_ack_at;
    NEW := OLD;
    NEW.lead_ack_at := ack;
    RETURN NEW;
  END IF;

  -- The lead saving progress or (re)submitting.
  IF NEW.status IS DISTINCT FROM 'draft' THEN NEW.status := 'submitted'; END IF;
  NEW.created_by        := OLD.created_by;
  NEW.created_at        := OLD.created_at;
  NEW.office_data       := OLD.office_data;
  NEW.final_total       := OLD.final_total;
  NEW.completed_at      := NULL;
  NEW.completed_by      := OLD.completed_by;
  NEW.completed_by_name := OLD.completed_by_name;
  NEW.reject_reason     := OLD.reject_reason;
  NEW.rejected_at       := OLD.rejected_at;
  NEW.rejected_by       := OLD.rejected_by;
  NEW.rejected_by_name  := OLD.rejected_by_name;
  NEW.lead_ack_at       := OLD.lead_ack_at;
  NEW.on_paper          := OLD.on_paper;
  IF NEW.status = 'submitted' THEN
    NEW.submitted_at := now();
    NEW.submit_count := OLD.submit_count + 1;
  ELSE
    NEW.submitted_at := OLD.submitted_at;
    NEW.submit_count := OLD.submit_count;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mfm_guard() FROM public, anon;

-- ── 2. Per-job flags ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.more_for_more_jobs (
  order_number text PRIMARY KEY,
  paper        boolean NOT NULL DEFAULT false,
  paper_at     timestamptz,
  paper_by     text,
  excluded     boolean NOT NULL DEFAULT false,
  excluded_at  timestamptz,
  excluded_by  text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Payroll may tick "on paper"; only an admin may exclude or un-exclude.
CREATE OR REPLACE FUNCTION public.mfm_jobs_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  is_admin boolean := public.has_any_role(ARRAY['admin']);
  me       text    := lower(auth.jwt() ->> 'email');
BEGIN
  IF NOT is_admin THEN
    IF TG_OP = 'INSERT' THEN
      NEW.excluded := false; NEW.excluded_at := NULL; NEW.excluded_by := NULL;
    ELSE
      NEW.excluded := OLD.excluded; NEW.excluded_at := OLD.excluded_at; NEW.excluded_by := OLD.excluded_by;
    END IF;
  ELSIF TG_OP = 'INSERT' OR NEW.excluded IS DISTINCT FROM OLD.excluded THEN
    NEW.excluded_at := CASE WHEN NEW.excluded THEN now() END;
    NEW.excluded_by := CASE WHEN NEW.excluded THEN me END;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.paper IS DISTINCT FROM OLD.paper THEN
    NEW.paper_at := CASE WHEN NEW.paper THEN now() END;
    NEW.paper_by := CASE WHEN NEW.paper THEN me END;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mfm_jobs_guard ON public.more_for_more_jobs;
CREATE TRIGGER trg_mfm_jobs_guard
  BEFORE INSERT OR UPDATE ON public.more_for_more_jobs
  FOR EACH ROW EXECUTE FUNCTION public.mfm_jobs_guard();

REVOKE ALL ON FUNCTION public.mfm_jobs_guard() FROM public, anon;

ALTER TABLE public.more_for_more_jobs ENABLE ROW LEVEL SECURITY;

-- Leads read these too: their list hides excluded jobs and marks paper ones.
DROP POLICY IF EXISTS "mfm_jobs_read"   ON public.more_for_more_jobs;
DROP POLICY IF EXISTS "mfm_jobs_insert" ON public.more_for_more_jobs;
DROP POLICY IF EXISTS "mfm_jobs_update" ON public.more_for_more_jobs;
CREATE POLICY "mfm_jobs_read" ON public.more_for_more_jobs FOR SELECT
  USING (public.is_allowlisted());
CREATE POLICY "mfm_jobs_insert" ON public.more_for_more_jobs FOR INSERT
  WITH CHECK (public.has_any_role(ARRAY['admin', 'payroll-admin']));
CREATE POLICY "mfm_jobs_update" ON public.more_for_more_jobs FOR UPDATE
  USING (public.has_any_role(ARRAY['admin', 'payroll-admin']))
  WITH CHECK (public.has_any_role(ARRAY['admin', 'payroll-admin']));

-- New tables get no Data API access automatically after 2026-10-30
-- (see 024). The policies above are the real gate; anon has none.
GRANT SELECT, INSERT, UPDATE ON public.more_for_more_jobs TO authenticated, service_role;
REVOKE ALL ON public.more_for_more_jobs FROM anon;

COMMIT;

-- Verify (run separately):
--   select column_name from information_schema.columns
--    where table_name = 'more_for_more' and column_name = 'on_paper';
--   select polname from pg_policy where polrelid = 'public.more_for_more_jobs'::regclass;
