-- ============================================================
-- 057 - More for More: crews & tiers the submitter manages
--
-- Kennen, 2026-11-17. The people list (047/049) becomes a crew table:
--
--   lead_id        each person's usual lead -- who they ride with. A
--                  lead's crew is everyone pointing at them. When a sheet
--                  is started for a lead, their crew fills in as the
--                  apprentices (with tiers), so nobody retypes them.
--   training       "Training": on the crew, but NO bonus on a sheet --
--                  units, additional jobs and JIP all pay $0.
--   subcontractor  a subcontractor crew (Randy Taylor, Alex Taylor). Only
--                  a tag for now; their Invoice version comes later.
--
-- The More for More Submitter (and payroll, admin) can now add, edit and
-- remove people. Bonus RATES stay payroll-only (047, unchanged).
--
-- Accounts still drive the list (049): every installer / installer-lead
-- login is on it, linked by email, and a linked person's NAME follows
-- their account. Lead/apprentice is only set when someone is first added,
-- so marking an "installer" account as a lead here sticks.
--
-- Section 3 loads Kennen's crew list of 2026-11-17. Re-running this file
-- re-applies that list over any later edits to those people.
--
-- Run in Supabase SQL Editor. 047 and 049 must be applied first.
-- ============================================================

BEGIN;

-- ── 1. Columns ───────────────────────────────────────────────

ALTER TABLE public.more_for_more_people
  ADD COLUMN IF NOT EXISTS lead_id       uuid REFERENCES public.more_for_more_people(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS training      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS subcontractor boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_mfm_people_lead ON public.more_for_more_people (lead_id);

-- ── 2. Who edits people: payroll, admin, and the submitter ───

DROP POLICY IF EXISTS "mfm_people_insert" ON public.more_for_more_people;
DROP POLICY IF EXISTS "mfm_people_update" ON public.more_for_more_people;
DROP POLICY IF EXISTS "mfm_people_delete" ON public.more_for_more_people;
CREATE POLICY "mfm_people_insert" ON public.more_for_more_people FOR INSERT
  WITH CHECK (public.has_any_role(ARRAY['admin', 'payroll-admin', 'mfm-submitter']));
CREATE POLICY "mfm_people_update" ON public.more_for_more_people FOR UPDATE
  USING (public.has_any_role(ARRAY['admin', 'payroll-admin', 'mfm-submitter']))
  WITH CHECK (public.has_any_role(ARRAY['admin', 'payroll-admin', 'mfm-submitter']));
CREATE POLICY "mfm_people_delete" ON public.more_for_more_people FOR DELETE
  USING (public.has_any_role(ARRAY['admin', 'payroll-admin', 'mfm-submitter']));

-- ── 3. Kennen's crew list (2026-11-17) ───────────────────────
-- Names with an account use the ACCOUNT spelling (Sam Morman, Richard
-- Sibbersen) -- Kennen confirmed the accounts are right.

CREATE TEMP TABLE mfm_seed (name text, kind text, tier int, training boolean, sub boolean, lead_name text) ON COMMIT DROP;
INSERT INTO mfm_seed VALUES
  ('Randy Taylor',        'lead',       NULL, false, true,  NULL),
  ('Will Smallman',       'apprentice', NULL, true,  false, 'Randy Taylor'),
  ('Aaron Barbee',        'apprentice', NULL, true,  false, 'Randy Taylor'),
  ('Alex Taylor',         'lead',       NULL, false, true,  NULL),
  ('Justin Thompson',     'apprentice', 2,    false, false, 'Alex Taylor'),
  ('Logan Dotson',        'lead',       1,    false, false, NULL),
  ('Brayden Miller',      'apprentice', 2,    false, false, 'Logan Dotson'),
  ('Austin Urban',        'apprentice', 1,    false, false, 'Logan Dotson'),
  ('Trevor Holewinski',   'lead',       1,    false, false, NULL),
  ('Craig Holewinski',    'apprentice', 1,    false, false, 'Trevor Holewinski'),
  ('Nathan',              'apprentice', NULL, true,  false, 'Trevor Holewinski'),
  ('Dave Williams',       'lead',       1,    false, false, NULL),
  ('Shawn Marcinkowski',  'apprentice', 1,    false, false, 'Dave Williams'),
  ('Keith Morris',        'lead',       1,    false, false, NULL),
  ('Noah Davis',          'apprentice', 1,    false, false, 'Keith Morris'),
  ('Ken Driebergen',      'lead',       2,    false, false, NULL),
  ('Brandon Allen',       'apprentice', 1,    false, false, 'Ken Driebergen'),
  ('Chris Usrey',         'apprentice', 2,    false, false, 'Ken Driebergen'),
  ('Morgan Michalak',     'lead',       2,    false, false, NULL),
  ('Gage Vargas',         'apprentice', 1,    false, false, 'Morgan Michalak'),
  ('Sam Morman',          'lead',       1,    false, false, NULL),
  ('Richard Sibbersen',   'lead',       3,    false, false, 'Sam Morman'),
  ('Danny Dennis',        'apprentice', 2,    false, false, 'Sam Morman'),
  ('Tim Fitzpatrick',     'lead',       1,    false, false, NULL);

-- Add anyone missing; update everyone listed (matched by name, any case).
INSERT INTO public.more_for_more_people (name, kind, tier, training, subcontractor, active)
SELECT s.name, s.kind, s.tier, s.training, s.sub, true FROM mfm_seed s
ON CONFLICT ((lower(btrim(name)))) DO UPDATE
   SET kind = EXCLUDED.kind,
       tier = EXCLUDED.tier,
       training = EXCLUDED.training,
       subcontractor = EXCLUDED.subcontractor,
       active = true,
       updated_at = now();

-- Then point each crew member at their lead.
UPDATE public.more_for_more_people p
   SET lead_id = l.id, updated_at = now()
  FROM mfm_seed s
  JOIN public.more_for_more_people l ON lower(btrim(l.name)) = lower(s.lead_name)
 WHERE lower(btrim(p.name)) = lower(s.name);

UPDATE public.more_for_more_people p
   SET lead_id = NULL, updated_at = now()
  FROM mfm_seed s
 WHERE lower(btrim(p.name)) = lower(s.name) AND s.lead_name IS NULL AND p.lead_id IS NOT NULL;

COMMIT;

-- Verify (run separately):
--   select l.name as lead, p.name, p.kind, p.tier, p.training, p.subcontractor
--     from public.more_for_more_people p
--     left join public.more_for_more_people l on l.id = p.lead_id
--    order by coalesce(l.name, p.name), p.lead_id nulls first, p.name;
