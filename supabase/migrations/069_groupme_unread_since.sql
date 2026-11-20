-- ============================================================
-- Migration 069: When did each chat go unread?
--
-- The Chat list colors each unread chat by how long it has been
-- waiting: green under an hour, then yellow-green, yellow, orange,
-- and red from 4 hours. The clock starts at the FIRST message you
-- haven't read, so a chat ignored since 9am keeps getting redder
-- even if more messages arrive later.
--
--   groupme_chat_picks.unread_since
--     Time of the first unread message from someone else. Set by
--     /api/groupme/unread the first time it sees the chat unread;
--     cleared when you read the chat. A time only, never message
--     text (GroupMe licence §4.5, same as 025b/067/068).
--
-- Per person, like the rest of groupme_chat_picks.
-- Run in Supabase SQL Editor AFTER 068. Idempotent.
-- ============================================================

begin;

alter table public.groupme_chat_picks
  add column if not exists unread_since timestamptz;

commit;
