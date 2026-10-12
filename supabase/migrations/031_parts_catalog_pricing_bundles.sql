-- ============================================================
-- 031 - Service parts: nicknames, pricing, bundles, audit trail
--
-- Five things the parts catalog grew once it became editable from
-- the NWO material-list app as well as from here:
--
--   1. NICKNAMES. A tech who types "cam lock" never finds "Sash
--      lock", so they add a custom part instead and the catalog
--      fills up with near-duplicates. The write-up picker will
--      search these; it still DISPLAYS the official name, with
--      the matched nickname in parentheses.
--
--   2. PRICE. Shown while picking a part, so an $80 part where
--      an $18 one was expected gives the write-up author pause.
--      A part-level price, overridable per variant (the variants
--      jsonb gains an optional "price" alongside "partNumber" --
--      no DDL for that, but both apps tolerate its absence).
--      The price is NOT carried onto the write-up line; it never
--      reaches install docs or the Job Auditor.
--
--   3. BUNDLES. "Triple Casement Brick Mould" = these five parts
--      at these quantities. Tapping one in a write-up adds its
--      members; a count multiplies every member's quantity.
--
--   4. AUDIT. created_by / updated_by / updated_at, so a part
--      auto-added from a write-up records the tech who typed it
--      and a review can see what changed lately and by whom.
--
--   5. PHOTOS. One optional picture per part and per bundle,
--      shown ONLY on the catalog screens -- never on a write-up,
--      a document or an order. Downscaled before upload, so these
--      are ~100 KB each, not 4 MB phone photos. The file lives in
--      the catalog-photos bucket below; the column holds its path.
--
--   6. Nothing here widens who may write parts. Still admin or
--      field-manager, via has_any_role (see 030). The photo
--      bucket also admits configuring-editing, because the SAME
--      bucket holds photos for the trim catalog in the NWO
--      material-list app, which that role maintains.
--
-- Run in Supabase SQL Editor. Idempotent -- safe to re-run. If you
-- already ran an earlier copy of this file, re-running it is the
-- intended way to pick up the photo parts.
-- ============================================================

BEGIN;

-- ── parts_catalog: new columns ───────────────────────────────
alter table public.parts_catalog
  add column if not exists nicknames  text[] not null default '{}',
  -- Part-level price. A variant may override it in the variants
  -- jsonb; null here means "no price recorded", which the apps
  -- render as a dash rather than as $0.00.
  add column if not exists price      numeric(10,2),
  add column if not exists created_by text,
  add column if not exists updated_by text,
  add column if not exists updated_at timestamptz not null default now(),
  -- Path inside the catalog-photos bucket, e.g. "parts/<uuid>.jpg".
  add column if not exists photo_path text;

-- Nickname lookup is a contains-match over a small table, so GIN
-- on the array is enough; no trigram index needed.
create index if not exists idx_parts_catalog_nicknames
  on public.parts_catalog using gin (nicknames);

-- ── parts_bundles: a named set of parts and quantities ───────
-- members is [{ "partId": "<uuid>", "qty": 3 }, ...]. Deliberately
-- jsonb with no foreign key, matching how variants already works:
-- the apps resolve ids at read time and show a dangling one as
-- "(part no longer in the catalog)" instead of hiding the row.
-- A hard FK would make deleting a part fail in a way neither app
-- is built to explain.
create table if not exists public.parts_bundles (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,              -- "Triple Casement Brick Mould"
  product_type   text,                       -- same vocabulary as parts_catalog
  nicknames      text[] not null default '{}',
  members        jsonb  not null default '[]'::jsonb,
  -- Normally the price is summed from the members; set this only
  -- when the bundle is quoted as a kit for a different number.
  price_override numeric(10,2),
  photo_path     text,
  verified       boolean not null default true,
  active         boolean not null default true,
  created_by     text,
  updated_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_parts_bundles_active on public.parts_bundles (active);
create index if not exists idx_parts_bundles_type   on public.parts_bundles (product_type);

alter table public.parts_bundles enable row level security;

-- Same rule as parts_catalog after 030: any allowlisted user reads,
-- admin or field-manager writes, checking every role slot.
drop policy if exists "allowlisted_read_parts_bundles" on public.parts_bundles;
create policy "allowlisted_read_parts_bundles"
  on public.parts_bundles for select
  using (public.get_user_role() is not null);

drop policy if exists "editors_write_parts_bundles" on public.parts_bundles;
create policy "editors_write_parts_bundles"
  on public.parts_bundles for all
  using      (public.has_any_role(array['admin', 'field-manager']))
  with check (public.has_any_role(array['admin', 'field-manager']));

-- Data API grants. From 2026-10-30 Supabase stops granting these to
-- NEW tables automatically, so a table created after that date is
-- unreachable ("permission denied") without this, however correct
-- its policies are. See 024 for the full explanation.
grant select, insert, update, delete
  on public.parts_bundles to anon, authenticated, service_role;

-- ── catalog-photos bucket ────────────────────────────────────
-- One picture per part, bundle, or trim profile. Public-read: these
-- are pictures of window parts, nothing sensitive, and a public
-- bucket means an <img src> just works instead of every row
-- needing a signed URL that expires while the page is open.
-- Writing is still restricted to the editors below.
insert into storage.buckets (id, name, public)
values ('catalog-photos', 'catalog-photos', true)
on conflict (id) do update set public = true;

drop policy if exists "catalog_photos_read"  on storage.objects;
create policy "catalog_photos_read"
  on storage.objects for select
  using (bucket_id = 'catalog-photos');

-- configuring-editing is here because the same bucket holds the trim
-- catalog's photos, which that role maintains in the material-list app.
drop policy if exists "catalog_photos_write" on storage.objects;
create policy "catalog_photos_write"
  on storage.objects for all
  using (
    bucket_id = 'catalog-photos'
    and public.has_any_role(array['admin', 'field-manager', 'configuring-editing'])
  )
  with check (
    bucket_id = 'catalog-photos'
    and public.has_any_role(array['admin', 'field-manager', 'configuring-editing'])
  );

COMMIT;

-- Verify:
--   select column_name, data_type from information_schema.columns
--    where table_name = 'parts_catalog' order by ordinal_position;
--   select policyname, cmd, qual from pg_policies
--    where tablename = 'parts_bundles';
-- Expect nicknames / price / created_by / updated_by / updated_at on
-- parts_catalog, and one read + one has_any_role write policy on
-- parts_bundles.
