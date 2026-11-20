-- ============================================================
-- Migration 071: The Duck Force bot in GroupMe chats
--
-- Anyone with Chat access can add a "Duck Force" bot to a GroupMe
-- group they're in -- ONCE per group, and it works for everybody.
-- GroupMe then hands the bot every new message the moment it is
-- sent (to /api/groupme/bot), so Duck Force can:
--   * buzz people instantly instead of on the once-a-minute check
--   * keep an unread COUNT per person per chat
--   * know which installer the chat belongs to, so the job card's
--     Messages button can show that count and open the chat.
--
--   groupme_bots            one row per group that has the bot
--     group_id              GroupMe's group id
--     bot_id                GroupMe's bot id (needed to remove it)
--     callback_key          random secret in the address GroupMe
--                           posts to; a post without it is ignored,
--                           so nobody can fake messages
--     installer_name        the calendar installer this chat is for
--                           (null = not tied to an installer)
--     added_by_user/email   who added it (the bot belongs to their
--                           GroupMe account)
--
--   groupme_chat_picks.unread_count
--     How many messages from others arrived since this person last
--     read the chat. Counted by the bot; reset when they read it.
--
--   groupme_bot_message(...)
--     Records one new message for everyone who ticked that chat, in
--     one statement (so two messages at once can't lose a count),
--     and returns who to buzz. The sender is skipped.
--
-- Nothing here stores message text (GroupMe licence §4.5).
-- ACCESS: server only (service role), like the other GroupMe tables.
-- Run in Supabase SQL Editor AFTER 070. Idempotent.
-- ============================================================

begin;

create table if not exists public.groupme_bots (
  group_id          text primary key,
  bot_id            text not null,
  callback_key      text not null,
  group_name        text,
  installer_name    text,
  added_by_user     uuid references auth.users (id) on delete set null,
  added_by_email    text,
  created_at        timestamptz not null default now()
);

create index if not exists groupme_bots_installer_idx
  on public.groupme_bots (lower(installer_name));

alter table public.groupme_bots enable row level security;
revoke all on public.groupme_bots from anon;
revoke all on public.groupme_bots from authenticated;
grant select, insert, update, delete on public.groupme_bots to service_role;

alter table public.groupme_chat_picks
  add column if not exists unread_count integer not null default 0;

create or replace function public.groupme_bot_message(
  p_group_id   text,
  p_message_id text,
  p_sender_id  text,
  p_created_at timestamptz
)
returns table (
  user_id         uuid,
  email           text,
  unread_count    integer,
  notify_messages boolean
)
language sql
security definer
set search_path = public
as $$
  update public.groupme_chat_picks p
     set unread_count             = p.unread_count + 1,
         unread_since             = coalesce(p.unread_since, p_created_at),
         -- Stops the once-a-minute check buzzing for it a second time.
         last_notified_message_id = p_message_id
    from public.groupme_tokens t
   where p.group_id = p_group_id
     and t.user_id = p.user_id
     and coalesce(t.groupme_user_id, '') <> coalesce(p_sender_id, '')
  returning p.user_id, t.email, p.unread_count, t.notify_messages;
$$;

revoke all on function public.groupme_bot_message(text, text, text, timestamptz) from public;
revoke all on function public.groupme_bot_message(text, text, text, timestamptz) from anon;
revoke all on function public.groupme_bot_message(text, text, text, timestamptz) from authenticated;
grant execute on function public.groupme_bot_message(text, text, text, timestamptz) to service_role;

commit;

-- ── Verify (run separately) ──────────────────────────────────
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'groupme_bots';
--   (service_role and postgres only)
