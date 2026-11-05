-- ============================================================
-- 047 - More for More settings: bonus rates + people
--
-- Payroll (payroll-admin, admin) can now change the bonus amounts
-- and keep a list of people with their tier:
--
--   more_for_more_settings  one row (id = 1). `rates` holds the
--     per-unit Tier 1/2/3 rates for lead and apprentice, plus the
--     Additional Jobs and JIP amounts. Empty = the paper sheet's
--     numbers (the app falls back to them key by key).
--
--   more_for_more_people    the people the form suggests as a lead
--     types a name. Tapping one fills in their tier. Leads can still
--     type anyone and pick a tier by hand.
--
-- Each sheet keeps a copy of the rates in effect when the lead saved
-- it (lead_data.rates), so changing a rate here never changes pay on
-- a sheet already filled in.
--
-- Everyone allowlisted reads both (the lead's form needs them);
-- only payroll writes.
--
-- Run in Supabase SQL Editor. Idempotent -- safe to re-run.
-- 019 (is_allowlisted, has_any_role) must be applied first.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.more_for_more_settings (
  id         integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  rates      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

INSERT INTO public.more_for_more_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.more_for_more_people (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (btrim(name) <> ''),
  -- Which name boxes suggest them first. 'either' shows in both.
  kind       text NOT NULL DEFAULT 'either' CHECK (kind IN ('lead', 'apprentice', 'either')),
  tier       integer CHECK (tier IN (1, 2, 3)),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mfm_people_name
  ON public.more_for_more_people (lower(btrim(name)));

ALTER TABLE public.more_for_more_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.more_for_more_people   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mfm_settings_read"  ON public.more_for_more_settings;
DROP POLICY IF EXISTS "mfm_settings_write" ON public.more_for_more_settings;
CREATE POLICY "mfm_settings_read" ON public.more_for_more_settings FOR SELECT
  USING (public.is_allowlisted());
CREATE POLICY "mfm_settings_write" ON public.more_for_more_settings FOR UPDATE
  USING (public.has_any_role(ARRAY['admin', 'payroll-admin']))
  WITH CHECK (public.has_any_role(ARRAY['admin', 'payroll-admin']));

DROP POLICY IF EXISTS "mfm_people_read"   ON public.more_for_more_people;
DROP POLICY IF EXISTS "mfm_people_insert" ON public.more_for_more_people;
DROP POLICY IF EXISTS "mfm_people_update" ON public.more_for_more_people;
DROP POLICY IF EXISTS "mfm_people_delete" ON public.more_for_more_people;
CREATE POLICY "mfm_people_read" ON public.more_for_more_people FOR SELECT
  USING (public.is_allowlisted());
CREATE POLICY "mfm_people_insert" ON public.more_for_more_people FOR INSERT
  WITH CHECK (public.has_any_role(ARRAY['admin', 'payroll-admin']));
CREATE POLICY "mfm_people_update" ON public.more_for_more_people FOR UPDATE
  USING (public.has_any_role(ARRAY['admin', 'payroll-admin']))
  WITH CHECK (public.has_any_role(ARRAY['admin', 'payroll-admin']));
CREATE POLICY "mfm_people_delete" ON public.more_for_more_people FOR DELETE
  USING (public.has_any_role(ARRAY['admin', 'payroll-admin']));

-- New tables get no Data API access automatically after 2026-10-30
-- (see 024). The policies above are the real gate; anon has none.
GRANT SELECT, UPDATE ON public.more_for_more_settings TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.more_for_more_people TO authenticated, service_role;
REVOKE ALL ON public.more_for_more_settings FROM anon;
REVOKE ALL ON public.more_for_more_people   FROM anon;

COMMIT;

-- Verify (run separately):
--   select id, rates from public.more_for_more_settings;   -- one row, id 1
--   select polname, polrelid::regclass from pg_policy
--    where polrelid in ('public.more_for_more_settings'::regclass,
--                       'public.more_for_more_people'::regclass);
