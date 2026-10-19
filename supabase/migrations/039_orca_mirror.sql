-- ============================================================
-- Migration 039: the Orca inventory mirror
--
-- An installer opens a job's install paperwork and sees every Orca
-- inventory row that belongs to that job — windows, doors, hardware,
-- trim bundles — so they can tick each one off as they load it.
--
-- Orca pushes every change to /api/orca/events; that route lands the
-- row here. The mirror is the only thing the UI reads, so a warehouse
-- edit made directly in Orca shows up on the install page too.
--
-- Three tables:
--   orca_rows       the mirror, one row per (sheet, barcode)
--   orca_job_links  job order number → our 8-digit order number
--   orca_events     raw audit of every webhook hit
--
-- Keyed on (sheet_id, barcode), not Orca's row id: the one-time Excel
-- backfill has barcodes but no row ids, and WebHook In updates by
-- barcode anyway.
--
-- 033 / 035 / 036 must be applied first (is_installer, my_crew_names,
-- order_is_mine).
--
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
-- ============================================================

BEGIN;

-- ── Tables ──────────────────────────────────────────────────

create table if not exists public.orca_rows (
  sheet_id          text not null,            -- Orca's internal id (orca-sheet-id header)
  barcode           text not null,
  orca_row_id       text,                     -- ___orca_row_id; null until the first live event
  -- Extracted for querying. Everything else stays in `data`.
  name              text,
  customer_po       text,
  job_order_number  text,
  order_number      text,                     -- THE JOIN. 8-digit. Resolved, may be null.
  status            text,
  loading_status    text,
  installer         text,
  stager            text,
  location          text,
  description       text,
  so_line_item      text,
  staged_out        text,
  changed_on        text,
  data              jsonb not null,           -- the whole row as Orca sent it
  deleted_at        timestamptz,              -- rows:delete soft-deletes; nothing is lost
  updated_at        timestamptz not null default now(),
  primary key (sheet_id, barcode)
);

create index if not exists orca_rows_order_number_idx
  on public.orca_rows (order_number) where deleted_at is null;
create index if not exists orca_rows_job_order_number_idx
  on public.orca_rows (job_order_number);
create index if not exists orca_rows_row_id_idx
  on public.orca_rows (sheet_id, orca_row_id) where orca_row_id is not null;

comment on table public.orca_rows is
  'Mirror of the Orca Scan inventory sheets, fed by WebHook Out. Read-only to '
  'clients; only the service role writes here.';
comment on column public.orca_rows.order_number is
  'Our 8-digit order number, resolved by orca_resolve_order_number(). Null '
  'when the row cannot be tied to a job yet — show that plainly, never as an '
  'empty list.';

create table if not exists public.orca_job_links (
  job_order_number  text primary key,
  order_number      text not null,
  source            text not null,            -- 'rforce' | 'warehouse' | 'manual'
  created_at        timestamptz default now()
);

comment on table public.orca_job_links is
  'Maps the factory job order number (7-digit, which Orca has) to our order '
  'number (8-digit, which Orca mostly does not). Filled from rForce, by the '
  'warehouse, or by hand.';

create table if not exists public.orca_events (
  id            bigserial primary key,
  sheet_id      text,
  event         text,
  barcode       text,
  received_at   timestamptz default now(),
  payload       jsonb
);

create index if not exists orca_events_received_at_idx
  on public.orca_events (received_at desc);

comment on table public.orca_events is
  'Every webhook hit and every scan we send, raw. The record of what Orca '
  'actually said, independent of what we stored.';

-- ── The caller's own crew name ──────────────────────────────
-- my_crew_names() answers "whose jobs are mine" — it deliberately
-- includes the lead's name and both rosters' aliases, as one unordered
-- set. That is the wrong thing to stamp into Orca's `Installer` column:
-- picking an element of it gets you whichever name sorts first, which
-- may be an alias or the lead.
--
-- This returns just the login's own resource, spelled as
-- sched_crews.name spells it, which is the spelling Orca's Installer
-- column has to match.

create or replace function public.my_own_crew_name()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.name
  from public.allowed_emails ae
  join public.sched_crews c on c.id = ae.sched_crew_id
  where ae.email = lower(auth.jwt() ->> 'email')
  limit 1;
$$;

comment on function public.my_own_crew_name() is
  'The calling login''s own crew/resource name — no lead, no aliases. Null '
  'when the login has no resource assigned. This is what goes in Orca''s '
  'Installer column.';

revoke all on function public.my_own_crew_name() from public, anon;
grant execute on function public.my_own_crew_name() to authenticated;

-- ── Timestamp parsing that cannot throw ─────────────────────
-- Orca's "Changed On" format is not documented and varies by export.
-- A failed parse returns null, and the guard below treats null as
-- "don't know, let the write through" — newest arrival wins.

create or replace function public.orca_ts(p_text text)
returns timestamptz
language plpgsql
immutable
as $$
begin
  if p_text is null or btrim(p_text) = '' then
    return null;
  end if;
  return p_text::timestamptz;
exception when others then
  return null;
end;
$$;

-- ── The resolver ────────────────────────────────────────────
-- Which of our order numbers does this Orca row belong to?
--
-- Orca reliably has `Job Order Number` (the factory's 7-digit job id);
-- this app has `order_number` (8-digit). Fewer than one row in ten
-- carries both today, which is a process problem, not a code one. The
-- resolver tries every source we have so the rest of the code stays
-- the same whichever way that process lands.

create or replace function public.orca_resolve_order_number(
  p_customer_po       text,
  p_job_order_number  text,
  p_barcode           text,
  p_name              text
)
returns text
language sql
stable
as $$
  select coalesce(
    -- 1. The warehouse typed our order number straight into Customer PO.
    (select btrim(p_customer_po)
      where btrim(coalesce(p_customer_po, '')) ~ '^[0-9]{8}$'),
    -- 2. A link from rForce, the warehouse, or the office.
    (select l.order_number
       from public.orca_job_links l
      where l.job_order_number = btrim(coalesce(p_job_order_number, ''))),
    -- 3. A barcode the cut-list app wrote: RBA-04717321-WC-1610261436.
    (substring(coalesce(p_barcode, '') from 'RBA-([0-9]{8})-')),
    -- 4. An 8-digit number sitting in the Name, as the factory rows do.
    (substring(coalesce(p_name, '') from '(?<![0-9])([0-9]{8})(?![0-9])'))
  );
$$;

comment on function public.orca_resolve_order_number(text, text, text, text) is
  'Best-effort 8-digit order number for an Orca row: Customer PO, then '
  'orca_job_links, then a cut-list barcode, then the Name. Null when none of '
  'them answers.';

-- ── Applying one row from Orca ──────────────────────────────
-- The receiver hands the whole row over as jsonb and this does the
-- rest, so the three awkward parts live in one place:
--
--   * column extraction, keyed by Orca's column names
--   * the resolver
--   * two ordering hazards:
--       a retry can arrive AFTER a newer change — guarded on changed_on
--       a barcode renamed in Orca would otherwise leave a ghost row —
--       the old key is retired when the row id gives it away
--
-- Returns true when the row was written, false when it was skipped as
-- stale.

create or replace function public.orca_apply_row(
  p_sheet_id  text,
  p_barcode   text,
  p_row_id    text,
  p_data      jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_changed_on  text := nullif(btrim(coalesce(p_data ->> 'Changed On', '')), '');
  v_existing    text;
  v_written     boolean := false;
begin
  if coalesce(btrim(p_barcode), '') = '' then
    return false;                           -- no key, nothing we can store
  end if;

  -- A barcode renamed in Orca arrives as an update under the new key.
  -- Without this the old key stays behind and shows on the install page
  -- forever, as a row the warehouse no longer has.
  if p_row_id is not null then
    update public.orca_rows
       set deleted_at = now(), updated_at = now()
     where sheet_id = p_sheet_id
       and orca_row_id = p_row_id
       and barcode <> p_barcode
       and deleted_at is null;
  end if;

  -- Don't let a late retry overwrite a newer change. Unparseable or
  -- absent timestamps mean "don't know", and the write goes through.
  select changed_on into v_existing
    from public.orca_rows
   where sheet_id = p_sheet_id and barcode = p_barcode;

  if v_existing is not null and v_changed_on is not null
     and public.orca_ts(v_existing) is not null
     and public.orca_ts(v_changed_on) is not null
     and public.orca_ts(v_changed_on) < public.orca_ts(v_existing) then
    return false;
  end if;

  insert into public.orca_rows as r (
    sheet_id, barcode, orca_row_id,
    name, customer_po, job_order_number, order_number,
    status, loading_status, installer, stager, location,
    description, so_line_item, staged_out, changed_on,
    data, deleted_at, updated_at
  )
  values (
    p_sheet_id,
    btrim(p_barcode),
    p_row_id,
    p_data ->> 'Name',
    p_data ->> 'Customer PO',
    p_data ->> 'Job Order Number',
    public.orca_resolve_order_number(
      p_data ->> 'Customer PO',
      p_data ->> 'Job Order Number',
      p_barcode,
      p_data ->> 'Name'
    ),
    p_data ->> 'Status',
    p_data ->> 'Loading Status',
    p_data ->> 'Installer',
    p_data ->> 'Stager',
    p_data ->> 'Location',
    p_data ->> 'Description',
    p_data ->> 'SO Line Item',
    p_data ->> 'Staged out',
    v_changed_on,
    p_data,
    null,
    now()
  )
  on conflict (sheet_id, barcode) do update set
    orca_row_id      = coalesce(excluded.orca_row_id, r.orca_row_id),
    name             = excluded.name,
    customer_po      = excluded.customer_po,
    job_order_number = excluded.job_order_number,
    order_number     = excluded.order_number,
    status           = excluded.status,
    loading_status   = excluded.loading_status,
    installer        = excluded.installer,
    stager           = excluded.stager,
    location         = excluded.location,
    description      = excluded.description,
    so_line_item     = excluded.so_line_item,
    staged_out       = excluded.staged_out,
    changed_on       = excluded.changed_on,
    data             = excluded.data,
    deleted_at       = null,
    updated_at       = now();

  v_written := true;
  return v_written;
end;
$$;

comment on function public.orca_apply_row(text, text, text, jsonb) is
  'Upsert one Orca row into the mirror: extracts the columns, resolves the '
  'order number, retires a renamed barcode, and refuses a stale retry. '
  'Returns false when the row was skipped.';

-- No client ever calls this; the receiver and the backfill script do, both
-- with the service role. Revoking from authenticated also strips the default
-- PUBLIC grant, so service_role needs naming explicitly.
revoke all on function public.orca_apply_row(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.orca_apply_row(text, text, text, jsonb) to service_role;

-- ── Re-resolving after the join is fixed ────────────────────
-- A row mirrored before the join was solved keeps order_number = null
-- forever, so filling orca_job_links later would change nothing on
-- screen. This re-runs the resolver over everything still unresolved.

create or replace function public.orca_reresolve_order_numbers()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  with updated as (
    update public.orca_rows r
       set order_number = public.orca_resolve_order_number(
             r.customer_po, r.job_order_number, r.barcode, r.name),
           updated_at = now()
     where r.order_number is null
       and public.orca_resolve_order_number(
             r.customer_po, r.job_order_number, r.barcode, r.name) is not null
    returning 1
  )
  select count(*) into v_count from updated;
  return v_count;
end;
$$;

comment on function public.orca_reresolve_order_numbers() is
  'Re-runs the resolver over every mirror row whose order_number is still '
  'null. Returns how many rows gained one.';

revoke all on function public.orca_reresolve_order_numbers() from public, anon;
grant execute on function public.orca_reresolve_order_numbers() to authenticated, service_role;

-- A new link should take effect without anyone remembering to re-run it.
create or replace function public.orca_job_links_reresolve()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.orca_rows r
     set order_number = new.order_number,
         updated_at = now()
   where r.order_number is null
     and r.job_order_number = new.job_order_number;
  return new;
end;
$$;

drop trigger if exists orca_job_links_reresolve_trg on public.orca_job_links;
create trigger orca_job_links_reresolve_trg
  after insert or update on public.orca_job_links
  for each row execute function public.orca_job_links_reresolve();

-- ── RLS ─────────────────────────────────────────────────────
-- Same shape as 036: allowlisted accounts read everything, an
-- installer reads only rows for an order that is theirs, and nobody
-- writes from the client. The receiver and the scan route use the
-- service role, which bypasses all of this.

alter table public.orca_rows enable row level security;

drop policy if exists "allowlisted_read_orca_rows" on public.orca_rows;
create policy "allowlisted_read_orca_rows"
  on public.orca_rows for select
  using (public.is_allowlisted() and not public.is_installer());

drop policy if exists "installers_read_own_orca_rows" on public.orca_rows;
create policy "installers_read_own_orca_rows"
  on public.orca_rows for select
  using (
    public.is_installer()
    and order_number is not null
    and public.order_is_mine(order_number)
  );

alter table public.orca_job_links enable row level security;

drop policy if exists "allowlisted_read_orca_job_links" on public.orca_job_links;
create policy "allowlisted_read_orca_job_links"
  on public.orca_job_links for select
  using (public.is_allowlisted());

drop policy if exists "admin_write_orca_job_links" on public.orca_job_links;
create policy "admin_write_orca_job_links"
  on public.orca_job_links for all
  using (public.has_any_role(array['admin']))
  with check (public.has_any_role(array['admin']));

alter table public.orca_events enable row level security;

drop policy if exists "admin_read_orca_events" on public.orca_events;
create policy "admin_read_orca_events"
  on public.orca_events for select
  using (public.has_any_role(array['admin']));

-- Grants are wide open across this project by convention; RLS above is
-- the gate. orca_rows gets SELECT only — there is no client write path.
grant select on public.orca_rows to authenticated;
grant select on public.orca_job_links to authenticated;
grant insert, update, delete on public.orca_job_links to authenticated;
grant select on public.orca_events to authenticated;

COMMIT;

-- ============================================================
-- Verify (run separately)
--
--   -- tables and functions exist
--   select count(*) from public.orca_rows;
--   select public.orca_resolve_order_number('04717321', null, null, null);  -- 04717321
--   select public.orca_resolve_order_number('ZX3162953P', null,
--            'RBA-04717321-WC-1610261436', null);                           -- 04717321
--   select public.orca_resolve_order_number('ZX3162953P', null, null,
--            '-,04794151/097');                                             -- 04794151
--   select public.orca_resolve_order_number('ZX3162953P', '8124444',
--            '98124444.003', 'Abbott,Kelly');                               -- null
--
--   -- signed in as a test installer: only their own rows, and no writes
--   select count(*) from public.orca_rows;
--   insert into public.orca_rows (sheet_id, barcode, data)
--     values ('x', 'y', '{}'::jsonb);        -- must fail
--
--   -- the link trigger reaches rows already mirrored
--   insert into public.orca_job_links (job_order_number, order_number, source)
--     values ('8124444', '04717321', 'manual');
--   select count(*) from public.orca_rows
--    where job_order_number = '8124444' and order_number = '04717321';
-- ============================================================
