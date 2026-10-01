-- ============================================================
-- Migration 025: GroupMe installer chat
--
-- Two tables, with VERY different exposure, so read the grants
-- carefully before changing anything here.
--
--   public.installer_chats  — maps an installer name (as it appears
--     on a work order, e.g. 'Tim Fitzpatrick') to the GroupMe group
--     that installer already uses. Not secret. Admin-only for now,
--     readable by the client through the Data API like every other
--     table in this app.
--
--   public.groupme_tokens   — per-user GroupMe access tokens. These
--     are PASSWORD-EQUIVALENT: GroupMe issues no scopes, so one token
--     is unlimited, non-expiring access to that person's ENTIRE
--     GroupMe account — every group AND their private DMs. GroupMe
--     documents no revocation endpoint, so a leak is effectively
--     permanent.
--
--     This table is therefore the ONE table in this database that is
--     NOT reachable through the Data API at all. Grants are revoked
--     from anon and authenticated, so a request carrying the public
--     anon key (which ships in five apps' JS bundles) fails at the
--     GRANT level, before RLS is ever consulted. Only service_role
--     may touch it, i.e. only server-side code in /api/groupme/*.
--
--     Migration 019 documents what happens when a public table is
--     reachable by anon and a single permissive policy slips through.
--     Tokens must not be one bad policy away from exposure, so they
--     do not rely on policies at all.
--
--     The token VALUE is additionally encrypted by the application
--     (AES-256-GCM) before it is written, with the key held in the
--     GROUPME_TOKEN_KEY environment variable and never in this
--     database. A dump of this table alone yields nothing usable.
--
-- NOTE ON GRANTS: until 2026-10-30 Supabase still auto-grants Data
-- API access to NEW public tables (see migration 024). That is why
-- the REVOKE below is explicit rather than assumed — a table created
-- today is granted to anon the moment it exists.
--
-- Run in Supabase SQL Editor AFTER 024. Idempotent — safe to re-run.
-- ============================================================

begin;

-- ── 1. Installer → GroupMe group mapping ─────────────────────

create table if not exists public.installer_chats (
  -- The installer's name EXACTLY as it appears on work_orders.installer /
  -- the dayCrews lists, e.g. 'Tim Fitzpatrick'. That is what the calendar
  -- has to match against, and rForce exports clean "First Last" names.
  installer_name text primary key,
  -- GroupMe's own id for the existing group. Opaque numeric string.
  groupme_group_id text not null,
  -- Group name at the time it was mapped, so the admin screen can show
  -- something readable without calling GroupMe. Display only — the id is
  -- the real key, and the name may drift if someone renames the group.
  groupme_group_name text,
  updated_by text,
  updated_at timestamptz not null default now()
);

create index if not exists installer_chats_group_id_idx
  on public.installer_chats (groupme_group_id);

alter table public.installer_chats enable row level security;

-- Admin only, read AND write, for the pilot. When this widens to field
-- managers, add 'field-manager' to the read policy here and update
-- canUseInstallerChat() in src/lib/roles.ts to match.
drop policy if exists "admin_read_installer_chats" on public.installer_chats;
create policy "admin_read_installer_chats"
  on public.installer_chats
  for select
  using (public.has_any_role(array['admin']));

drop policy if exists "admin_write_installer_chats" on public.installer_chats;
create policy "admin_write_installer_chats"
  on public.installer_chats
  for all
  using (public.has_any_role(array['admin']))
  with check (public.has_any_role(array['admin']));

grant select, insert, update, delete
  on public.installer_chats
  to anon, authenticated, service_role;

-- ── 2. Per-user GroupMe tokens (NOT Data API reachable) ──────

create table if not exists public.groupme_tokens (
  -- auth.users.id of the app user who connected their GroupMe account.
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Denormalized for support/debugging; the app matches on user_id.
  email text not null,
  -- AES-256-GCM ciphertext, base64, written by src/lib/groupme-crypto.ts.
  -- NEVER store a raw token here.
  access_token_encrypted text not null,
  -- Who GroupMe says this token belongs to, captured at connect time so the
  -- UI can show "Connected as Kennen McIntyre" without an extra API call.
  groupme_user_id text,
  groupme_name text,
  connected_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.groupme_tokens enable row level security;

-- Deliberately NO policies. RLS is on and nothing matches, so even a
-- request that somehow arrived with a valid grant reads zero rows.
-- service_role bypasses RLS, which is how the API routes reach it.

-- The important part: take away what Supabase auto-granted on create.
revoke all on public.groupme_tokens from anon;
revoke all on public.groupme_tokens from authenticated;
grant select, insert, update, delete on public.groupme_tokens to service_role;

commit;

-- ── Verify (run separately) ──────────────────────────────────
-- installer_chats should list anon/authenticated/service_role.
-- groupme_tokens should list service_role AND NOTHING ELSE.
-- If anon appears on groupme_tokens, STOP and re-run the revokes.
--
--   select table_name, grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name in ('installer_chats', 'groupme_tokens')
--      and grantee in ('anon','authenticated','service_role')
--    order by table_name, grantee, privilege_type;
