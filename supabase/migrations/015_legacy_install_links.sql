-- ============================================================
-- Migration 015: Legacy install-instruction links
--
-- Lets scheduling / scheduling-manager / admin roles attach a link to
-- the OLD (legacy) install-instruction PDFs (housed in Google Drive) for
-- jobs that are NOT paired with a material-list-app job. When a real
-- material job later links to the order, the real instructions win and
-- the legacy link is deleted (handled client-side).
--
-- Keyed by order_number (= WorkOrder.orderNumber / material job PO), NOT
-- the work_orders row id, so it survives work-order re-imports and applies
-- to every appointment sharing an order.
--
-- Access model (mirrors src/lib/roles.ts canEditLegacyLink):
--   • admin, scheduling, scheduling_manager → set / edit / clear
--   • any allowlisted user                  → read + open the link
--
-- Run in Supabase SQL Editor AFTER 014.
-- ============================================================

create table if not exists public.legacy_install_links (
  order_number text primary key,        -- links to work_orders.order_number
  url text not null,
  updated_by text,                      -- email/name of who last set it
  updated_at timestamptz not null default now()
);

alter table public.legacy_install_links enable row level security;

-- Read: any allowlisted user (field users need to open the link)
drop policy if exists "allowlisted_read_legacy_links" on public.legacy_install_links;
create policy "allowlisted_read_legacy_links"
  on public.legacy_install_links
  for select
  using (public.get_user_role() is not null);

-- Insert: scheduling roles + admin
drop policy if exists "scheduling_insert_legacy_links" on public.legacy_install_links;
create policy "scheduling_insert_legacy_links"
  on public.legacy_install_links
  for insert
  with check (public.get_user_role() in ('admin', 'scheduling', 'scheduling_manager'));

-- Update: scheduling roles + admin
drop policy if exists "scheduling_update_legacy_links" on public.legacy_install_links;
create policy "scheduling_update_legacy_links"
  on public.legacy_install_links
  for update
  using (public.get_user_role() in ('admin', 'scheduling', 'scheduling_manager'))
  with check (public.get_user_role() in ('admin', 'scheduling', 'scheduling_manager'));

-- Delete: scheduling roles + admin (also used for the auto-delete-on-override cleanup)
drop policy if exists "scheduling_delete_legacy_links" on public.legacy_install_links;
create policy "scheduling_delete_legacy_links"
  on public.legacy_install_links
  for delete
  using (public.get_user_role() in ('admin', 'scheduling', 'scheduling_manager'));
