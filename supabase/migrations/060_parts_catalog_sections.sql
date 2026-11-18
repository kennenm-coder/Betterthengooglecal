-- ============================================================
-- 060 - Parts catalog sections
--
-- The parts catalog is about to hold a second, much larger body of
-- parts (the Renewal by Andersen catalog, ~700 parts, each with many
-- colour / size / part-number variants) next to the service parts it
-- has always held. Mixed into one flat list they would drown each
-- other, so every row now belongs to a SECTION:
--
--   'Location Parts'  every row that existed before this migration
--   'Renewal Parts'   the Renewal by Andersen catalog
--   'IQ Parts'        reserved; added later
--
-- Three columns, all additive. Nothing existing is dropped or altered:
--
--   1. section     which catalog a part lives in. The default fills
--                  every existing row, and any insert from an older
--                  copy of either app, with 'Location Parts'.
--   2. source_ref  where an imported part came from, e.g. 'rba:2:177'.
--                  The importer upserts on it, so re-running an import
--                  updates rows instead of duplicating them. Null for
--                  hand-made parts; unique where present.
--   3. details     everything about an imported part that has no column
--                  of its own: vintage compatibility, notes, whether
--                  it is service-reimbursable, the catalog's own line
--                  names. Free-form jsonb; both apps tolerate its
--                  absence and its emptiness.
--
-- Bundles (parts_bundles) are untouched. They reference parts by id,
-- so a bundle can already mix parts from any section.
--
-- No new grants or policies: column additions inherit the table's
-- existing ones (030 / 031).
--
-- Deploy order is safe either way. The apps fall back to the older
-- column set when these columns are missing, so the code can ship
-- before this is run; until it is, the section tabs simply don't
-- appear and everything shows as one list.
--
-- Run in Supabase SQL Editor. Idempotent -- safe to re-run.
-- ============================================================

BEGIN;

alter table public.parts_catalog
  add column if not exists section    text  not null default 'Location Parts',
  add column if not exists source_ref text,
  add column if not exists details    jsonb not null default '{}'::jsonb;

-- The catalog screen and the write-up picker both narrow by section, then
-- by model (product_type).
create index if not exists idx_parts_catalog_section_type
  on public.parts_catalog (section, product_type);

-- One row per imported source part. Partial, so hand-made parts (null) are
-- never constrained against each other.
create unique index if not exists uq_parts_catalog_source_ref
  on public.parts_catalog (source_ref)
  where source_ref is not null;

COMMIT;

-- Verify:
--   select section, count(*) from public.parts_catalog group by section;
-- Expect every existing row under 'Location Parts'.
--   select column_name, data_type, column_default from information_schema.columns
--    where table_name = 'parts_catalog'
--      and column_name in ('section', 'source_ref', 'details');
-- Expect three rows.
