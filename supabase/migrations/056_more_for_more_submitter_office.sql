-- ============================================================
-- 056 - More for More Submitter does payroll's More for More work;
--       one sheet per job for everyone
--
-- Builds on 055. Kennen, 2026-11-17:
--
--   1. The More for More Submitter (`mfm-submitter`) now works the
--      payroll More for More tab like payroll does: sees every sheet,
--      finishes leads' sheets (deductions, Office Only, complete),
--      sends them back, ticks "on paper" and types paper sheets in.
--      NOT given: deleting sheets, the admin-only Exclude, or More for
--      More settings (rates, people) -- those stay with payroll.
--      Their OWN submits still auto-approve (055).
--
--   2. One sheet per job, for EVERYONE. 055 only stopped a submitter
--      from starting a second sheet on a job; a lead could still put
--      one in on a job the submitter had already done, and payroll
--      would see two pay amounts for one install. Now nobody can start
--      a sheet on a job that already has one. The one exception is the
--      office (payroll or submitter) typing in a PAPER sheet.
--
--   3. Leads may call mfm_job_status() (status and the name on the
--      sheet only, no money) so their list can say "Already submitted
--      by ..." instead of "Not submitted".
--
-- Run in Supabase SQL Editor. Idempotent -- safe to re-run.
-- 055 must be applied first.
-- ============================================================

BEGIN;

-- ── 1. The guard ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mfm_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  payroll boolean := public.has_any_role(ARRAY['admin', 'payroll-admin']);
  sub     boolean := NOT public.has_any_role(ARRAY['admin', 'payroll-admin'])
                     AND public.has_any_role(ARRAY['mfm-submitter']);
  office  boolean := public.has_any_role(ARRAY['admin', 'payroll-admin', 'mfm-submitter']);
  me      text    := lower(auth.jwt() ->> 'email');
  today   text    := to_char((now() AT TIME ZONE 'America/Los_Angeles')::date, 'YYYY-MM-DD');
  ack     timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by   := me;
    NEW.created_at   := now();
    NEW.submitted_at := now();
    NEW.lead_ack_at  := NULL;

    -- One sheet per job. Only the office typing in a paper sheet may add
    -- to a job that already has one.
    IF NOT (office AND coalesce(NEW.on_paper, false)) AND EXISTS (
      SELECT 1 FROM public.more_for_more m
       WHERE m.sheet_type = NEW.sheet_type AND m.order_number = NEW.order_number
    ) THEN
      RAISE EXCEPTION 'Someone already has a More for More started or turned in for this job.';
    END IF;

    IF sub AND NOT coalesce(NEW.on_paper, false) THEN
      -- The submitter's own sheet: submitting approves it (055).
      IF EXISTS (
        SELECT 1 FROM public.more_for_more_jobs j
         WHERE j.order_number = NEW.order_number AND j.paper
      ) THEN
        RAISE EXCEPTION 'This job came in on paper. Type it in from the Jobs list instead.';
      END IF;
      NEW.reject_reason    := NULL;
      NEW.rejected_at      := NULL;
      NEW.rejected_by      := NULL;
      NEW.rejected_by_name := NULL;
      IF NEW.status IS DISTINCT FROM 'draft' THEN
        NEW.status        := 'completed';
        NEW.completed_at  := now();
        NEW.completed_by  := me;
        NEW.auto_approved := true;
        NEW.office_data   := jsonb_build_object('dateReceived', today);
      ELSE
        NEW.status            := 'draft';
        NEW.office_data       := '{}'::jsonb;
        NEW.final_total       := NULL;
        NEW.completed_at      := NULL;
        NEW.completed_by      := NULL;
        NEW.completed_by_name := NULL;
        NEW.auto_approved     := false;
      END IF;
    ELSIF NOT office THEN
      -- A lead.
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
      NEW.auto_approved     := false;
    ELSE
      -- The office typing in a paper sheet: never auto-approved.
      NEW.auto_approved := false;
    END IF;
    NEW.submit_count := CASE WHEN NEW.status = 'draft' THEN 0 ELSE 1 END;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- UPDATE

  -- A submitter re-approving THEIR OWN sheet from the submitter form (the
  -- app sends auto_approved = true for exactly this). Same as 055.
  IF sub AND OLD.created_by = me AND NEW.auto_approved IS TRUE
     AND NEW.status IS DISTINCT FROM 'draft' THEN
    NEW.created_by       := OLD.created_by;
    NEW.created_at       := OLD.created_at;
    NEW.reject_reason    := OLD.reject_reason;
    NEW.rejected_at      := OLD.rejected_at;
    NEW.rejected_by      := OLD.rejected_by;
    NEW.rejected_by_name := OLD.rejected_by_name;
    NEW.lead_ack_at      := OLD.lead_ack_at;
    NEW.on_paper         := OLD.on_paper;
    NEW.status           := 'completed';
    NEW.completed_at     := now();
    NEW.completed_by     := me;
    NEW.office_data      := CASE
      WHEN coalesce(OLD.office_data ->> 'dateReceived', '') = ''
        THEN coalesce(OLD.office_data, '{}'::jsonb) || jsonb_build_object('dateReceived', today)
      ELSE OLD.office_data
    END;
    NEW.submitted_at     := now();
    NEW.submit_count     := OLD.submit_count + 1;
    NEW.updated_at       := now();
    RETURN NEW;
  END IF;

  -- The office (payroll or a submitter) working a sheet.
  IF office THEN
    NEW.created_by   := OLD.created_by;
    NEW.created_at   := OLD.created_at;
    NEW.submitted_at := OLD.submitted_at;
    NEW.submit_count := OLD.submit_count;
    -- Someone in the office has now been in it: no longer "approved without a look".
    NEW.auto_approved := false;
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

  -- A lead only dismissing a notice: nothing else may change.
  IF NEW.lead_data IS NOT DISTINCT FROM OLD.lead_data
     AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    ack := NEW.lead_ack_at;
    NEW := OLD;
    NEW.lead_ack_at := ack;
    RETURN NEW;
  END IF;

  -- A lead saving progress or (re)submitting.
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
  NEW.auto_approved     := false;
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

-- ── 2. Sheets: the submitter reads and works all of them ─────

DROP POLICY IF EXISTS "mfm_read" ON public.more_for_more;
CREATE POLICY "mfm_read" ON public.more_for_more FOR SELECT
  USING (
    public.is_allowlisted() AND (
      created_by = lower(auth.jwt() ->> 'email')
      OR public.has_any_role(ARRAY['admin', 'payroll-admin', 'mfm-submitter'])
    )
  );

DROP POLICY IF EXISTS "mfm_update" ON public.more_for_more;
CREATE POLICY "mfm_update" ON public.more_for_more FOR UPDATE
  USING (
    public.has_any_role(ARRAY['admin', 'payroll-admin', 'mfm-submitter'])
    OR (created_by = lower(auth.jwt() ->> 'email')
        AND public.has_any_role(ARRAY['installer-lead']))
  )
  WITH CHECK (
    public.has_any_role(ARRAY['admin', 'payroll-admin', 'mfm-submitter'])
    OR (created_by = lower(auth.jwt() ->> 'email')
        AND public.has_any_role(ARRAY['installer-lead']))
  );

-- mfm_insert (055) already includes mfm-submitter. mfm_delete stays
-- admin + payroll-admin only.

-- ── 3. Job flags: the submitter may tick "on paper" ──────────
-- (Exclude stays admin-only; mfm_jobs_guard enforces that.)

DROP POLICY IF EXISTS "mfm_jobs_insert" ON public.more_for_more_jobs;
DROP POLICY IF EXISTS "mfm_jobs_update" ON public.more_for_more_jobs;
CREATE POLICY "mfm_jobs_insert" ON public.more_for_more_jobs FOR INSERT
  WITH CHECK (public.has_any_role(ARRAY['admin', 'payroll-admin', 'mfm-submitter']));
CREATE POLICY "mfm_jobs_update" ON public.more_for_more_jobs FOR UPDATE
  USING (public.has_any_role(ARRAY['admin', 'payroll-admin', 'mfm-submitter']))
  WITH CHECK (public.has_any_role(ARRAY['admin', 'payroll-admin', 'mfm-submitter']));

-- ── 4. Leads may see which jobs already have a sheet ─────────

CREATE OR REPLACE FUNCTION public.mfm_job_status()
RETURNS TABLE (order_number text, status text, created_by_name text, mine boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.order_number, m.status, m.created_by_name,
         (m.created_by = lower(auth.jwt() ->> 'email'))
    FROM public.more_for_more m
   WHERE m.sheet_type = 'bonus'
     AND public.has_any_role(ARRAY['mfm-submitter', 'admin', 'payroll-admin', 'installer-lead']);
$$;

REVOKE ALL ON FUNCTION public.mfm_job_status() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mfm_job_status() TO authenticated;

COMMIT;

-- Verify (run separately):
--   select polname, pg_get_expr(polqual, polrelid) from pg_policy
--    where polrelid = 'public.more_for_more'::regclass and polname in ('mfm_read','mfm_update');
-- Expect mfm-submitter in both.
