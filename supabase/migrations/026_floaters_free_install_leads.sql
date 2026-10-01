-- Floaters: which install leads have no job on a given day.
--
-- Field managers need to see who is free, but 019 locked every sched_* table to
-- the scheduling roles, and those tables hold customer names, addresses and
-- phones. Rather than widen that, this exposes ONE function returning only crew
-- names and dates — no customer data, no roster beyond the install leads.
--
-- SECURITY DEFINER so it can read sched_crews/sched_appointments on behalf of a
-- caller who cannot, with an explicit role gate inside: the definer right is
-- scoped to this one question, not handed over wholesale.
--
-- "Free" means no live appointment that day. It leans on sched_crew_days(), so
-- a helper booked for only part of a multi-day install counts as free on the
-- days they are not there (see 20261001_001 in the scheduling repo).
--
-- Safe to re-run (CREATE OR REPLACE).

BEGIN;

CREATE OR REPLACE FUNCTION public.sched_free_install_leads(
  p_start date,
  p_end   date
)
RETURNS TABLE (work_date date, crew_id uuid, crew_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- The definer right ends here. Field managers and admins see this; so do the
  -- scheduling roles, who could read the underlying tables anyway.
  IF NOT public.has_any_role(
       ARRAY['admin', 'field-manager', 'scheduling', 'scheduling_manager']
     ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: floaters are limited to field managers and admins';
  END IF;

  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN
    RETURN;
  END IF;

  -- Bounded so a caller cannot ask for years of the calendar in one go.
  IF p_end - p_start > 62 THEN
    RAISE EXCEPTION 'RANGE_TOO_WIDE: ask for 62 days or fewer';
  END IF;

  RETURN QUERY
  WITH days AS (
    SELECT generate_series(p_start, p_end, interval '1 day')::date AS d
  ),
  leads AS (
    -- Install crews only. additional_types catches a resource that installs
    -- alongside another role, which is how multi-role crews are modelled.
    SELECT c.id, c.name
    FROM sched_crews c
    WHERE c.is_active
      AND (
        c.crew_type IN ('install_in_house', 'install_sub')
        OR c.additional_types && ARRAY['install_in_house', 'install_sub']
      )
  ),
  busy AS (
    SELECT DISTINCT cd.crew_id AS id, cd.work_date AS d
    FROM sched_appointments a
    CROSS JOIN LATERAL sched_crew_days(
           a.crew_id, a.secondary_crew_id, a.tertiary_crew_id,
           a.secondary_day_offsets, a.tertiary_day_offsets,
           a.scheduled_date, a.duration_days
         ) AS cd
    WHERE a.status NOT IN ('cancelled', 'unscheduled')
      AND a.scheduled_date IS NOT NULL
      -- Only spans that can touch the window at all.
      AND a.scheduled_date <= p_end
      AND a.scheduled_date + GREATEST(COALESCE(a.duration_days, 1), 1) > p_start
  )
  SELECT days.d, leads.id, leads.name
  FROM days
  CROSS JOIN leads
  WHERE NOT EXISTS (
    SELECT 1 FROM busy WHERE busy.id = leads.id AND busy.d = days.d
  )
  ORDER BY days.d, leads.name;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sched_free_install_leads(date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.sched_free_install_leads(date, date) TO authenticated;

COMMIT;
