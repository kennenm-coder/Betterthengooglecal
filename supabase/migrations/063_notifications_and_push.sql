-- ============================================================
-- Migration 063: notifications -- the bell's history + phone push
--
-- One shared channel for every notification the calendar sends. The server
-- (src/lib/notify-server.ts) does two things per notification:
--   1. writes a row to `notifications` for each person it's for -- that's what
--      the bell at the top of the calendar lists, read or not
--   2. buzzes each of that person's devices listed in `push_subscriptions`
-- So the bell works for everyone, and the phone buzz is an extra for anyone
-- who turned it on under Settings -> Phone notifications.
--
-- push_subscriptions: one row per device (a phone and a laptop are two rows).
-- The endpoint is unique, so a device that signs in as someone else takes the
-- row over and a shared office computer never buzzes the old user. Server-only:
-- RLS on, NO policies, grants revoked -- no browser can read anyone's device.
--
-- notifications: a person reads THEIR OWN rows and may only stamp read_at.
-- Writing them is server-only. The daily cron (/api/cron/daily) clears rows
-- older than 90 days.
--
-- `app` on both leaves room for the hub or kiosk to share these tables later.
--
-- Safe to re-run. Run in Supabase SQL Editor.
-- ============================================================

BEGIN;

-- ── Devices ─────────────────────────────────────────────────────────────────
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  app          text not null default 'calendar',
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  device_label text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_email
  on public.push_subscriptions (app, lower(email));

comment on table public.push_subscriptions is
  'Web push subscriptions, one per device. Server-only (service role). Migration 063.';

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

-- ── History (the bell) ──────────────────────────────────────────────────────
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  app        text not null default 'calendar',
  kind       text not null,
  title      text not null,
  body       text not null default '',
  url        text,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create index if not exists idx_notifications_email_created
  on public.notifications (app, lower(email), created_at desc);

comment on table public.notifications is
  'Per-person notification history shown in the calendar bell. Written by the server only. Migration 063.';

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
-- Column-level: the only thing a person can change is when they read it.
grant update (read_at) on public.notifications to authenticated;

drop policy if exists "own_read_notifications" on public.notifications;
create policy "own_read_notifications"
  on public.notifications
  for select
  using (lower(email) = lower(auth.jwt() ->> 'email'));

drop policy if exists "own_mark_read_notifications" on public.notifications;
create policy "own_mark_read_notifications"
  on public.notifications
  for update
  using (lower(email) = lower(auth.jwt() ->> 'email'))
  with check (lower(email) = lower(auth.jwt() ->> 'email'));

COMMIT;

-- ── Check ───────────────────────────────────────────────────────────────────
--   select tablename, rowsecurity from pg_tables
--    where tablename in ('push_subscriptions', 'notifications');        -- both true
--   select tablename, count(*) from pg_policies
--    where tablename in ('push_subscriptions', 'notifications')
--    group by 1;                                                         -- notifications 2 only
