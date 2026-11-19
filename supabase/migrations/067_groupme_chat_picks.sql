-- ============================================================
-- Migration 067: Each person picks which of their own GroupMe
-- groups show in the Chat tab
--
-- Replaces the shared installer -> group links (installer_chats,
-- 025/025c) and the per-installer read markers (installer_chat_reads,
-- 025b). Since every person now signs in to THEIR OWN GroupMe, the
-- shared list made no sense: Chat now shows the groups that person
-- ticked, under GroupMe's own group names.
--
-- One row per (Duck Force user, GroupMe group they ticked).
--
-- WHAT THIS STORES
--   The group's id and name (so the list can draw before GroupMe
--   answers) and the id of the newest message that person has seen.
--   A bookmark, never message text -- same line 025b drew for the
--   GroupMe API License Agreement §4.5 (no archiving GroupMe data).
--
-- ACCESS
--   service_role only, like groupme_tokens. Everything goes through
--   /api/groupme/*, which checks the person's own GroupMe account is
--   in the group before reading or sending.
--
-- The old installer_chats / installer_chat_reads tables are left in
-- place (nothing reads them any more). Drop them later if wanted.
--
-- Run in Supabase SQL Editor. Idempotent.
-- ============================================================

begin;

create table if not exists public.groupme_chat_picks (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- GroupMe's id for the group. Opaque string.
  group_id text not null,
  -- GroupMe's name for it when ticked; refreshed from GroupMe on load.
  group_name text,
  -- Newest message id this person has seen. null = no bookmark yet.
  last_read_message_id text,
  picked_at timestamptz not null default now(),
  primary key (user_id, group_id)
);

create index if not exists groupme_chat_picks_user_idx
  on public.groupme_chat_picks (user_id);

alter table public.groupme_chat_picks enable row level security;

-- No policies: service_role bypasses RLS, nothing else should reach it.
revoke all on public.groupme_chat_picks from anon;
revoke all on public.groupme_chat_picks from authenticated;
grant select, insert, update, delete
  on public.groupme_chat_picks to service_role;

commit;

-- ── Verify (run separately) ──────────────────────────────────
-- Should list service_role and NOTHING else:
--
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'groupme_chat_picks'
--    order by grantee, privilege_type;
