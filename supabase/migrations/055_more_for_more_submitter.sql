-- ============================================================
-- 055 - More for More Submitter role (auto-approved sheets)
--
-- A new role, `mfm-submitter`, for someone who puts More for More
-- sheets in FOR the crews instead of the crews doing it themselves:
--
--   * They see every install that has no sheet yet, and how long ago
--     it was installed (the app does that part).
--   * They fill the lead's half of the sheet and submit it.
--   * Submitting APPROVES it on the spot: status goes straight to
--     'completed' with no deductions, skipping payroll's review. The
--     row is marked auto_approved so payroll can tell it apart from
--     one they finished themselves.
--   * The moment payroll opens and saves an auto-approved sheet, the
--     mark clears: payroll has now looked at it.
--
-- The role only ADDS. It does not restrict anyone the way
-- `installer` does, and is_installer() is not touched.
--
-- ── Guard rails ──────────────────────────────────────────────
--   * One sheet per job, whoever filled it. A submitter cannot start
--     a sheet on a job that already has one (a lead's, payroll's, or
--     another submitter's), or on a job payroll marked "on paper".
--   * A submitter can change their own sheet only while it is a
--     draft, was sent back, or is still auto-approved and untouched
--     by payroll. After payroll has been in it, it is payroll's.
--
-- ── Seeing what is already done ──────────────────────────────
-- Submitters can read only their own sheets (pay figures stay with
-- payroll). To know which jobs are already covered they call
-- mfm_job_status(), which returns just job number, status and the
-- name on the sheet -- no money.
--
-- Run in Supabase SQL Editor. Idempotent -- safe to re-run.
-- 045, 046 and 048 must be applied first.
-- ============================================================

BEGIN;

-- ── 1. Mark auto-approved sheets ─────────────────────────────

ALTER TABLE public.more_for_more
  ADD COLUMN IF NOT EXISTS auto_approved boolean NOT NULL DEFAULT false;

-- ── 2. The guard: 048's, plus the submitter's lane ───────────

CREATE OR REPLACE FUNCTION public.mfm_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  office boolean := public.has_any_role(ARRAY['admin', 'payroll-admin']);
  sub    boolean := NOT public.has_any_role(ARRAY['admin', 'payroll-admin'])
                    AND public.has_any_role(ARRAY['mfm-submitter']);
  me     text    := lower(auth.jwt() ->> 'email');
  today  text    := to_char((now() AT TIME ZONE 'America/Los_Angeles')::date, 'YYYY-MM-DD');
  ack    timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by   := me;
    NEW.created_at   := now();
    NEW.submitted_at := now();
    NEW.lead_ack_at  := NULL;

    IF sub THEN
      IF EXISTS (
        SELECT 1 FROM public.more_for_more m
         WHERE m.sheet_type = NEW.sheet_type AND m.order_number = NEW.order_number
      ) THEN
        RAISE EXCEPTION 'Someone already has a More for More started or turned in for this job.';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.more_for_more_jobs j
         WHERE j.order_number = NEW.order_number AND j.paper
      ) THEN
        RAISE EXCEPTION 'This job came in on paper. Payroll types those in.';
      END IF;

      NEW.reject_reason    := NULL;
      NEW.rejected_at      := NULL;
      NEW.rejected_by      := NULL;
      NEW.rejected_by_name := NULL;
      NEW.on_paper         := false;
      IF NEW.status IS DISTINCT FROM 'draft' THEN
        -- Submitting approves it. final_total comes from the app (no
        -- deductions on a fresh sheet, so it equals the lead total).
        NEW.status       := 'completed';
        NEW.completed_at := now();
        NEW.completed_by := me;
        NEW.auto_approved := true;
        NEW.office_data  := jsonb_build_object('dateReceived', today);
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
      -- Payroll typing in a paper sheet: never auto-approved.
      NEW.auto_approved := false;
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
    -- Payroll has now opened it: no longer "approved without a look".
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

  -- Someone only dismissing a notice: nothing else may change.
  IF NEW.lead_data IS NOT DISTINCT FROM OLD.lead_data
     AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    ack := NEW.lead_ack_at;
    NEW := OLD;
    NEW.lead_ack_at := ack;
    RETURN NEW;
  END IF;

  IF sub THEN
    -- The submitter saving progress or (re)submitting their own sheet.
    NEW.created_by       := OLD.created_by;
    NEW.created_at       := OLD.created_at;
    NEW.reject_reason    := OLD.reject_reason;
    NEW.rejected_at      := OLD.rejected_at;
    NEW.rejected_by      := OLD.rejected_by;
    NEW.rejected_by_name := OLD.rejected_by_name;
    NEW.lead_ack_at      := OLD.lead_ack_at;
    NEW.on_paper         := OLD.on_paper;
    IF NEW.status IS DISTINCT FROM 'draft' THEN
      -- Payroll's earlier answers (if any) stay; the sheet is approved again.
      NEW.status        := 'completed';
      NEW.completed_at  := now();
      NEW.completed_by  := me;
      NEW.auto_approved := true;
      NEW.office_data   := CASE
        WHEN coalesce(OLD.office_data ->> 'dateReceived', '') = ''
          THEN coalesce(OLD.office_data, '{}'::jsonb) || jsonb_build_object('dateReceived', today)
        ELSE OLD.office_data
      END;
      NEW.submitted_at  := now();
      NEW.submit_count  := OLD.submit_count + 1;
    ELSE
      NEW.status            := 'draft';
      NEW.office_data       := OLD.office_data;
      NEW.final_total       := OLD.final_total;
      NEW.completed_at      := NULL;
      NEW.completed_by      := OLD.completed_by;
      NEW.completed_by_name := OLD.completed_by_name;
      NEW.auto_approved     := false;
      NEW.submitted_at      := OLD.submitted_at;
      NEW.submit_count      := OLD.submit_count;
    END IF;
    NEW.updated_at := now();
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

-- ── 3. Who may write ─────────────────────────────────────────

DROP POLICY IF EXISTS "mfm_insert" ON public.more_for_more;
CREATE POLICY "mfm_insert" ON public.more_for_more FOR INSERT
  WITH CHECK (public.has_any_role(ARRAY['installer-lead', 'admin', 'payroll-admin', 'mfm-submitter']));

-- A lead edits their own; payroll edits any; a submitter edits their own
-- while it is a draft, sent back, or still auto-approved and unseen by
-- payroll (the app only offers those, this makes the database agree).
DROP POLICY IF EXISTS "mfm_update" ON public.more_for_more;
CREATE POLICY "mfm_update" ON public.more_for_more FOR UPDATE
  USING (
    public.has_any_role(ARRAY['admin', 'payroll-admin'])
    OR (created_by = lower(auth.jwt() ->> 'email')
        AND public.has_any_role(ARRAY['installer-lead']))
    OR (created_by = lower(auth.jwt() ->> 'email')
        AND public.has_any_role(ARRAY['mfm-submitter'])
        AND (status IN ('draft', 'rejected') OR auto_approved))
  )
  WITH CHECK (
    public.has_any_role(ARRAY['admin', 'payroll-admin'])
    OR (created_by = lower(auth.jwt() ->> 'email')
        AND public.has_any_role(ARRAY['installer-lead']))
    OR (created_by = lower(auth.jwt() ->> 'email')
        AND public.has_any_role(ARRAY['mfm-submitter']))
  );

-- ── 4. Which jobs already have a sheet (no money) ────────────

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
     AND public.has_any_role(ARRAY['mfm-submitter', 'admin', 'payroll-admin']);
$$;

REVOKE ALL ON FUNCTION public.mfm_job_status() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mfm_job_status() TO authenticated;

COMMIT;

-- Verify (run separately):
--   select column_name from information_schema.columns
--    where table_name = 'more_for_more' and column_name = 'auto_approved';
--   select polname from pg_policy where polrelid = 'public.more_for_more'::regclass;
--   select proname from pg_proc where proname = 'mfm_job_status';
-- Expect auto_approved, mfm_read / mfm_insert / mfm_update / mfm_delete, mfm_job_status.
