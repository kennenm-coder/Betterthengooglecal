-- ============================================================
-- Migration 075: GroupMe chats -- individual people + installer link
--
-- GroupMe is now managed from the NWO Hub (Admin -> Apps -> Duck
-- Force settings), which calls Duck Force's /api/hub/groupme routes.
-- Each shared office chat can now be given to:
--   * roles (074), AND/OR
--   * individual Duck Force accounts, by login email (emails)
-- and can name the calendar installer / installer lead it belongs to
-- (installer_name), which drives the job card's Messages button.
--
-- A person still needs the Chat tab (admin or the GroupMe Chat role)
-- to open any chat; access ends with their account like before.
--
-- Server only, like the rest of the GroupMe tables.
-- Run in Supabase SQL Editor AFTER 074. Idempotent.
-- ============================================================

begin;

alter table public.groupme_shared_chats
  add column if not exists emails text[] not null default '{}';

alter table public.groupme_shared_chats
  add column if not exists installer_name text;

commit;
