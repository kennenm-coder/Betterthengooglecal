-- ============================================================
-- Fix: allowed_emails RLS was too restrictive for pre-signup checks.
--
-- The login page queries allowed_emails BEFORE the user is
-- authenticated (to check if they're on the allowlist before
-- showing signup). The old policy only allowed authenticated
-- users to read their own row, which broke this flow.
--
-- This table contains only emails and roles — no secrets —
-- so public SELECT is safe.
--
-- Run this in the Supabase SQL Editor AFTER 001_rls_policies.sql.
-- ============================================================

-- Drop the old restrictive policies
DROP POLICY IF EXISTS "admins_full_access_allowed_emails" ON public.allowed_emails;
DROP POLICY IF EXISTS "users_read_own_allowed_email" ON public.allowed_emails;

-- Anyone (including anon/pre-signup) can read the allowlist
CREATE POLICY "anyone_read_allowed_emails"
  ON public.allowed_emails
  FOR SELECT
  USING (true);

-- Admins: full write access (insert/update/delete)
CREATE POLICY "admins_write_allowed_emails"
  ON public.allowed_emails
  FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');
