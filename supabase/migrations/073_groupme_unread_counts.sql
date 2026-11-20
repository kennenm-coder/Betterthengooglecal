-- ============================================================
-- Migration 073: An unread COUNT on every chat, bot or not
--
-- 072 counted unread messages only for chats with the Duck Force
-- bot. Now every chosen chat shows how many messages you've missed:
-- when a chat's newest message changes, /api/groupme/unread looks at
-- what arrived since you last read it, counts the ones from other
-- people (up to 100), and saves the number here.
--
--   groupme_chat_picks.unread_counted_id
--     The newest message already included in unread_count, so the
--     count is only redone when something new arrives. Reset when
--     you read the chat. An id only, never message text.
--
--   groupme_bot_message() now also moves unread_counted_id along,
--   so chats with the bot never need re-counting.
--
-- Run in Supabase SQL Editor AFTER 072. Idempotent.
-- ============================================================

begin;

alter table public.groupme_chat_picks
  add column if not exists unread_counted_id text;

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
         last_notified_message_id = p_message_id,
         unread_counted_id        = p_message_id
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
