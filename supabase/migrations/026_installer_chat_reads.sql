-- ============================================================
-- Migration 026: Per-user unread markers for installer chat
--
-- Gives every Duck Force account its OWN unread count. Sarah
-- reading Tim's conversation does not clear the badge for Kennen,
-- because each row is keyed by the Duck Force user, not by the
-- shared GroupMe office account everyone sends through.
--
-- WHAT THIS STORES, AND WHY IT IS ALLOWED
--   One row per (user, installer) holding the id of the newest
--   message that user has seen. That is a BOOKMARK, not a copy:
--   no message text, no sender, no timestamp of anything said,
--   nothing that could reconstruct a conversation.
--
--   This matters. The GroupMe API License Agreement §4.5 says
--   "Licensee shall not archive or resell any GroupMe data" and
--   forbids exporting content to a store that replicates theirs.
--   A pointer to a message is not the message. §10.2 expressly
--   contemplates holding our own users' data, which is what a
--   read-position is.
--
--   If anyone later proposes caching message BODIES here to make
--   the badge work while the app is closed, that is the line this
--   table is deliberately staying on the right side of.
--
-- ACCESS
--   service_role only, like groupme_tokens. Not because it is
--   secret, but because the unread count can only be worked out
--   server-side anyway: it needs the latest message ids from
--   GroupMe, which requires the shared token. The client calls
--   /api/groupme/unread and never touches this table, so granting
--   anon/authenticated would be access nothing needs.
--
-- Run in Supabase SQL Editor AFTER 025. Idempotent.
-- ============================================================

begin;

create table if not exists public.installer_chat_reads (
  -- The Duck Force account doing the reading.
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Matches installer_chats.installer_name.
  installer_name text not null,
  -- GroupMe's id for the newest message this user has seen. Opaque
  -- string; we only ever compare it for equality.
  last_read_message_id text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, installer_name)
);

create index if not exists installer_chat_reads_user_idx
  on public.installer_chat_reads (user_id);

alter table public.installer_chat_reads enable row level security;

-- No policies, same reasoning as groupme_tokens: service_role
-- bypasses RLS and nothing else should reach this table at all.
revoke all on public.installer_chat_reads from anon;
revoke all on public.installer_chat_reads from authenticated;
grant select, insert, update, delete
  on public.installer_chat_reads to service_role;

commit;

-- ── Verify (run separately) ──────────────────────────────────
-- Should list service_role and NOTHING else:
--
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'installer_chat_reads'
--    order by grantee, privilege_type;
