-- ============================================================
-- 024 - Data API grants (field calendar tables)
--
-- On 2026-10-30 Supabase stops automatically granting Data API
-- access to NEW tables in the public schema. Tables that already
-- exist keep their grants, so this changes NOTHING about the live
-- database -- running it there is a no-op.
--
-- It matters for a rebuild: a new project, a preview branch, or a
-- local 'supabase db reset'. Without these grants the tables below
-- come back unreachable through the Data API ("permission denied")
-- even though their RLS policies are correct.
--
-- The grants match what the live database has today (verified
-- 2026-09-23 against information_schema.role_table_grants): every
-- public table grants full DML to anon, authenticated and
-- service_role, and RLS policies are the actual gate. A grant here
-- does NOT mean that role may read the data -- the policies decide.
--
-- Any NEW table added after 2026-10-30 needs its own grant block
-- in the same migration that creates it. Copy the pattern below.
--
-- Run in Supabase SQL Editor. Idempotent -- safe to re-run.
-- ============================================================

begin;

grant select, insert, update, delete on public.field_work_orders to anon, authenticated, service_role;
grant select, insert, update, delete on public.install_docs to anon, authenticated, service_role;
grant select, insert, update, delete on public.legacy_install_links to anon, authenticated, service_role;
grant select, insert, update, delete on public.parts_catalog to anon, authenticated, service_role;
grant select, insert, update, delete on public.work_catalog to anon, authenticated, service_role;

commit;

-- Verify (run separately) -- each table below should show all three
-- roles with SELECT/INSERT/UPDATE/DELETE:
--   select table_name, grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and grantee in ('anon','authenticated','service_role')
--    order by table_name, grantee;
