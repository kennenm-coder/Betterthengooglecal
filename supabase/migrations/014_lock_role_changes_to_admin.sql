-- ============================================================
-- Migration 014: Lock role changes to admins only
--
-- Previously (migration 004) payroll-admin had full UPDATE on
-- allowed_emails, which let them change any non-admin user's role.
--
-- Business rule: only the `admin` role may change or delete roles.
-- Payroll admins may still accept new accounts — that flow uses
-- INSERT on allowed_emails + DELETE on access_requests, neither of
-- which is affected here.
--
-- This drops the payroll-admin UPDATE policy so role edits are
-- blocked at the database level, matching the UI (which no longer
-- exposes role editing to payroll admins).
--
-- Admin retains full access via "admins_full_access_allowed_emails".
--
-- Run in Supabase SQL Editor AFTER 004.
-- ============================================================

DROP POLICY IF EXISTS "payroll_admin_update_allowed_emails"
  ON public.allowed_emails;
