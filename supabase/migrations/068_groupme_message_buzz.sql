-- ============================================================
-- Migration 068: Phone buzz for new GroupMe messages
--
-- A once-a-minute check (/api/cron/groupme) looks at each person's
-- ticked chats (groupme_chat_picks, 067) and buzzes their phone when
-- one has new messages: ONE buzz per chat per check ("5 new messages",
-- with the newest one as the preview), never one per message.
--
--   groupme_tokens.notify_messages
--     The person's on/off switch on the Chat tab. On by default.
--
--   groupme_chat_picks.last_notified_message_id
--     The newest message they were already buzzed about, so the same
--     messages never buzz twice. An id only, never message text --
--     same GroupMe licence line (§4.5) as 025b/067. For the same
--     reason these buzzes are push only and are NOT saved to the
--     bell's history (notifications table).
--
-- Run in Supabase SQL Editor AFTER 067. Idempotent.
-- ============================================================

begin;

alter table public.groupme_tokens
  add column if not exists notify_messages boolean not null default true;

alter table public.groupme_chat_picks
  add column if not exists last_notified_message_id text;

commit;
