-- ============================================================
-- Migration 023: install_docs — the install-instructions handoff
--
-- Until now three apps (nwo-material-list-maker, this calendar, and
-- RBANWO-Job-Auditor) each carried an identical ~1,400-line copy of the
-- material-list builder and re-computed the install instructions from the
-- raw job + catalog + offsets on every open. Any logic change had to be
-- hand-mirrored into all three.
--
-- From now on the material-list app is the ONLY builder. Whenever a
-- submitted job is saved there, it writes the finished document here, and
-- the calendar + auditor simply read it by job id.
--
--   job_id          jobs.id
--   order_number    data->job->>poNumber at build time (for order lookups)
--   doc             the rendered document (see lib/installDoc.js in the
--                   material-list app for the shape; doc.version is bumped
--                   when the shape or builder logic changes)
--   builder_version integer mirror of doc.version for cheap filtering
--   built_by        email of the user whose save produced it
--   built_at        when the document was built (client clock, informational)
--   updated_at      server clock, maintained by trigger
--
-- Access: any allowlisted user may read; only the roles that build jobs
-- (admin + the two cut-list roles) may write. RLS helpers from 019.
--
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
-- ============================================================

begin;

create table if not exists public.install_docs (
  job_id          text primary key,
  order_number    text,
  doc             jsonb not null,
  builder_version int  not null default 1,
  built_by        text,
  built_at        timestamptz,
  updated_at      timestamptz not null default now()
);

create index if not exists idx_install_docs_order_number on public.install_docs (order_number);

create or replace function public.install_docs_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists trg_install_docs_touch_updated_at on public.install_docs;
create trigger trg_install_docs_touch_updated_at
  before insert or update on public.install_docs
  for each row execute function public.install_docs_touch_updated_at();

alter table public.install_docs enable row level security;

drop policy if exists "allowlisted_read_install_docs" on public.install_docs;
create policy "allowlisted_read_install_docs"
  on public.install_docs for select
  using (public.is_allowlisted());

drop policy if exists "cutlist_write_install_docs" on public.install_docs;
create policy "cutlist_write_install_docs"
  on public.install_docs for all
  using (public.has_any_role(array['admin','configuring','configuring-editing']))
  with check (public.has_any_role(array['admin','configuring','configuring-editing']));

grant select on public.install_docs to authenticated;
grant insert, update, delete on public.install_docs to authenticated;

commit;

-- Verify (run separately):
-- select count(*), max(updated_at) from public.install_docs;
-- select policyname, cmd from pg_policies where tablename = 'install_docs';
