-- ============================================================
-- Migration 004: Payroll-admin team management
--
-- Gives payroll-admin users the ability to:
--   • Read, insert, and update allowed_emails (manage team)
--   • Read and delete access_requests (approve/deny join requests)
--
-- Payroll admins CANNOT delete from allowed_emails (remove team members).
-- Admin retains full access to everything.
--
-- Run in Supabase SQL Editor AFTER 003.
-- ============================================================

-- ── 1. allowed_emails — add payroll-admin SELECT / INSERT / UPDATE ──

-- Payroll admins can read the full team list
CREATE POLICY "payroll_admin_read_allowed_emails"
  ON public.allowed_emails
  FOR SELECT
  USING (public.get_user_role() = 'payroll-admin');

-- Payroll admins can add new team members
CREATE POLICY "payroll_admin_insert_allowed_emails"
  ON public.allowed_emails
  FOR INSERT
  WITH CHECK (public.get_user_role() = 'payroll-admin');

-- Payroll admins can edit existing team members
CREATE POLICY "payroll_admin_update_allowed_emails"
  ON public.allowed_emails
  FOR UPDATE
  USING (public.get_user_role() = 'payroll-admin')
  WITH CHECK (public.get_user_role() = 'payroll-admin');

-- NOTE: No DELETE policy for payroll-admin on allowed_emails.
-- Only admins (via the existing "admins_full_access_allowed_emails" policy) can delete.

-- ── 2. access_requests — let payroll-admin read and manage requests ──

-- Payroll admins can see pending requests
CREATE POLICY "payroll_admin_read_access_requests"
  ON public.access_requests
  FOR SELECT
  USING (public.get_user_role() = 'payroll-admin');

-- Payroll admins can delete requests (approve inserts into allowed_emails, deny deletes the request)
CREATE POLICY "payroll_admin_delete_access_requests"
  ON public.access_requests
  FOR DELETE
  USING (public.get_user_role() = 'payroll-admin');
