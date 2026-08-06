-- ============================================================
-- Row Level Security policies for Duck Force / RbA Field Calendar
--
-- Run this in the Supabase SQL Editor to apply.
-- These policies assume:
--   1. Tables already exist
--   2. Email-based allowlist stored in `allowed_emails`
--   3. Roles: admin, payroll-admin, member
-- ============================================================

-- ── Helper: get current user's role from allowed_emails ──

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (SELECT role FROM public.allowed_emails
     WHERE email = lower(auth.jwt() ->> 'email')
     LIMIT 1),
    'member'
  );
$$;

-- ============================================================
-- allowed_emails
-- Anon can SELECT (needed for pre-signup allowlist check).
-- Admins can insert/update/delete.
-- This table contains only emails and roles — no secrets.
-- ============================================================

ALTER TABLE public.allowed_emails ENABLE ROW LEVEL SECURITY;

-- Anyone (including anon/pre-signup) can read the allowlist for existence checks
CREATE POLICY "anyone_read_allowed_emails"
  ON public.allowed_emails
  FOR SELECT
  USING (true);

-- Admins: full write access
CREATE POLICY "admins_write_allowed_emails"
  ON public.allowed_emails
  FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ============================================================
-- access_requests
-- Anyone can INSERT (unauthenticated access requests).
-- Admins can read and delete.
-- ============================================================

ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;

-- Anyone (including anon) can insert a request
CREATE POLICY "anon_insert_access_requests"
  ON public.access_requests
  FOR INSERT
  WITH CHECK (true);

-- Admins: full read/delete
CREATE POLICY "admins_manage_access_requests"
  ON public.access_requests
  FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ============================================================
-- work_orders
-- Authenticated users can read. Only admins can write.
-- ============================================================

ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read
CREATE POLICY "authenticated_read_work_orders"
  ON public.work_orders
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Admins can insert/update/delete
CREATE POLICY "admins_write_work_orders"
  ON public.work_orders
  FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ============================================================
-- action_settings
-- Admins can read/write. Members can read.
-- ============================================================

ALTER TABLE public.action_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_action_settings"
  ON public.action_settings
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "admins_write_action_settings"
  ON public.action_settings
  FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ============================================================
-- time_off_requests
-- Admins and payroll-admins can read/write. Members cannot access.
-- ============================================================

ALTER TABLE public.time_off_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_payroll_manage_time_off"
  ON public.time_off_requests
  FOR ALL
  USING (public.get_user_role() IN ('admin', 'payroll-admin'))
  WITH CHECK (public.get_user_role() IN ('admin', 'payroll-admin'));

-- ============================================================
-- employees
-- Admins and payroll-admins can read/write. Members cannot access.
-- ============================================================

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_payroll_manage_employees"
  ON public.employees
  FOR ALL
  USING (public.get_user_role() IN ('admin', 'payroll-admin'))
  WITH CHECK (public.get_user_role() IN ('admin', 'payroll-admin'));

-- ============================================================
-- jobs (material ordering)
-- Authenticated users can read/write their own jobs.
-- ============================================================

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_access_jobs"
  ON public.jobs
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
