-- ============================================================
-- 058 - Job Complete: the install lead's "this job is done" report
--
-- When an install finishes, the install lead (installer-lead, or an admin
-- testing) submits a Job Complete report from the install tile:
--
--   1. Picks one of three outcomes:
--        complete          -> finished (collected / signed / etc. are
--                             questions on the form; a "no" flags it)
--        complete_issues   -> finished, but found problems
--        not_complete      -> not finished
--   2. Answers that outcome's questions (the office writes them; they are
--      built into the app and can be overridden from the NWO Hub) and
--      adds photos.
--   3. The tile on the calendar gets a tag, the right people are emailed,
--      and anything flagged lands on the Write-Ups page for the office to
--      mark reviewed.
--
-- Separate from More for More (045+): that is the pay sheet; this is the
-- job report. Nothing links them.
--
-- The question list the lead saw is COPIED into the row (`template`), so
-- changing the questions later never rewrites an old report.
--
-- Who may do what:
--   insert  installer-lead, admin
--   update  the lead who made it (answers only; a resubmit puts it back
--           to 'new' and clears the email stamp); admin / field-manager /
--           payroll-admin may mark it reviewed. A trigger keeps the lead
--           away from the review columns.
--   read    the lead (their own), admin, field-manager, payroll-admin,
--           scheduling, scheduling_manager
--   delete  admin
--
-- Photos go in the existing writeup-photos bucket (installer-lead may
-- already upload there -- 054).
--
-- Run in Supabase SQL Editor. Idempotent -- safe to re-run.
-- Needs 019 (is_allowlisted, has_any_role).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.job_completions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The job, copied at submit time so the report still reads right after
  -- rForce changes or drops the work order.
  order_number      text NOT NULL,
  work_order_number text,
  job_name          text NOT NULL DEFAULT '',
  address           text,
  install_date      date,
  crew_name         text,
  outcome           text NOT NULL
                    CHECK (outcome IN ('complete', 'complete_issues', 'not_complete')),
  -- True when the office should look: any outcome but a clean "complete",
  -- or a clean "complete" where a question marked "flag if no" was answered no.
  flagged           boolean NOT NULL DEFAULT false,
  -- The questions the lead was shown, and what they answered
  -- (answers is { questionId: value }; photo answers are [{path, name}]).
  template          jsonb NOT NULL DEFAULT '[]'::jsonb,
  answers           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Office review (only matters when flagged).
  review_status     text NOT NULL DEFAULT 'new'
                    CHECK (review_status IN ('new', 'reviewed')),
  reviewed_by       text,
  reviewed_by_name  text,
  reviewed_at       timestamptz,
  -- Set by the email route once the notification went out.
  emailed_at        timestamptz,
  email_error       text,
  created_by        text NOT NULL DEFAULT lower(auth.jwt() ->> 'email'),
  created_by_name   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  submit_count      integer NOT NULL DEFAULT 1,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- One report per lead per job: a second submit is an edit, not a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_completions_job_per_lead
  ON public.job_completions (order_number, created_by);
CREATE INDEX IF NOT EXISTS idx_job_completions_created_at ON public.job_completions (created_at);
CREATE INDEX IF NOT EXISTS idx_job_completions_flagged
  ON public.job_completions (flagged, review_status);

-- ── Keep each side in its lane ───────────────────────────────
-- RLS can say WHO may update a row but not WHICH COLUMNS.

CREATE OR REPLACE FUNCTION public.job_completions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  reviewer boolean := public.has_any_role(ARRAY['admin', 'field-manager', 'payroll-admin']);
BEGIN
  -- The server's own routes (service role) and the SQL editor carry no
  -- login: let them through untouched (they stamp emailed_at / email_error).
  IF auth.jwt() IS NULL THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  NEW.flagged := coalesce(NEW.flagged, false) OR NEW.outcome <> 'complete';

  IF TG_OP = 'INSERT' THEN
    NEW.created_by    := lower(auth.jwt() ->> 'email');
    NEW.created_at    := now();
    NEW.submitted_at  := now();
    NEW.submit_count  := 1;
    NEW.review_status := 'new';
    NEW.reviewed_by := NULL; NEW.reviewed_by_name := NULL; NEW.reviewed_at := NULL;
    NEW.emailed_at := NULL;  NEW.email_error := NULL;
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    IF NEW.answers IS DISTINCT FROM OLD.answers
       OR NEW.outcome IS DISTINCT FROM OLD.outcome
       OR NEW.template IS DISTINCT FROM OLD.template THEN
      -- The lead's resubmit: back to the office, and the email goes again.
      NEW.submitted_at  := now();
      NEW.submit_count  := OLD.submit_count + 1;
      NEW.review_status := 'new';
      NEW.reviewed_by := NULL; NEW.reviewed_by_name := NULL; NEW.reviewed_at := NULL;
      NEW.emailed_at := NULL;  NEW.email_error := NULL;
    ELSE
      NEW.submitted_at := OLD.submitted_at;
      NEW.submit_count := OLD.submit_count;
      IF NOT reviewer THEN
        NEW.review_status    := OLD.review_status;
        NEW.reviewed_by      := OLD.reviewed_by;
        NEW.reviewed_by_name := OLD.reviewed_by_name;
        NEW.reviewed_at      := OLD.reviewed_at;
      END IF;
      NEW.emailed_at  := OLD.emailed_at;
      NEW.email_error := OLD.email_error;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_job_completions_guard ON public.job_completions;
CREATE TRIGGER trg_job_completions_guard
  BEFORE INSERT OR UPDATE ON public.job_completions
  FOR EACH ROW EXECUTE FUNCTION public.job_completions_guard();

REVOKE ALL ON FUNCTION public.job_completions_guard() FROM public, anon;

-- ── Who sees and writes what ─────────────────────────────────

ALTER TABLE public.job_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jc_read" ON public.job_completions;
CREATE POLICY "jc_read" ON public.job_completions FOR SELECT
  USING (
    public.is_allowlisted() AND (
      created_by = lower(auth.jwt() ->> 'email')
      OR public.has_any_role(ARRAY['admin', 'field-manager', 'payroll-admin',
                                   'scheduling', 'scheduling_manager'])
    )
  );

DROP POLICY IF EXISTS "jc_insert" ON public.job_completions;
CREATE POLICY "jc_insert" ON public.job_completions FOR INSERT
  WITH CHECK (public.has_any_role(ARRAY['installer-lead', 'admin']));

DROP POLICY IF EXISTS "jc_update" ON public.job_completions;
CREATE POLICY "jc_update" ON public.job_completions FOR UPDATE
  USING (
    public.has_any_role(ARRAY['admin', 'field-manager', 'payroll-admin'])
    OR (created_by = lower(auth.jwt() ->> 'email')
        AND public.has_any_role(ARRAY['installer-lead']))
  )
  WITH CHECK (
    public.has_any_role(ARRAY['admin', 'field-manager', 'payroll-admin'])
    OR (created_by = lower(auth.jwt() ->> 'email')
        AND public.has_any_role(ARRAY['installer-lead']))
  );

DROP POLICY IF EXISTS "jc_delete" ON public.job_completions;
CREATE POLICY "jc_delete" ON public.job_completions FOR DELETE
  USING (public.has_any_role(ARRAY['admin']));

-- New tables get no Data API access automatically (see 024). Policies
-- above are the real gate; anon has none.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_completions TO authenticated, service_role;
REVOKE ALL ON public.job_completions FROM anon;

COMMIT;

-- Verify (run separately):
--   select polname from pg_policy where polrelid = 'public.job_completions'::regclass;
-- Expect jc_read, jc_insert, jc_update, jc_delete.
--   select proname from pg_proc where proname = 'job_completions_guard';
