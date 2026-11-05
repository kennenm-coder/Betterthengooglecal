-- ============================================================
-- 045 - More for More bonus sheets + the installer-lead role
--
-- Install leads fill out the "More for More Program Bonus Sheet"
-- after every job. Until now that was a spreadsheet; this moves it
-- into the calendar:
--
--   1. The lead fills their part on their phone: job, names and
--      tiers, unit quantities, a note. Status 'submitted'.
--   2. Payroll (payroll-admin, admin) fills the office part:
--      deductions, JIP bonus, additional jobs, NPS, the Office Only
--      box, a note. Completing it sets status 'completed'.
--   3. A lead may edit and resubmit at any time. The office's
--      answers are KEPT, but the sheet goes back to 'submitted' so
--      payroll re-checks it (a trigger enforces this -- see 3).
--
-- ── installer-lead ───────────────────────────────────────────
-- A new role, restricted exactly like `installer` (their own crew's
-- jobs in full, every other job trimmed -- 035/036), with one
-- difference: a lead who is ALSO a field manager is not restricted.
-- Field-manager access wins for them. `installer` itself is
-- unchanged: still restricted alongside anything but admin.
--
-- is_installer() is the single switch every restricted policy and
-- the work_orders_visible view already go through, so redefining it
-- here restricts installer-leads everywhere at once.
--
-- ── sheet_type ───────────────────────────────────────────────
-- 'bonus' is the More for More sheet. 'invoice' is reserved for the
-- sub-contractor version (the workbook's Invoice tab), which uses the
-- same flow and is not built yet.
--
-- Run in Supabase SQL Editor. Idempotent -- safe to re-run.
-- 019 (is_allowlisted, has_any_role) and 033 must be applied first.
-- ============================================================

BEGIN;

-- ── 1. Who is restricted ─────────────────────────────────────

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
      AND NOT (coalesce(roles, '{}') && ARRAY['admin'] OR role = 'admin')
      AND (
        coalesce(roles, '{}') && ARRAY['installer'] OR role = 'installer'
        OR (
          (coalesce(roles, '{}') && ARRAY['installer-lead'] OR role = 'installer-lead')
          AND NOT (coalesce(roles, '{}') && ARRAY['field-manager'] OR role = 'field-manager')
        )
      )
  );
$$;

COMMENT ON FUNCTION public.is_installer() IS
  'True when the caller is a restricted field login: holds installer, or holds '
  'installer-lead without field-manager -- and is not an admin. Holding another '
  'role alongside installer does NOT lift the restriction; for installer-lead, '
  'only field-manager does.';

REVOKE ALL ON FUNCTION public.is_installer() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_installer() TO authenticated;

-- ── 2. The sheets ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.more_for_more (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_type        text NOT NULL DEFAULT 'bonus'
                    CHECK (sheet_type IN ('bonus', 'invoice')),
  -- The job, copied at submit time so the sheet still reads right
  -- after rForce changes or drops the work order.
  order_number      text NOT NULL,
  work_order_number text,
  job_name          text NOT NULL DEFAULT '',
  address           text,
  install_date      date,
  crew_name         text,
  status            text NOT NULL DEFAULT 'submitted'
                    CHECK (status IN ('submitted', 'completed')),
  -- What the lead filled in (names, tiers, quantities, their note).
  lead_data         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- What payroll filled in (deductions, JIP, extra jobs, NPS, Office Only).
  office_data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Totals as the app worked them out, stored for lists and exports.
  lead_total        numeric(10, 2),
  final_total       numeric(10, 2),
  created_by        text NOT NULL DEFAULT lower(auth.jwt() ->> 'email'),
  created_by_name   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  submit_count      integer NOT NULL DEFAULT 1,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  completed_by      text,
  completed_by_name text
);

-- One sheet per lead per job: a second submit is an edit, not a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mfm_job_per_lead
  ON public.more_for_more (sheet_type, order_number, created_by);
CREATE INDEX IF NOT EXISTS idx_mfm_status     ON public.more_for_more (status);
CREATE INDEX IF NOT EXISTS idx_mfm_created_at ON public.more_for_more (created_at);
CREATE INDEX IF NOT EXISTS idx_mfm_created_by ON public.more_for_more (created_by);

-- ── 3. Keep each side in its lane ────────────────────────────
-- RLS can say WHO may update a row but not WHICH COLUMNS. This
-- trigger does that: anyone who is not payroll can only ever touch
-- the lead's half, and any change they make sends the sheet back to
-- payroll. Payroll may change anything except who created it.

CREATE OR REPLACE FUNCTION public.mfm_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  office boolean := public.has_any_role(ARRAY['admin', 'payroll-admin']);
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by   := lower(auth.jwt() ->> 'email');
    NEW.created_at   := now();
    NEW.submitted_at := now();
    NEW.submit_count := 1;
    IF NOT office THEN
      NEW.status            := 'submitted';
      NEW.office_data       := '{}'::jsonb;
      NEW.final_total       := NULL;
      NEW.completed_at      := NULL;
      NEW.completed_by      := NULL;
      NEW.completed_by_name := NULL;
    END IF;
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    IF NOT office THEN
      -- The lead's resubmit: office answers stay, office re-checks.
      NEW.office_data       := OLD.office_data;
      NEW.final_total       := OLD.final_total;
      NEW.status            := 'submitted';
      NEW.completed_at      := NULL;
      NEW.completed_by      := OLD.completed_by;
      NEW.completed_by_name := OLD.completed_by_name;
      NEW.submitted_at      := now();
      NEW.submit_count      := OLD.submit_count + 1;
    ELSE
      NEW.submitted_at := OLD.submitted_at;
      NEW.submit_count := OLD.submit_count;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mfm_guard ON public.more_for_more;
CREATE TRIGGER trg_mfm_guard
  BEFORE INSERT OR UPDATE ON public.more_for_more
  FOR EACH ROW EXECUTE FUNCTION public.mfm_guard();

-- ── 4. Who sees and writes what ──────────────────────────────

ALTER TABLE public.more_for_more ENABLE ROW LEVEL SECURITY;

-- A lead sees their own sheets; payroll sees all of them.
DROP POLICY IF EXISTS "mfm_read" ON public.more_for_more;
CREATE POLICY "mfm_read" ON public.more_for_more FOR SELECT
  USING (
    public.is_allowlisted() AND (
      created_by = lower(auth.jwt() ->> 'email')
      OR public.has_any_role(ARRAY['admin', 'payroll-admin'])
    )
  );

-- Only leads start a sheet (admin too, for testing).
DROP POLICY IF EXISTS "mfm_insert" ON public.more_for_more;
CREATE POLICY "mfm_insert" ON public.more_for_more FOR INSERT
  WITH CHECK (public.has_any_role(ARRAY['installer-lead', 'admin']));

-- A lead edits their own; payroll edits any.
DROP POLICY IF EXISTS "mfm_update" ON public.more_for_more;
CREATE POLICY "mfm_update" ON public.more_for_more FOR UPDATE
  USING (
    public.has_any_role(ARRAY['admin', 'payroll-admin'])
    OR (created_by = lower(auth.jwt() ->> 'email')
        AND public.has_any_role(ARRAY['installer-lead']))
  )
  WITH CHECK (
    public.has_any_role(ARRAY['admin', 'payroll-admin'])
    OR (created_by = lower(auth.jwt() ->> 'email')
        AND public.has_any_role(ARRAY['installer-lead']))
  );

-- Only payroll deletes.
DROP POLICY IF EXISTS "mfm_delete" ON public.more_for_more;
CREATE POLICY "mfm_delete" ON public.more_for_more FOR DELETE
  USING (public.has_any_role(ARRAY['admin', 'payroll-admin']));

-- New tables get no Data API access automatically after 2026-10-30
-- (see 024). Policies above are the real gate; anon has none.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.more_for_more TO authenticated, service_role;
REVOKE ALL ON public.more_for_more FROM anon;

REVOKE ALL ON FUNCTION public.mfm_guard() FROM public, anon;

COMMIT;

-- Verify (run separately):
--   select proname from pg_proc where proname = 'mfm_guard';
--   select polname from pg_policy where polrelid = 'public.more_for_more'::regclass;
-- Expect mfm_guard, and mfm_read / mfm_insert / mfm_update / mfm_delete.
-- Signed in as an installer-lead with no field-manager role:
--   select public.is_installer();   -- true
