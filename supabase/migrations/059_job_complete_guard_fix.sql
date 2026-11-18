-- ============================================================
-- 059 - Job Complete guard fixes (builds on 058)
--
-- 1. The email route's stamp was being thrown away.
--    058 let a request through untouched only when it carried NO login
--    (auth.jwt() IS NULL). Requests made with the service-role key DO
--    carry a JWT -- one whose role is 'service_role' and that has no
--    email -- so the guard treated the email route like a lead and put
--    emailed_at / email_error back to their old values. Result: every
--    report read "email not sent", and the once-per-submit check never
--    held. Server requests are now recognised by that role claim.
--
-- 2. "Reviewed by" is stamped from the login, not from what the app
--    sends, the same way 054 stamps who checked off write-up work.
--
-- Run in Supabase SQL Editor. Idempotent -- safe to re-run.
-- 058 must be applied first.
-- ============================================================

CREATE OR REPLACE FUNCTION public.job_completions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me       text    := lower(auth.jwt() ->> 'email');
  reviewer boolean := public.has_any_role(ARRAY['admin', 'field-manager', 'payroll-admin']);
BEGIN
  -- No person behind the request: the SQL editor (no JWT) or a server route
  -- using the service-role key (JWT role 'service_role', no email). Those
  -- stamp emailed_at / email_error; let them through untouched.
  IF auth.jwt() IS NULL OR coalesce(auth.jwt() ->> 'role', '') = 'service_role' THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  NEW.flagged := coalesce(NEW.flagged, false) OR NEW.outcome <> 'complete';

  IF TG_OP = 'INSERT' THEN
    NEW.created_by    := me;
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
      ELSIF NEW.review_status IS DISTINCT FROM OLD.review_status THEN
        -- Who reviewed it comes from the login. The display name is the
        -- app's (allowed_emails.name), kept as sent.
        IF NEW.review_status = 'reviewed' THEN
          NEW.reviewed_by := me;
          NEW.reviewed_at := now();
        ELSE
          NEW.reviewed_by := NULL; NEW.reviewed_by_name := NULL; NEW.reviewed_at := NULL;
        END IF;
      ELSE
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

REVOKE ALL ON FUNCTION public.job_completions_guard() FROM public, anon;

-- Verify (run separately): the body should mention service_role.
--   select prosrc like '%service_role%' from pg_proc where proname = 'job_completions_guard';
