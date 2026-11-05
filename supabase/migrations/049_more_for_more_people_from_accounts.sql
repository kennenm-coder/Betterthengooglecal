-- ============================================================
-- 049 - More for More people come from the accounts
--
-- The people list (047) no longer has to be typed in. Every account
-- holding `installer-lead` or `installer` is on it, linked by email:
--
--   installer-lead -> suggested as a lead
--   installer      -> suggested as an apprentice
--
-- Payroll only sets each person's tier. A linked person's name
-- follows their account (Team page). An account that loses the role,
-- or is removed, stops being suggested (active = false); payroll's
-- tier is kept in case they come back. Typed-in people still work for
-- anyone without an account.
--
-- mfm_sync_people() does the work. It is SECURITY DEFINER because
-- leads cannot read allowed_emails themselves; it only copies names,
-- emails and roles into the people list, which every allowlisted
-- user can already read. The app calls it before loading the list,
-- so new accounts show up on their own. It also runs once below.
--
-- Run in Supabase SQL Editor. Idempotent -- safe to re-run.
-- 047 must be applied first.
-- ============================================================

BEGIN;

ALTER TABLE public.more_for_more_people
  ADD COLUMN IF NOT EXISTS email text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mfm_people_email
  ON public.more_for_more_people (lower(email))
  WHERE email IS NOT NULL;

CREATE OR REPLACE FUNCTION public.mfm_sync_people()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  added integer := 0;
BEGIN
  -- Anyone allowlisted (the form runs this for leads); the SQL editor
  -- (no signed-in user) for the one-off run below.
  IF auth.uid() IS NOT NULL AND NOT public.is_allowlisted() THEN
    RETURN 0;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS mfm_accts (email text PRIMARY KEY, nm text, kind text) ON COMMIT DROP;
  TRUNCATE mfm_accts;
  INSERT INTO mfm_accts (email, nm, kind)
  SELECT DISTINCT ON (lower(ae.email))
         lower(ae.email),
         coalesce(nullif(btrim(ae.name), ''), split_part(ae.email, '@', 1)),
         CASE WHEN coalesce(ae.roles, '{}') && ARRAY['installer-lead'] OR ae.role = 'installer-lead'
              THEN 'lead' ELSE 'apprentice' END
    FROM public.allowed_emails ae
   WHERE coalesce(ae.roles, '{}') && ARRAY['installer', 'installer-lead']
      OR ae.role IN ('installer', 'installer-lead');

  -- 1. Someone payroll already typed in by the same name: link them.
  UPDATE public.more_for_more_people p
     SET email = a.email, updated_at = now()
    FROM mfm_accts a
   WHERE p.email IS NULL
     AND lower(btrim(p.name)) = lower(a.nm)
     AND NOT EXISTS (SELECT 1 FROM public.more_for_more_people q WHERE lower(q.email) = a.email);

  -- 2. Linked names follow the account (unless that name is taken).
  UPDATE public.more_for_more_people p
     SET name = a.nm, updated_at = now()
    FROM mfm_accts a
   WHERE lower(p.email) = a.email
     AND p.name IS DISTINCT FROM a.nm
     AND NOT EXISTS (
       SELECT 1 FROM public.more_for_more_people q
        WHERE lower(btrim(q.name)) = lower(a.nm) AND q.id <> p.id);

  -- 3. New accounts join the list (tier left for payroll).
  INSERT INTO public.more_for_more_people (name, kind, email)
  SELECT a.nm, a.kind, a.email
    FROM mfm_accts a
   WHERE NOT EXISTS (SELECT 1 FROM public.more_for_more_people p WHERE lower(p.email) = a.email)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS added = ROW_COUNT;

  -- 4. Account gone or role removed: stop suggesting them.
  UPDATE public.more_for_more_people p
     SET active = false, updated_at = now()
   WHERE p.email IS NOT NULL
     AND p.active
     AND NOT EXISTS (SELECT 1 FROM mfm_accts a WHERE a.email = lower(p.email));

  RETURN added;
END;
$$;

REVOKE ALL ON FUNCTION public.mfm_sync_people() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mfm_sync_people() TO authenticated;

-- Fill the list now from the accounts that exist today.
SELECT public.mfm_sync_people();

COMMIT;

-- Verify (run separately):
--   select name, kind, tier, email, active from public.more_for_more_people order by name;
-- Expect every installer / installer-lead account, linked by email.
