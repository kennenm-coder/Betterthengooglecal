-- ============================================================
-- Migration 005: Field write-ups (post-install work orders)
--
-- Adds a field_work_orders table so field managers can flag units
-- that need additional work after an install — preset or custom line
-- items, plus per-unit spec corrections that overlay onto the material
-- job specs shown in the calendar.
--
-- Access model (mirrors src/lib/roles.ts):
--   • admin, field-manager  → create / edit write-ups   (FIELD_WORK_ROLES)
--   • admin, payroll-admin  → review / close (office)
--   • any allowlisted user  → read
--
-- No CHECK constraint on allowed_emails.role, so the new 'field-manager'
-- role needs no schema change — it is just another string value.
--
-- Run in Supabase SQL Editor AFTER 004.
-- ============================================================

create table if not exists public.field_work_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null,          -- links to work_orders.order_number
  work_order_number text,
  job_id text,                         -- jobs.id, when the material job is known
  customer_name text,
  address text,
  unit_label text,                     -- "Unit 101"; null = whole-job write-up
  line_items jsonb not null default '[]'::jsonb,     -- WriteUpLineItem[]
  spec_changes jsonb not null default '[]'::jsonb,   -- SpecChange[]
  material_items jsonb not null default '[]'::jsonb, -- WriteUpMaterialItem[] (trim/catalog to order)
  notes text default '',
  status text not null default 'open', -- 'open' | 'in_review' | 'closed'
  -- Phase 2 (photos)
  photo_count int not null default 0,
  photos_uploaded boolean not null default false,
  photos_delete_after timestamptz,     -- set when office approves; cleanup job deletes past this
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fwo_order_number on public.field_work_orders (order_number);
create index if not exists idx_fwo_status on public.field_work_orders (status);
create index if not exists idx_fwo_job_id on public.field_work_orders (job_id);

alter table public.field_work_orders enable row level security;

-- Read: any allowlisted user (office needs to see them; field needs their own)
drop policy if exists "allowlisted_read_field_work_orders" on public.field_work_orders;
create policy "allowlisted_read_field_work_orders"
  on public.field_work_orders
  for select
  using (public.get_user_role() is not null);

-- Insert: field workers only (admin, field-manager)
drop policy if exists "field_workers_insert_field_work_orders" on public.field_work_orders;
create policy "field_workers_insert_field_work_orders"
  on public.field_work_orders
  for insert
  with check (public.get_user_role() in ('admin', 'field-manager'));

-- Update: field workers (edit their write-up) + office (review/close)
drop policy if exists "manage_update_field_work_orders" on public.field_work_orders;
create policy "manage_update_field_work_orders"
  on public.field_work_orders
  for update
  using (public.get_user_role() in ('admin', 'field-manager', 'payroll-admin'))
  with check (public.get_user_role() in ('admin', 'field-manager', 'payroll-admin'));

-- Delete: admins only (audit-safe)
drop policy if exists "admins_delete_field_work_orders" on public.field_work_orders;
create policy "admins_delete_field_work_orders"
  on public.field_work_orders
  for delete
  using (public.get_user_role() = 'admin');
