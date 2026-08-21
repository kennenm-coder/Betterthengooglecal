-- ============================================================
-- 004 — Multi-role support + scheduling roles
--
-- Adds an additive `roles text[]` column to allowed_emails so one
-- account can hold multiple roles (e.g. Payroll Admin + Scheduling).
--
-- The existing single `role` column is KEPT and remains the "primary"
-- role that drives get_user_role() and every RLS policy in 001 — this
-- migration does NOT touch those, so calendar-app permissions are
-- unchanged. `roles` is a superset used by apps that need finer grain
-- (the scheduling app gates on the scheduling roles below).
--
-- New role string values (just data — `roles`/`role` are free text):
--   'scheduling'          — can sign into + edit the scheduling app
--   'scheduling_manager'  — scheduling app, manager-level
--   'admin'               — full access (already existed)
-- ============================================================

-- ── 1. Additive multi-role column ──
ALTER TABLE public.allowed_emails
  ADD COLUMN IF NOT EXISTS roles text[] NOT NULL DEFAULT '{}';

-- Backfill: seed the array from the existing primary role so nobody
-- loses access. Only fills rows that haven't been set yet.
UPDATE public.allowed_emails
  SET roles = ARRAY[role]
  WHERE role IS NOT NULL AND (roles IS NULL OR roles = '{}');

-- ── 2. Helper: does the CURRENT user hold a given role? ──
-- Checks both the multi-role array and the legacy primary column.
-- SECURITY DEFINER + STABLE to match get_user_role() in 001.
CREATE OR REPLACE FUNCTION public.has_role(check_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.allowed_emails
    WHERE email = lower(auth.jwt() ->> 'email')
      AND (check_role = ANY(roles) OR check_role = role)
  );
$$;

-- ── 3. Helper: may the CURRENT user access the scheduling app? ──
-- Reusable in future RLS on sched_* tables. The scheduling app itself
-- reads its own allowed_emails row directly (self-read policy in 001),
-- so this is a convenience/authorization helper, not a hard dependency.
CREATE OR REPLACE FUNCTION public.can_access_scheduling()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT public.has_role('admin')
      OR public.has_role('scheduling')
      OR public.has_role('scheduling_manager');
$$;
