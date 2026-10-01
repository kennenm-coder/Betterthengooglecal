-- ============================================================
-- Migration 027: Allow chats that aren't tied to an installer
--
-- installer_chats started life as "installer name -> GroupMe
-- group". Some useful conversations aren't about one installer
-- at all -- an office group, a scheduling group, a vendor -- and
-- those should sit in the Chat tab alongside the rest.
--
-- Rather than a second table, this adds a flag. The primary key
-- stays installer_name because:
--   * it is already the lookup key every /api/groupme/* route
--     resolves against, and the value IS the label shown on
--     screen either way;
--   * installer_chat_reads keys its per-user bookmarks on the
--     same string, so a rename would mean migrating that too,
--     for no behavioural gain.
--
-- Read installer_name as "the name this conversation shows
-- under". For installer rows it must match the calendar's
-- spelling exactly; for other rows it is free text.
--
-- Run in Supabase SQL Editor AFTER 026. Idempotent.
-- ============================================================

begin;

-- true  = a lead installer, name matches work_orders.installer
-- false = any other conversation, name is just a label
alter table public.installer_chats
  add column if not exists is_installer boolean not null default true;

comment on column public.installer_chats.is_installer is
  'true when installer_name is a calendar installer; false for free-label chats (office, vendors, etc).';

comment on column public.installer_chats.installer_name is
  'Display label AND lookup key. Must match work_orders.installer exactly when is_installer is true.';

commit;

-- ── Verify (run separately) ──────────────────────────────────
--   select installer_name, is_installer, groupme_group_name
--     from public.installer_chats
--    order by is_installer desc, installer_name;
