-- ============================================================
-- Migration 017: Multi-role RLS across every table
--
-- Problem: almost every RLS policy gates on get_user_role(), which
-- returns only the single PRIMARY role from allowed_emails.role. An
-- account that holds a qualifying role as a SECONDARY role (e.g.
-- primary "member" + also "field-manager", or primary "payroll-admin"
-- + also "admin") is wrongly blocked at the database level.
--
-- Fix: switch every ROLE-SPECIFIC check to has_role() (migration 004),
-- which checks BOTH the multi-role array (roles) AND the legacy primary
-- column (role). Access becomes the UNION of every held role's "yeses",
-- exactly mirroring the client gates in src/lib/roles.ts and the server
-- gate in src/lib/auth.ts (requireRole).
--
-- NOT changed: "get_user_role() IS NOT NULL" checks — those only mean
-- "is this user on the allowlist", not a specific role, and stay correct.
-- Migration 016 (legacy_install_links) already uses has_role(); untouched.
--
-- The payroll-admin UPDATE-on-allowed_emails policy stays DROPPED
-- (migration 014 lockdown): only admins may change/delete roles.
--
-- Idempotent — safe to re-run. Run in Supabase SQL Editor AFTER 016.
-- ============================================================

-- ── allowed_emails ──
-- Admin full access (role edits + deletes stay admin-only, per 014).
drop policy if exists "admins_full_access_allowed_emails" on public.allowed_emails;
create policy "admins_full_access_allowed_emails"
  on public.allowed_emails
  for all
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

-- Payroll admins: read the team list.
drop policy if exists "payroll_admin_read_allowed_emails" on public.allowed_emails;
create policy "payroll_admin_read_allowed_emails"
  on public.allowed_emails
  for select
  using (public.has_role('payroll-admin'));

-- Payroll admins: add new team members (no UPDATE/DELETE — see 014).
drop policy if exists "payroll_admin_insert_allowed_emails" on public.allowed_emails;
create policy "payroll_admin_insert_allowed_emails"
  on public.allowed_emails
  for insert
  with check (public.has_role('payroll-admin'));

-- ── access_requests ──
drop policy if exists "admins_manage_access_requests" on public.access_requests;
create policy "admins_manage_access_requests"
  on public.access_requests
  for all
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

drop policy if exists "payroll_admin_read_access_requests" on public.access_requests;
create policy "payroll_admin_read_access_requests"
  on public.access_requests
  for select
  using (public.has_role('payroll-admin'));

drop policy if exists "payroll_admin_delete_access_requests" on public.access_requests;
create policy "payroll_admin_delete_access_requests"
  on public.access_requests
  for delete
  using (public.has_role('payroll-admin'));

-- ── work_orders ──
drop policy if exists "admins_write_work_orders" on public.work_orders;
create policy "admins_write_work_orders"
  on public.work_orders
  for all
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

-- ── action_settings ──
drop policy if exists "admins_write_action_settings" on public.action_settings;
create policy "admins_write_action_settings"
  on public.action_settings
  for all
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

-- ── time_off_requests (admin + payroll-admin) ──
drop policy if exists "admin_payroll_manage_time_off" on public.time_off_requests;
create policy "admin_payroll_manage_time_off"
  on public.time_off_requests
  for all
  using (public.has_role('admin') or public.has_role('payroll-admin'))
  with check (public.has_role('admin') or public.has_role('payroll-admin'));

-- ── employees (admin + payroll-admin) ──
drop policy if exists "admin_payroll_manage_employees" on public.employees;
create policy "admin_payroll_manage_employees"
  on public.employees
  for all
  using (public.has_role('admin') or public.has_role('payroll-admin'))
  with check (public.has_role('admin') or public.has_role('payroll-admin'));

-- ── parts_catalog ──
drop policy if exists "admins_write_parts_catalog" on public.parts_catalog;
create policy "admins_write_parts_catalog"
  on public.parts_catalog
  for all
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

-- ── field_work_orders (write-ups) ──
-- Insert: field workers (admin + field-manager).
drop policy if exists "field_workers_insert_field_work_orders" on public.field_work_orders;
create policy "field_workers_insert_field_work_orders"
  on public.field_work_orders
  for insert
  with check (public.has_role('admin') or public.has_role('field-manager'));

-- Update: field workers + office review (admin + field-manager + payroll-admin).
drop policy if exists "manage_update_field_work_orders" on public.field_work_orders;
create policy "manage_update_field_work_orders"
  on public.field_work_orders
  for update
  using (public.has_role('admin') or public.has_role('field-manager') or public.has_role('payroll-admin'))
  with check (public.has_role('admin') or public.has_role('field-manager') or public.has_role('payroll-admin'));

-- Delete: editors (admin + field-manager).
drop policy if exists "editors_delete_field_work_orders" on public.field_work_orders;
create policy "editors_delete_field_work_orders"
  on public.field_work_orders
  for delete
  using (public.has_role('admin') or public.has_role('field-manager'));

-- ── storage.objects (writeup-photos bucket) ──
drop policy if exists "fieldworkers_insert_writeup_photos" on storage.objects;
create policy "fieldworkers_insert_writeup_photos"
  on storage.objects
  for insert
  with check (
    bucket_id = 'writeup-photos'
    and (public.has_role('admin') or public.has_role('field-manager'))
  );

drop policy if exists "fieldworkers_delete_writeup_photos" on storage.objects;
create policy "fieldworkers_delete_writeup_photos"
  on storage.objects
  for delete
  using (
    bucket_id = 'writeup-photos'
    and (public.has_role('admin') or public.has_role('field-manager'))
  );

-- ── Conditional tables (created only in some deployments) ──
-- app_settings
do $$ begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'app_settings') then
    drop policy if exists "admins_write_app_settings" on public.app_settings;
    execute 'create policy "admins_write_app_settings" on public.app_settings
             for all using (public.has_role(''admin'')) with check (public.has_role(''admin''))';
  end if;
end $$;

-- catalog_items
do $$ begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'catalog_items') then
    drop policy if exists "admins_write_catalog_items" on public.catalog_items;
    execute 'create policy "admins_write_catalog_items" on public.catalog_items
             for all using (public.has_role(''admin'')) with check (public.has_role(''admin''))';
  end if;
end $$;
