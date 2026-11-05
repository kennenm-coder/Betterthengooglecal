-- ============================================================
-- 046 - More for More: in-progress drafts, send-back, notices
--
-- Builds on 045. Three additions:
--
--   1. DRAFTS. A lead can save a sheet as 'draft' (in progress)
--      and finish it later. Payroll can see drafts but they are
--      not waiting on payroll yet.
--   2. SEND BACK. Payroll can set a submitted sheet to 'rejected'
--      with a reason. The lead fixes it and submits again; the
--      reason stays on the row so payroll can see what was asked.
--   3. NOTICES. The lead gets a notice when a sheet is sent back
--      (until they resubmit) or completed (until they dismiss it).
--      lead_ack_at records the dismissal. The trigger lets a lead
--      change ONLY that column without it counting as an edit.
--
-- Statuses: draft -> submitted -> completed, with rejected as the
-- detour back to the lead.
--
-- Run in Supabase SQL Editor. Idempotent -- safe to re-run.
-- 045 must be applied first.
-- ============================================================

BEGIN;

ALTER TABLE public.more_for_more
  ADD COLUMN IF NOT EXISTS reject_reason    text,
  ADD COLUMN IF NOT EXISTS rejected_at      timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by      text,
  ADD COLUMN IF NOT EXISTS rejected_by_name text,
  ADD COLUMN IF NOT EXISTS lead_ack_at      timestamptz;

ALTER TABLE public.more_for_more DROP CONSTRAINT IF EXISTS more_for_more_status_check;
ALTER TABLE public.more_for_more ADD CONSTRAINT more_for_more_status_check
  CHECK (status IN ('draft', 'submitted', 'rejected', 'completed'));

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

  -- The lead saving progress or (re)submitting. Office answers stay
  -- for payroll to re-check; the sheet leaves 'completed'/'rejected'.
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

COMMIT;

-- Verify (run separately):
--   select column_name from information_schema.columns
--    where table_name = 'more_for_more' and column_name in
--      ('reject_reason','rejected_at','rejected_by','rejected_by_name','lead_ack_at');
-- Expect all five.
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'more_for_more_status_check';
-- Expect draft, submitted, rejected, completed.
