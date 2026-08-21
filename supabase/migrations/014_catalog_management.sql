-- ============================================================
-- Migration 014: Editable catalogs (parts + works-to-complete)
--
-- 1. Extends parts_catalog into a durable, editable part definition with
--    optional color/size options and a per-variant part-number matrix.
-- 2. Adds a work_catalog table for the "what needs done" list, with an optional
--    time-to-complete per unit.
-- 3. Both catalogs get a `verified` flag: custom entries typed on a write-up are
--    auto-added as unverified for an admin/field-manager to confirm.
-- 4. Field managers (not just admins) can now edit the catalogs.
--
-- Run in Supabase SQL Editor.
-- ============================================================

-- ── parts_catalog: richer, editable ──
alter table public.parts_catalog
  add column if not exists colors text[] not null default '{}',
  add column if not exists sizes text[] not null default '{}',
  -- Per-variant part numbers: [{ "color": "", "size": "", "partNumber": "" }, ...]
  add column if not exists variants jsonb not null default '[]'::jsonb,
  add column if not exists verified boolean not null default true;

-- Field managers can maintain the parts catalog too (and auto-add custom parts).
drop policy if exists "admins_write_parts_catalog" on public.parts_catalog;
drop policy if exists "editors_write_parts_catalog" on public.parts_catalog;
create policy "editors_write_parts_catalog"
  on public.parts_catalog for all
  using (public.get_user_role() in ('admin', 'field-manager'))
  with check (public.get_user_role() in ('admin', 'field-manager'));

-- ── work_catalog: the "what needs done" list ──
create table if not exists public.work_catalog (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  product_type text,                 -- optional scoping (e.g. only Double Hung)
  minutes_per_unit int,              -- optional time-to-complete per unit
  verified boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_work_catalog_active on public.work_catalog (active);

alter table public.work_catalog enable row level security;

drop policy if exists "allowlisted_read_work_catalog" on public.work_catalog;
create policy "allowlisted_read_work_catalog"
  on public.work_catalog for select
  using (public.get_user_role() is not null);

drop policy if exists "editors_write_work_catalog" on public.work_catalog;
create policy "editors_write_work_catalog"
  on public.work_catalog for all
  using (public.get_user_role() in ('admin', 'field-manager'))
  with check (public.get_user_role() in ('admin', 'field-manager'));

-- Seed the default work items (only when the table is empty, so re-running is safe).
insert into public.work_catalog (label)
select v.label
from (values
  ('Redo caulking'),
  ('Recoil'),
  ('Window closes poorly'),
  ('Adjust / align hardware'),
  ('Reseal exterior'),
  ('Replace screen'),
  ('Touch-up paint'),
  ('Missing / damaged part')
) as v(label)
where not exists (select 1 from public.work_catalog);
