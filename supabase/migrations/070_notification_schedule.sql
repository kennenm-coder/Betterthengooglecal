-- ============================================================
-- Migration 070: Each person's notification schedule
--
-- Lets every Duck Force account say when they DON'T want their
-- phone buzzed: quiet hours per day of the week (e.g. 9pm-7am,
-- overnight is fine), or a whole day off (e.g. Sunday). It covers
-- ALL Duck Force buzzes -- Job Alerts, write-up notices, GroupMe
-- messages, everything that goes through notify().
--
-- During quiet time the phone just isn't buzzed. Anything that
-- normally lands in the bell still lands there, so nothing is lost.
-- (GroupMe message buzzes never go in the bell; the chat still
-- shows them as unread.)
--
-- One row per (app, login email). Edited in Settings and from the
-- Chat tab's notification menu, both through /api/notifications/prefs.
--
--   schedule  { "mon": { "mode": "on" | "quiet" | "off",
--                        "from": "21:00", "to": "07:00" }, ... }
--             A missing day means "on" (buzz any time).
--   timezone  The person's own time zone, taken from their device
--             when they save (defaults to the office's).
--
-- ACCESS: server only (service role), like push_subscriptions.
-- Run in Supabase SQL Editor. Idempotent.
-- ============================================================

begin;

create table if not exists public.notification_prefs (
  app        text not null default 'calendar',
  email      text not null,
  schedule   jsonb not null default '{}'::jsonb,
  timezone   text not null default 'America/New_York',
  updated_at timestamptz not null default now(),
  primary key (app, email)
);

comment on table public.notification_prefs is
  'Per-person quiet hours / days off for phone buzzes. Server-only (service role). Migration 070.';

alter table public.notification_prefs enable row level security;
revoke all on public.notification_prefs from anon, authenticated;
grant select, insert, update, delete on public.notification_prefs to service_role;

commit;
