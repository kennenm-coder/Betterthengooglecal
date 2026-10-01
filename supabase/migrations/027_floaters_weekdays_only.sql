-- Floaters: weekdays only.
--
-- Saturday and Sunday work is by request, so nobody is scheduled on them and
-- every install lead came back "free" — the whole roster, twice a week. True,
-- and useless: it buried the weekdays a manager actually looks at.
--
-- The weekend is now dropped at the source, so those days return no rows and
-- the banner hides itself the same way it does on a fully-booked day. The
-- week-by-week view in the client skips them to match.
--
-- Identical to 026 apart from the days CTE.
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
    -- Monday to Friday only (ISODOW: Mon = 1 … Sun = 7).
    SELECT g::date AS d
    FROM generate_series(p_start, p_end, interval '1 day') AS g
    WHERE EXTRACT(ISODOW FROM g) < 6
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

COMMIT;
