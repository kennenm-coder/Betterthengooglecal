-- ============================================================
-- verify_migrations.sql — which migrations are actually applied?
--
-- Migrations in this repo are applied BY HAND in the Supabase SQL
-- editor and nothing records what has been run. This answers the
-- question by inspecting the catalogs: for each migration it looks
-- for the object (or the CONTENT) that only that migration could
-- have produced.
--
-- READ ONLY. It touches information_schema, pg_catalog and
-- storage.buckets, writes nothing and reads no application data.
-- Safe to run any time, on any environment.
--
-- Paste the whole file into the SQL editor and run. One row per
-- migration, worst news first.
--
-- ── Two traps this script is built around ───────────────────
--
-- 1. SUPERSESSION. Nearly every migration here is written to be
--    re-runnable (DROP POLICY IF EXISTS / CREATE OR REPLACE /
--    ADD COLUMN IF NOT EXISTS). So an object's NAME existing does
--    not prove the migration that introduced it ran, and an object
--    being ABSENT does not prove its migration did not. 002's
--    anyone_read_allowed_emails is gone because 003 deliberately
--    drops it. Where a later migration only widens or redefines an
--    earlier object, the check below tests the CHANGED CONTENT.
--
-- 2. TWO ROLE HELPERS. 016 and 017 use has_role('x') — singular,
--    one call per role, OR'd. 019 and everything after use
--    has_any_role(array[...]). Testing a live policy for the wrong
--    one reports a false NOT APPLIED.
--
-- ── Verdicts ────────────────────────────────────────────────
--   APPLIED      the distinguishing object/content is present
--   NOT APPLIED  it is absent — this migration has not been run
--   SUPERSEDED   a later migration deliberately replaced or
--                removed what this one did; its absence is correct
--   CANNOT TELL  no structural trace distinguishes it from a
--                neighbour; judge by hand
--
-- A NOT APPLIED row is NOT an instruction to re-run that file.
-- Re-running an early migration reverts later ones — 019 would
-- re-narrow the policy 038 widened, and 001/003 would recreate
-- allowlisted_read_work_orders and allowlisted_access_jobs without
-- their NOT is_installer() clause, silently undoing the installer
-- role. Fix a genuine gap with a NEW migration.
--
-- Housekeeping: there is no 025 (numbering gap), and there are two
-- 004s (004_payroll_admin_team_access and 004_scheduling_roles).
--
-- Last full run: 2026-10-15 — every migration 001-038 applied.
-- 039 applied 2026-10-23 (index confirmed present in pg_indexes).
-- 040 applied 2026-10-29 (table confirmed present, 702 rows imported).
-- 041 and 042 applied 2026-10-29 (both verified live).
-- 043 written 2026-10-29 — not yet applied at the time of writing.
-- ============================================================

with
col as (select table_name || '.' || column_name as k
          from information_schema.columns where table_schema = 'public'),
fn  as (select p.proname as k, pg_get_functiondef(p.oid) as src
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'),
tbl as (select table_name as k
          from information_schema.tables where table_schema = 'public'),
vw  as (select viewname as k from pg_views where schemaname = 'public'),
bkt as (select id as k from storage.buckets),
pol as (select tablename as t, policyname as p,
               coalesce(qual, '') || ' ' || coalesce(with_check, '') as body
          from pg_policies),
idx as (select indexname as k from pg_indexes where schemaname = 'public'),
grt as (select distinct table_name as k
          from information_schema.role_table_grants
         where table_schema = 'public' and grantee = 'authenticated'
           and privilege_type = 'SELECT'),
checks(migration, feature, verdict, checked) as (values

 ('001', 'base RLS + get_user_role',
  case when exists(select 1 from fn where k = 'get_user_role')
       then 'CANNOT TELL' else 'NOT APPLIED' end,
  'get_user_role() exists, but 003 redefines it — cannot separate 001 from 003'),

 ('002', 'public read of allowed_emails (pre-signup check)',
  case when exists(select 1 from pol where t = 'allowed_emails' and p = 'anyone_read_allowed_emails')
       then 'APPLIED' else 'SUPERSEDED' end,
  'anyone_read_allowed_emails — 003 drops this on purpose, so absent is correct'),

 ('003', 'close the auth hole (allowlist no longer world-readable)',
  case when exists(select 1 from pol where t = 'allowed_emails' and p = 'users_read_own_allowed_email')
        and not exists(select 1 from pol where t = 'allowed_emails' and p = 'anyone_read_allowed_emails')
       then 'APPLIED' else 'NOT APPLIED' end,
  'users_read_own_allowed_email present AND anyone_read_allowed_emails gone'),

 ('004-payroll', 'payroll-admin team access',
  case when exists(select 1 from pol where t = 'allowed_emails' and p = 'payroll_admin_read_allowed_emails')
       then 'APPLIED' else 'NOT APPLIED' end,
  'payroll_admin_read_allowed_emails (017 also recreates it)'),

 ('004-sched', 'multi-role column + scheduling roles',
  case when exists(select 1 from col where k = 'allowed_emails.roles')
        and exists(select 1 from fn where k = 'can_access_scheduling')
       then 'APPLIED' else 'NOT APPLIED' end,
  'allowed_emails.roles + can_access_scheduling() — nothing later creates that function'),

 ('005', 'field_work_orders table',
  case when exists(select 1 from tbl where k = 'field_work_orders')
       then 'APPLIED' else 'NOT APPLIED' end,
  'field_work_orders table'),

 ('006', 'write-up photos + new_product',
  case when exists(select 1 from col where k = 'field_work_orders.photos')
        and exists(select 1 from bkt where k = 'writeup-photos')
       then 'APPLIED' else 'NOT APPLIED' end,
  'field_work_orders.photos + writeup-photos storage bucket'),

 ('007', 'fix write-up RLS',
  case when exists(select 1 from pol where t = 'field_work_orders'
                     and p = 'field_workers_insert_field_work_orders'
                     and body like '%has_role%')
       then 'SUPERSEDED'
       when exists(select 1 from pol where t = 'field_work_orders'
                     and p = 'field_workers_insert_field_work_orders'
                     and body like '%get_user_role%')
       then 'APPLIED' else 'NOT APPLIED' end,
  'its policies now use has_role (017 rewrote them); get_user_role would mean 007 is still the live version'),

 ('008', 'write-up updated_by',
  case when exists(select 1 from col where k = 'field_work_orders.updated_by')
        and exists(select 1 from col where k = 'field_work_orders.updated_by_name')
       then 'APPLIED' else 'NOT APPLIED' end,
  'field_work_orders.updated_by + updated_by_name'),

 ('009', 'write-up photo delete',
  case when exists(select 1 from pol where p = 'fieldworkers_delete_writeup_photos')
       then 'APPLIED' else 'NOT APPLIED' end,
  'storage policy fieldworkers_delete_writeup_photos (017 also recreates it)'),

 ('010', 'write-up delete',
  case when exists(select 1 from pol where t = 'field_work_orders' and p = 'editors_delete_field_work_orders')
       then 'APPLIED' else 'NOT APPLIED' end,
  'editors_delete_field_work_orders (017 also recreates it)'),

 ('011', 'parts catalog',
  case when exists(select 1 from tbl where k = 'parts_catalog')
       then 'APPLIED' else 'NOT APPLIED' end,
  'parts_catalog table'),

 ('012', 'jobs signature',
  case when exists(select 1 from fn where k = 'jobs_signature')
       then 'CANNOT TELL' else 'NOT APPLIED' end,
  'jobs_signature() exists, but 021 replaces it — see the 021 row'),

 ('013', 'write-up batches',
  case when exists(select 1 from col where k = 'field_work_orders.batch_id')
       then 'APPLIED' else 'NOT APPLIED' end,
  'field_work_orders.batch_id'),

 ('014', 'lock role changes to admin',
  case when not exists(select 1 from pol where t = 'allowed_emails' and p = 'payroll_admin_update_allowed_emails')
       then 'APPLIED' else 'NOT APPLIED' end,
  'payroll_admin_update_allowed_emails must be ABSENT — 014 only drops it'),

 ('015', 'legacy install links',
  case when exists(select 1 from tbl where k = 'legacy_install_links')
       then 'APPLIED' else 'NOT APPLIED' end,
  'legacy_install_links table'),

 ('016', 'legacy links multi-role',
  case when exists(select 1 from pol where t = 'legacy_install_links'
                     and p = 'scheduling_insert_legacy_links' and body like '%has_role%')
       then 'APPLIED' else 'NOT APPLIED' end,
  'scheduling_insert_legacy_links uses has_role (NOT has_any_role — see trap 2)'),

 ('017', 'multi-role RLS everywhere',
  case when exists(select 1 from pol where t = 'field_work_orders'
                     and p = 'field_workers_insert_field_work_orders' and body like '%has_role%')
       then 'APPLIED' else 'NOT APPLIED' end,
  'field_workers_insert_field_work_orders uses has_role (NOT has_any_role — see trap 2)'),

 ('018', 'catalog management',
  case when exists(select 1 from tbl where k = 'work_catalog')
        and exists(select 1 from col where k = 'parts_catalog.variants')
       then 'APPLIED' else 'NOT APPLIED' end,
  'work_catalog table + parts_catalog.variants'),

 ('019', 'lock down shared tables',
  case when exists(select 1 from fn where k = 'has_any_role')
        and exists(select 1 from fn where k = 'is_allowlisted')
       then 'APPLIED' else 'NOT APPLIED' end,
  'has_any_role() + is_allowlisted()'),

 ('020', 'write-up responsibility',
  case when exists(select 1 from col where k = 'field_work_orders.responsibility')
        and exists(select 1 from col where k = 'field_work_orders.defect_code')
       then 'APPLIED' else 'NOT APPLIED' end,
  'responsibility + defect_code columns'),

 ('021', 'jobs updated_at signature',
  case when exists(select 1 from fn where k = 'jobs_touch_updated_at')
       then 'APPLIED' else 'NOT APPLIED' end,
  'jobs_touch_updated_at() — new in 021, so this also distinguishes it from 012'),

 ('022', 'calendar_jobs function',
  case when exists(select 1 from fn where k = 'calendar_jobs')
       then 'APPLIED' else 'NOT APPLIED' end,
  'calendar_jobs()'),

 ('023', 'install docs',
  case when exists(select 1 from tbl where k = 'install_docs')
       then 'APPLIED' else 'NOT APPLIED' end,
  'install_docs table'),

 ('024', 'Data API grants',
  case when (select count(*) from grt
              where k in ('field_work_orders','install_docs','legacy_install_links',
                          'parts_catalog','work_catalog')) = 5
       then 'APPLIED' else 'NOT APPLIED' end,
  'SELECT granted to authenticated on all five tables'),

 ('026', 'floaters: free install leads',
  case when not exists(select 1 from fn where k = 'sched_free_install_leads') then 'NOT APPLIED'
       when exists(select 1 from fn where k = 'sched_free_install_leads' and src like '%effective_start%') then 'SUPERSEDED'
       when exists(select 1 from fn where k = 'sched_free_install_leads' and src ilike '%weekday%') then 'SUPERSEDED'
       else 'APPLIED' end,
  'sched_free_install_leads() exists but 027 and 028 replace it — see those rows'),

 ('027', 'floaters: weekdays only',
  case when exists(select 1 from fn where k = 'sched_free_install_leads' and src like '%effective_start%') then 'SUPERSEDED'
       when exists(select 1 from fn where k = 'sched_free_install_leads' and src ilike '%weekday%') then 'APPLIED'
       else 'NOT APPLIED' end,
  'weekday logic in the function body; 028 replaces it again'),

 ('028', 'floaters: respect availability',
  case when exists(select 1 from fn where k = 'sched_free_install_leads' and src like '%effective_start%')
       then 'APPLIED' else 'NOT APPLIED' end,
  'effective_start in the function body — only 028 reads availability rules'),

 ('029', 'partial-day time off',
  case when exists(select 1 from col where k = 'time_off_requests.start_time')
        and exists(select 1 from col where k = 'time_off_requests.end_time')
       then 'APPLIED' else 'NOT APPLIED' end,
  'time_off_requests.start_time + end_time'),

 ('030', 'parts catalog multi-role write',
  case when exists(select 1 from pol where t = 'parts_catalog'
                     and p = 'editors_write_parts_catalog' and body like '%has_any_role%')
       then 'APPLIED' else 'NOT APPLIED' end,
  'editors_write_parts_catalog uses has_any_role (019-era helper)'),

 ('031', 'parts pricing, bundles, photos',
  case when exists(select 1 from tbl where k = 'parts_bundles')
        and exists(select 1 from col where k = 'parts_catalog.price')
        and exists(select 1 from bkt where k = 'catalog-photos')
       then 'APPLIED' else 'NOT APPLIED' end,
  'parts_bundles table + parts_catalog.price + catalog-photos bucket'),

 ('032', 'work_orders scheduling columns',
  case when exists(select 1 from col where k = 'work_orders.scheduler_notes')
        and exists(select 1 from col where k = 'work_orders.combined_retail_total')
       then 'APPLIED' else 'NOT APPLIED' end,
  'work_orders.scheduler_notes + combined_retail_total'),

 ('033', 'installer role: login to crew link',
  case when exists(select 1 from col where k = 'allowed_emails.sched_crew_id')
        and exists(select 1 from fn where k = 'is_installer')
        and exists(select 1 from fn where k = 'my_crew_names')
       then 'APPLIED' else 'NOT APPLIED' end,
  'allowed_emails.sched_crew_id + is_installer() + my_crew_names()'),

 ('034', 'write-up suggested crews',
  case when exists(select 1 from col where k = 'field_work_orders.suggested_crews')
        and exists(select 1 from col where k = 'field_work_orders.suggested_crews_all')
       then 'APPLIED' else 'NOT APPLIED' end,
  'suggested_crews + suggested_crews_all'),

 ('035', 'installer trimmed feed (work_orders_visible)',
  case when exists(select 1 from vw where k = 'work_orders_visible')
        and exists(select 1 from fn where k = 'wo_is_mine')
        and exists(select 1 from pol where t = 'work_orders'
                     and p = 'allowlisted_read_work_orders' and body like '%is_installer%')
       then 'APPLIED' else 'NOT APPLIED' end,
  'the view + wo_is_mine() + work_orders read policy excluding installers'),

 ('036', 'installer detail tables',
  case when exists(select 1 from fn where k = 'order_is_mine')
        and exists(select 1 from pol where t = 'jobs'
                     and p = 'allowlisted_access_jobs' and body like '%is_installer%')
       then 'APPLIED' else 'NOT APPLIED' end,
  'order_is_mine() + jobs policy excluding installers'),

 ('037', 'write-up lifecycle nudges',
  case when exists(select 1 from col where k = 'field_work_orders.closed_at')
        and exists(select 1 from col where k = 'field_work_orders.nudge_snoozed_until')
       then 'APPLIED' else 'NOT APPLIED' end,
  'closed_at + nudge_snoozed_until'),

 ('038', 'trim handoff + standalone-trim writes',
  case when exists(select 1 from pol where t = 'standalone_trim_orders'
                     and p = 'fieldmgr_insert_standalone_trim_orders')
        and exists(select 1 from pol where t = 'standalone_trim_orders'
                     and p = 'cutlist_write_standalone_trim_orders' and body like '%standalone-trim%')
       then 'APPLIED' else 'NOT APPLIED' end,
  'the NEW fieldmgr insert policy AND standalone-trim inside the older cut-list policy'),

 ('039', 'active write-ups by address',
  case when exists(select 1 from idx where k = 'idx_field_work_orders_active_address')
       then 'APPLIED' else 'NOT APPLIED' end,
  'the partial index behind the service tiles'' write-up lookup'),

 ('040', 'vendor purchase orders (cost / ETA / dock)',
  case when exists(select 1 from tbl where k = 'purchase_orders')
        and exists(select 1 from fn where k = 'purchase_orders_stamp')
       then 'APPLIED' else 'NOT APPLIED' end,
  'the purchase_orders table AND its stamping trigger function — the table '
  'alone would not prove the trigger half ran'),

 ('041', 'per-order PO rollup for the job cards',
  case when exists(select 1 from fn where k = 'purchase_order_rollup')
       then 'APPLIED' else 'NOT APPLIED' end,
  'the rollup function the material-list job cards read'),

 ('042', 'PO job number split from the sold order',
  case when exists(select 1 from col
                    where k = 'purchase_orders.sold_order_number')
        and exists(select 1 from fn where k = 'purchase_orders_stamp'
                     and src like '%sold_order_number%')
       then 'APPLIED' else 'NOT APPLIED' end,
  'the sold_order_number column AND the trigger rewrite that compares it — '
  'the column alone would leave updated_at lying about what moved'),

 ('043', 'unattended rForce auto-confirm',
  case when exists(select 1 from fn where k = 'rforce_auto_confirm')
       then 'APPLIED' else 'NOT APPLIED' end,
  'the sweep the nightly import and the auditor both call')
)
select migration, feature, verdict, checked
from checks
order by case verdict
           when 'NOT APPLIED' then 1
           when 'CANNOT TELL' then 2
           when 'SUPERSEDED'  then 3
           else 4
         end,
         migration;
