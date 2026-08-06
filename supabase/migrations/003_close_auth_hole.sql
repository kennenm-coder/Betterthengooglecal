-- ============================================================
-- Migration 003: Close the authorization hole
--
-- Problem: Any Supabase account (even created outside the app)
-- could access data because RLS checked auth.role() = 'authenticated'
-- instead of verifying the user is on the allowlist.
--
-- This migration:
--   1. Fixes get_user_role() to return NULL for non-allowlisted users
--   2. Replaces all auth.role() checks with get_user_role() IS NOT NULL
--   3. Locks down allowed_emails (removes public SELECT)
--   4. Adds is_email_allowed() RPC for pre-signup checks
--   5. Covers app_settings, catalog_items, trim_purchase_orders
--
-- Run in Supabase SQL Editor AFTER 001 and 002.
-- ============================================================

-- ── 1. Fix get_user_role() — return NULL, not 'member', for outsiders ──

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

-- ── 2. Add is_email_allowed() RPC for pre-signup check ──
-- Returns boolean only — no exposure of names/roles.

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

-- ── 3. Fix allowed_emails — remove public SELECT, restore scoped policies ──

DROP POLICY IF EXISTS "anyone_read_allowed_emails" ON public.allowed_emails;
DROP POLICY IF EXISTS "admins_write_allowed_emails" ON public.allowed_emails;
DROP POLICY IF EXISTS "admins_full_access_allowed_emails" ON public.allowed_emails;
DROP POLICY IF EXISTS "users_read_own_allowed_email" ON public.allowed_emails;

-- Admins: full access
CREATE POLICY "admins_full_access_allowed_emails"
  ON public.allowed_emails
  FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- Allowlisted users: read their own row (for role lookup)
CREATE POLICY "users_read_own_allowed_email"
  ON public.allowed_emails
  FOR SELECT
  USING (email = lower(auth.jwt() ->> 'email'));

-- ── 4. Fix work_orders — allowlisted only, not just authenticated ──

DROP POLICY IF EXISTS "authenticated_read_work_orders" ON public.work_orders;

CREATE POLICY "allowlisted_read_work_orders"
  ON public.work_orders
  FOR SELECT
  USING (public.get_user_role() IS NOT NULL);

-- ── 5. Fix action_settings — allowlisted only ──

DROP POLICY IF EXISTS "authenticated_read_action_settings" ON public.action_settings;

CREATE POLICY "allowlisted_read_action_settings"
  ON public.action_settings
  FOR SELECT
  USING (public.get_user_role() IS NOT NULL);

-- ── 6. Fix jobs — allowlisted only ──

DROP POLICY IF EXISTS "authenticated_access_jobs" ON public.jobs;

CREATE POLICY "allowlisted_access_jobs"
  ON public.jobs
  FOR ALL
  USING (public.get_user_role() IS NOT NULL)
  WITH CHECK (public.get_user_role() IS NOT NULL);

-- ── 7. Cover additional tables (if they exist) ──

-- app_settings
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'app_settings') THEN
    ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
    -- Drop any existing policies to avoid conflicts
    DROP POLICY IF EXISTS "allowlisted_read_app_settings" ON public.app_settings;
    DROP POLICY IF EXISTS "admins_write_app_settings" ON public.app_settings;
    EXECUTE 'CREATE POLICY "allowlisted_read_app_settings" ON public.app_settings FOR SELECT USING (public.get_user_role() IS NOT NULL)';
    EXECUTE 'CREATE POLICY "admins_write_app_settings" ON public.app_settings FOR ALL USING (public.get_user_role() = ''admin'') WITH CHECK (public.get_user_role() = ''admin'')';
  END IF;
END $$;

-- catalog_items
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'catalog_items') THEN
    ALTER TABLE public.catalog_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "allowlisted_read_catalog_items" ON public.catalog_items;
    DROP POLICY IF EXISTS "admins_write_catalog_items" ON public.catalog_items;
    EXECUTE 'CREATE POLICY "allowlisted_read_catalog_items" ON public.catalog_items FOR SELECT USING (public.get_user_role() IS NOT NULL)';
    EXECUTE 'CREATE POLICY "admins_write_catalog_items" ON public.catalog_items FOR ALL USING (public.get_user_role() = ''admin'') WITH CHECK (public.get_user_role() = ''admin'')';
  END IF;
END $$;

-- trim_purchase_orders
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'trim_purchase_orders') THEN
    ALTER TABLE public.trim_purchase_orders ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "allowlisted_access_trim_purchase_orders" ON public.trim_purchase_orders;
    EXECUTE 'CREATE POLICY "allowlisted_access_trim_purchase_orders" ON public.trim_purchase_orders FOR ALL USING (public.get_user_role() IS NOT NULL) WITH CHECK (public.get_user_role() IS NOT NULL)';
  END IF;
END $$;
