-- ============================================================
-- Migration 019: Lock down every shared table to allowlisted users
--
-- Problem (confirmed against the LIVE database on 2026-09-08):
--   Many tables carried permissive policies like
--     FOR ALL TO anon USING (true) WITH CHECK (true)
--   or FOR ALL USING (true) (no TO clause = PUBLIC, which includes anon).
--   Postgres OR-combines permissive policies, so those single policies
--   made the tables fully readable AND writable by anyone holding the
--   public anon key — which is shipped in every app's JS bundle. The
--   scoped policies from 003/017 were present but irrelevant because the
--   open ones matched first.
--
--   Worst offenders:
--     * allowed_emails — "Authenticated users can manage allowed emails"
--       let ANY Supabase account add itself to the allowlist as admin.
--     * jobs, app_settings, catalog_items, order_history, trim_*,
--       standalone_trim_orders, shop_inventory_* — real customer jobs
--       and purchase orders, anon read/write/delete.
--     * every sched_* table — customer names/addresses/phones, anon.
--     * work_orders, employees, time_off_requests, import_logs — anon.
--
-- This migration:
--   1. Adds two helpers: is_allowlisted() and has_any_role(text[]).
--   2. Removes every open policy (by exact live name, or all policies on
--      the sched_* tables which were open wholesale).
--   3. Recreates scoped policies:
--        read  → any allowlisted user
--        write → the roles that app actually uses for writes
--   4. Keeps the intentional anon INSERT on access_requests (the
--      "Request access" button on the login pages), but stops anon from
--      READING that table.
--
-- Apps that share this database and the roles they write with:
--   Duck Force calendar   admin / payroll-admin / field-manager / member
--   nwo-material-list     admin / configuring-editing / configuring
--   confirmation-auditor  admin / configuring-editing / configuring
--   RBANWO-Scheduling     admin / scheduling / scheduling_manager
--   RBANWO-Signatures     (its own tables; unchanged here)
--
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
-- Wrapped in a transaction so it applies all-or-nothing.
-- ============================================================

BEGIN;

-- ── 1. Helpers ───────────────────────────────────────────────

-- True when the signed-in user's email is on the allowlist (any role).
CREATE OR REPLACE FUNCTION public.is_allowlisted()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.allowed_emails
    WHERE email = lower(auth.jwt() ->> 'email')
  );
$$;

-- True when the signed-in user holds ANY of the given roles
-- (checks both the legacy single `role` column and the `roles` array).
CREATE OR REPLACE FUNCTION public.has_any_role(check_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.allowed_emails
    WHERE email = lower(auth.jwt() ->> 'email')
      AND (roles && check_roles OR role = ANY (check_roles))
  );
$$;

-- ── 2. allowed_emails — the root of trust ────────────────────
-- Remove: public SELECT (leaked the whole staff roster) and
-- authenticated ALL (any Supabase account could edit the allowlist).
-- Remaining policies: admins full access, payroll-admin read/insert,
-- users read their own row.

DROP POLICY IF EXISTS "Anyone can read allowed emails" ON public.allowed_emails;
DROP POLICY IF EXISTS "Authenticated users can manage allowed emails" ON public.allowed_emails;

-- ── 3. access_requests ───────────────────────────────────────
-- Keep: anon INSERT (login page "Request access").
-- Remove: public SELECT and authenticated DELETE.
-- Add: signed-in users can see their own request.

DROP POLICY IF EXISTS "Anyone can read and insert requests" ON public.access_requests;
DROP POLICY IF EXISTS "Authenticated users can manage requests" ON public.access_requests;
DROP POLICY IF EXISTS "Anyone can submit requests" ON public.access_requests; -- duplicate of anon_insert_access_requests
DROP POLICY IF EXISTS "users_read_own_access_request" ON public.access_requests;
CREATE POLICY "users_read_own_access_request"
  ON public.access_requests FOR SELECT
  USING (email = lower(auth.jwt() ->> 'email'));

-- ── 4. Cut-list / auditor shared tables ──────────────────────
-- jobs: already has allowlisted_access_jobs (FOR ALL). Just drop the anon ones.
-- Any allowlisted user may read/write jobs — the calendar (member) writes
-- signatures/links, cut-list "configuring" builds jobs, the auditor writes
-- confirmations.
DROP POLICY IF EXISTS "anon_all" ON public.jobs;
DROP POLICY IF EXISTS "jobs anon full access" ON public.jobs;

-- app_settings: allowlisted read (exists), admin write (exists),
-- + cut-list/auditor roles write (rules, catalog blobs, offsets, exclusions).
DROP POLICY IF EXISTS "anon_all" ON public.app_settings;
DROP POLICY IF EXISTS "app_settings anon full access" ON public.app_settings;
DROP POLICY IF EXISTS "cutlist_write_app_settings" ON public.app_settings;
CREATE POLICY "cutlist_write_app_settings"
  ON public.app_settings FOR ALL
  USING (public.has_any_role(ARRAY['configuring','configuring-editing']))
  WITH CHECK (public.has_any_role(ARRAY['configuring','configuring-editing']));

-- catalog_items: allowlisted read (exists), admin write (exists), + cut-list write.
DROP POLICY IF EXISTS "catalog_items anon full access" ON public.catalog_items;
DROP POLICY IF EXISTS "cutlist_write_catalog_items" ON public.catalog_items;
CREATE POLICY "cutlist_write_catalog_items"
  ON public.catalog_items FOR ALL
  USING (public.has_any_role(ARRAY['configuring','configuring-editing']))
  WITH CHECK (public.has_any_role(ARRAY['configuring','configuring-editing']));

-- order_history
DROP POLICY IF EXISTS "Allow full access to order_history" ON public.order_history;
DROP POLICY IF EXISTS "order_history anon full access" ON public.order_history;
DROP POLICY IF EXISTS "allowlisted_read_order_history" ON public.order_history;
DROP POLICY IF EXISTS "cutlist_write_order_history" ON public.order_history;
CREATE POLICY "allowlisted_read_order_history"
  ON public.order_history FOR SELECT USING (public.is_allowlisted());
CREATE POLICY "cutlist_write_order_history"
  ON public.order_history FOR ALL
  USING (public.has_any_role(ARRAY['admin','configuring','configuring-editing']))
  WITH CHECK (public.has_any_role(ARRAY['admin','configuring','configuring-editing']));

-- trim_purchase_orders: allowlisted_access_trim_purchase_orders (FOR ALL) exists.
DROP POLICY IF EXISTS "trim_po full access" ON public.trim_purchase_orders;

-- trim_order_readiness / trim_order_holds / trim_order_events /
-- standalone_trim_orders / shop_inventory_*: allowlisted read, cut-list write.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'trim_order_readiness', 'trim_order_holds', 'trim_order_events',
    'standalone_trim_orders',
    'shop_inventory_imports', 'shop_inventory_stock', 'shop_inventory_allocations'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      -- Live open policy names for these tables:
      EXECUTE format('DROP POLICY IF EXISTS "trim_readiness full access" ON public.%I', t);
      EXECUTE format('DROP POLICY IF EXISTS "trim_holds full access" ON public.%I', t);
      EXECUTE format('DROP POLICY IF EXISTS "trim_events full access" ON public.%I', t);
      EXECUTE format('DROP POLICY IF EXISTS "standalone_trim_orders full access" ON public.%I', t);
      EXECUTE format('DROP POLICY IF EXISTS "Allow all on %s" ON public.%I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS "allowlisted_read_%s" ON public.%I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS "cutlist_write_%s" ON public.%I', t, t);
      EXECUTE format(
        'CREATE POLICY "allowlisted_read_%s" ON public.%I FOR SELECT USING (public.is_allowlisted())', t, t);
      EXECUTE format(
        'CREATE POLICY "cutlist_write_%s" ON public.%I FOR ALL
           USING (public.has_any_role(ARRAY[''admin'',''configuring'',''configuring-editing'']))
           WITH CHECK (public.has_any_role(ARRAY[''admin'',''configuring'',''configuring-editing'']))', t, t);
    END IF;
  END LOOP;
END $$;

-- ── 5. Calendar tables that were open ────────────────────────

-- work_orders: allowlisted read + admin write exist. Drop anon; add the
-- scheduling roles' write path (RBANWO-Scheduling upserts/updates work_orders
-- for rForce imports, geocodes and scheduler notes).
DROP POLICY IF EXISTS "work_orders anon full access" ON public.work_orders;
DROP POLICY IF EXISTS "scheduling_insert_work_orders" ON public.work_orders;
DROP POLICY IF EXISTS "scheduling_update_work_orders" ON public.work_orders;
CREATE POLICY "scheduling_insert_work_orders"
  ON public.work_orders FOR INSERT
  WITH CHECK (public.has_any_role(ARRAY['scheduling','scheduling_manager']));
CREATE POLICY "scheduling_update_work_orders"
  ON public.work_orders FOR UPDATE
  USING (public.has_any_role(ARRAY['scheduling','scheduling_manager']))
  WITH CHECK (public.has_any_role(ARRAY['scheduling','scheduling_manager']));

-- employees: admin/payroll-admin write exists. Drop open; add allowlisted
-- read and field-manager write (canManageTimeOff in the calendar app).
DROP POLICY IF EXISTS "Allow all access" ON public.employees;
DROP POLICY IF EXISTS "allowlisted_read_employees" ON public.employees;
DROP POLICY IF EXISTS "field_manager_write_employees" ON public.employees;
CREATE POLICY "allowlisted_read_employees"
  ON public.employees FOR SELECT USING (public.is_allowlisted());
CREATE POLICY "field_manager_write_employees"
  ON public.employees FOR ALL
  USING (public.has_any_role(ARRAY['field-manager']))
  WITH CHECK (public.has_any_role(ARRAY['field-manager']));

-- time_off_requests: admin/payroll-admin write exists. Drop open; add
-- allowlisted read and write for field-manager + the scheduling roles
-- (RBANWO-Scheduling creates/edits time-off from its calendar).
DROP POLICY IF EXISTS "Allow all access" ON public.time_off_requests;
DROP POLICY IF EXISTS "allowlisted_read_time_off" ON public.time_off_requests;
DROP POLICY IF EXISTS "managers_write_time_off" ON public.time_off_requests;
CREATE POLICY "allowlisted_read_time_off"
  ON public.time_off_requests FOR SELECT USING (public.is_allowlisted());
CREATE POLICY "managers_write_time_off"
  ON public.time_off_requests FOR ALL
  USING (public.has_any_role(ARRAY['field-manager','scheduling','scheduling_manager']))
  WITH CHECK (public.has_any_role(ARRAY['field-manager','scheduling','scheduling_manager']));

-- import_logs: only ever touched through the service-role key (which
-- bypasses RLS), so it needs NO policies. Drop the open ones.
DROP POLICY IF EXISTS "Anyone can read import logs" ON public.import_logs;
DROP POLICY IF EXISTS "Service role can delete import logs" ON public.import_logs;
DROP POLICY IF EXISTS "Service role can insert import logs" ON public.import_logs;

-- ── 6. RBANWO-Scheduling tables ──────────────────────────────
-- Every policy on these tables was USING (true) for anon and/or
-- authenticated. Drop them all and replace with one scoped FOR ALL
-- policy per table for the scheduling roles.
DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sched_appointment_events', 'sched_appointment_links', 'sched_appointment_resources',
    'sched_appointments', 'sched_availability_exceptions', 'sched_availability_rules',
    'sched_calendar_blocks', 'sched_crews', 'sched_csv_imports', 'sched_flag_resolutions',
    'sched_flags', 'sched_geocode_cache', 'sched_import_runs', 'sched_import_snapshots',
    'sched_match_rejections', 'sched_reconciliation_results', 'sched_resource_mappings',
    'sched_rforce_dismissals', 'sched_rforce_orders', 'sched_settings'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
      END LOOP;
      EXECUTE format(
        'CREATE POLICY "scheduling_roles_all_%s" ON public.%I FOR ALL
           USING (public.has_any_role(ARRAY[''admin'',''scheduling'',''scheduling_manager'']))
           WITH CHECK (public.has_any_role(ARRAY[''admin'',''scheduling'',''scheduling_manager'']))', t, t);
    END IF;
  END LOOP;
END $$;

-- sched_profiles: keep own-row update + admin manage; replace the
-- "any authenticated account can read all profiles" policy.
DROP POLICY IF EXISTS "Users can read all profiles" ON public.sched_profiles;
DROP POLICY IF EXISTS "allowlisted_read_sched_profiles" ON public.sched_profiles;
CREATE POLICY "allowlisted_read_sched_profiles"
  ON public.sched_profiles FOR SELECT USING (public.is_allowlisted());

-- sched_user_preferences: already scoped to auth.uid() — unchanged.

COMMIT;

-- ── Verify (run separately after COMMIT) ─────────────────────
-- Should return ZERO rows. Any row = a table still open to anon/public.
--
-- SELECT tablename, policyname, roles, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND (qual = 'true' OR qual IS NULL)
--   AND (with_check = 'true' OR with_check IS NULL)
--   AND NOT (tablename = 'access_requests' AND cmd = 'INSERT')
-- ORDER BY 1, 2;
