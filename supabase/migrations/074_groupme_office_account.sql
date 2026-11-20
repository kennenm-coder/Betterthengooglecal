-- ============================================================
-- Migration 074: The office GroupMe account + chats shared by role
--
-- Everyone with the Chat role gets GroupMe chats as soon as they sign
-- in to Duck Force -- no GroupMe sign-in. An admin connects ONE office
-- GroupMe account and picks which of its chats each ROLE can see.
-- Lose the role, or have your Duck Force account removed, and those
-- chats are gone: nobody has to take you out of groups one by one.
-- Admins may still sign in with their own GroupMe as well.
--
-- Messages sent through the office account show in GroupMe as
-- "RBANWO Office" with the sender's name in front ("Kennen M: ...").
-- Duck Force tags each one (GroupMe's source_guid) so it can show the
-- right person above the message and treat it as theirs.
--
--   groupme_office          one row: the office account's encrypted token
--   groupme_shared_chats    office chats and the roles that see each
--   groupme_sent            who in Duck Force sent each office message:
--                           ids + name only, never the text (GroupMe
--                           licence §4.5)
--   groupme_prefs           per person "buzz me for GroupMe" switch,
--                           now independent of a personal sign-in
--   groupme_chat_picks.source
--                           'personal' (your own GroupMe) or 'office'
--   groupme_bot_message()   now counts/buzzes office-chat people too,
--                           and skips the real sender of an office
--                           message (p_exclude_user)
--
-- ACCESS: server only (service role), like the other GroupMe tables.
-- Run in Supabase SQL Editor AFTER 073. Idempotent.
-- ============================================================

begin;

create table if not exists public.groupme_office (
  id                     smallint primary key default 1 check (id = 1),
  access_token_encrypted text not null,
  groupme_user_id        text,
  groupme_name           text,
  connected_by_email     text,
  connected_at           timestamptz not null default now()
);

create table if not exists public.groupme_shared_chats (
  group_id         text primary key,
  group_name       text,
  roles            text[] not null default '{}',
  updated_by_email text,
  updated_at       timestamptz not null default now()
);

create table if not exists public.groupme_sent (
  source_guid    text primary key,
  group_id       text not null,
  message_id     text,
  sender_user_id uuid references auth.users (id) on delete set null,
  sender_email   text,
  sender_name    text,
  created_at     timestamptz not null default now()
);
create index if not exists groupme_sent_group_idx on public.groupme_sent (group_id, created_at desc);

create table if not exists public.groupme_prefs (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  notify_messages boolean not null default true
);
-- Carry over anyone who already switched buzzes off.
insert into public.groupme_prefs (user_id, notify_messages)
select user_id, notify_messages from public.groupme_tokens
on conflict (user_id) do nothing;

alter table public.groupme_chat_picks
  add column if not exists source text not null default 'personal';

do $$ begin
  alter table public.groupme_chat_picks
    add constraint groupme_chat_picks_source_check check (source in ('personal', 'office'));
exception when duplicate_object then null; end $$;

-- Server only.
do $$
declare t text;
begin
  foreach t in array array['groupme_office', 'groupme_shared_chats', 'groupme_sent', 'groupme_prefs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- New shape of the bot's "one new message" step.
drop function if exists public.groupme_bot_message(text, text, text, timestamptz);

create or replace function public.groupme_bot_message(
  p_group_id     text,
  p_message_id   text,
  p_sender_id    text,
  p_created_at   timestamptz,
  p_exclude_user uuid default null
)
returns table (
  user_id         uuid,
  email           text,
  unread_count    integer,
  notify_messages boolean,
  source          text
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
    from auth.users u
   where p.group_id = p_group_id
     and u.id = p.user_id
     -- the Duck Force person who sent it through the office account
     and (p_exclude_user is null or p.user_id <> p_exclude_user)
     -- someone who sent it from their own GroupMe
     and not exists (
       select 1 from public.groupme_tokens t
        where t.user_id = p.user_id
          and coalesce(t.groupme_user_id, '') = coalesce(p_sender_id, '-')
     )
  returning p.user_id,
            u.email,
            p.unread_count,
            coalesce((select g.notify_messages from public.groupme_prefs g where g.user_id = p.user_id), true),
            p.source;
$$;

revoke all on function public.groupme_bot_message(text, text, text, timestamptz, uuid) from public;
revoke all on function public.groupme_bot_message(text, text, text, timestamptz, uuid) from anon;
revoke all on function public.groupme_bot_message(text, text, text, timestamptz, uuid) from authenticated;
grant execute on function public.groupme_bot_message(text, text, text, timestamptz, uuid) to service_role;

commit;
