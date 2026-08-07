-- ============================================================
-- Row Level Security policies for Duck Force / RbA Field Calendar
--
-- CANONICAL REFERENCE — this is the desired end-state.
-- For incremental application, run the numbered migration files.
--
-- Key principle: "authenticated" ≠ "allowlisted".
-- get_user_role() returns NULL for users not on the allowlist,
-- so all data policies reject non-allowlisted Supabase accounts.
-- ============================================================

-- ── Helper: get current user's role from allowed_emails ──
-- Returns NULL if the user is not on the allowlist.

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT role FROM public.allowed_emails
  WHERE email = lower(auth.jwt() ->> 'email')
  LIMIT 1;
$$;

-- ── Helper: pre-signup allowlist check ──
-- Returns true/false only — does NOT expose emails, names, or roles.
-- Callable by anon users (before they have an account).

CREATE OR REPLACE FUNCTION public.is_email_allowed(check_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.allowed_emails
    WHERE email = lower(check_email)
  );
$$;

-- ============================================================
-- allowed_emails
-- Admins can read/write. Authenticated allowlisted users can
-- read their own row (for role lookup). No public SELECT.
-- Pre-signup check uses the is_email_allowed() RPC instead.
-- ============================================================

ALTER TABLE public.allowed_emails ENABLE ROW LEVEL SECURITY;

-- Admins: full access
CREATE POLICY "admins_full_access_allowed_emails"
  ON public.allowed_emails
  FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- Allowlisted users: read their own row
CREATE POLICY "users_read_own_allowed_email"
  ON public.allowed_emails
  FOR SELECT
  USING (email = lower(auth.jwt() ->> 'email'));

-- ============================================================
-- access_requests
-- Anyone can INSERT (unauthenticated access requests).
-- Admins can read and delete.
-- ============================================================

ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_insert_access_requests"
  ON public.access_requests
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "admins_manage_access_requests"
  ON public.access_requests
  FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ============================================================
-- work_orders
-- Allowlisted users can read. Only admins can write.
-- ============================================================

ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allowlisted_read_work_orders"
  ON public.work_orders
  FOR SELECT
  USING (public.get_user_role() IS NOT NULL);

CREATE POLICY "admins_write_work_orders"
  ON public.work_orders
  FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ============================================================
-- action_settings
-- Allowlisted users can read. Admins can write.
-- ============================================================

ALTER TABLE public.action_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allowlisted_read_action_settings"
  ON public.action_settings
  FOR SELECT
  USING (public.get_user_role() IS NOT NULL);

CREATE POLICY "admins_write_action_settings"
  ON public.action_settings
  FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ============================================================
-- time_off_requests
-- Admins and payroll-admins only.
-- ============================================================

ALTER TABLE public.time_off_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_payroll_manage_time_off"
  ON public.time_off_requests
  FOR ALL
  USING (public.get_user_role() IN ('admin', 'payroll-admin'))
  WITH CHECK (public.get_user_role() IN ('admin', 'payroll-admin'));

-- ============================================================
-- employees
-- Admins and payroll-admins only.
-- ============================================================

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_payroll_manage_employees"
  ON public.employees
  FOR ALL
  USING (public.get_user_role() IN ('admin', 'payroll-admin'))
  WITH CHECK (public.get_user_role() IN ('admin', 'payroll-admin'));

-- ============================================================
-- jobs (material ordering)
-- Allowlisted users can read/write.
-- ============================================================

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allowlisted_access_jobs"
  ON public.jobs
  FOR ALL
  USING (public.get_user_role() IS NOT NULL)
  WITH CHECK (public.get_user_role() IS NOT NULL);

-- ============================================================
-- app_settings (if exists)
-- Allowlisted users can read. Admins can write.
-- ============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'app_settings') THEN
    ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

CREATE POLICY "allowlisted_read_app_settings"
  ON public.app_settings
  FOR SELECT
  USING (public.get_user_role() IS NOT NULL);

CREATE POLICY "admins_write_app_settings"
  ON public.app_settings
  FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ============================================================
-- catalog_items (if exists)
-- Allowlisted users can read. Admins can write.
-- ============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'catalog_items') THEN
    ALTER TABLE public.catalog_items ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

CREATE POLICY "allowlisted_read_catalog_items"
  ON public.catalog_items
  FOR SELECT
  USING (public.get_user_role() IS NOT NULL);

CREATE POLICY "admins_write_catalog_items"
  ON public.catalog_items
  FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ============================================================
-- trim_purchase_orders (if exists)
-- Allowlisted users can read/write.
-- ============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'trim_purchase_orders') THEN
    ALTER TABLE public.trim_purchase_orders ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

CREATE POLICY "allowlisted_access_trim_purchase_orders"
  ON public.trim_purchase_orders
  FOR ALL
  USING (public.get_user_role() IS NOT NULL)
  WITH CHECK (public.get_user_role() IS NOT NULL);
