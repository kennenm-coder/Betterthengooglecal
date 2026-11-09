-- Special assignments (Special Ops / Office Day), shared with the scheduling app.
--
-- A scheduling manager drags a "Special Ops" or "Office Day" tile onto a crew's
-- day in the scheduling app. That stores a one-day, full-day row in
-- sched_availability_rules (kind special_ops / office_day, effective_start =
-- effective_end, no weekdays, no times). This migration lets the calendar app:
--
--   1. SHOW those days as tiles (no job information) via sched_special_days().
--   2. KEEP those crews out of the Floaters banner: sched_free_install_leads()
--      already skipped office_day; it now skips special_ops too.
--
-- The scheduling tables are locked to the scheduling roles (019), so the tile
-- feed is a SECURITY DEFINER function returning only a date, a crew name and
-- the kind -- same pattern as floaters (026). An installer is limited to their
-- own crew's days, mirroring how the calendar already scopes their jobs.
--
-- Needs 019 (is_allowlisted), 033/045 (is_installer, my_crew_names) and the
-- scheduling app's 20261109_001_special_ops_kind.sql applied first.
--
-- Safe to re-run (CREATE OR REPLACE).

BEGIN;

CREATE OR REPLACE FUNCTION public.sched_special_days(
  p_start date,
  p_end   date
)
RETURNS TABLE (work_date date, crew_name text, crew_aliases text[], kind text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $sd$
BEGIN
  IF NOT public.is_allowlisted() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN
    RETURN;
  END IF;

  IF p_end - p_start > 62 THEN
    RAISE EXCEPTION 'RANGE_TOO_WIDE: ask for 62 days or fewer';
  END IF;

  RETURN QUERY
  SELECT r.effective_start, c.name, COALESCE(c.aliases, '{}'), r.kind
  FROM sched_availability_rules r
  JOIN sched_crews c ON c.id = r.crew_id
  WHERE r.is_active
    AND c.is_active
    AND r.kind IN ('special_ops', 'office_day')
    -- Only the one-day tiles a drag creates. A recurring weekly Office Day from
    -- the resource editor is a schedule, not a tile, and stays off the calendar.
    AND r.effective_end = r.effective_start
    AND COALESCE(cardinality(r.weekdays), 0) = 0
    AND r.start_time IS NULL
    AND r.end_time IS NULL
    AND r.effective_start BETWEEN p_start AND p_end
    AND (
      NOT public.is_installer()
      OR lower(btrim(c.name)) = ANY (
        SELECT lower(btrim(n)) FROM unnest(public.my_crew_names()) AS n
      )
    )
  ORDER BY r.effective_start, c.name;
END;
$sd$;

REVOKE ALL ON FUNCTION public.sched_special_days(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sched_special_days(date, date) TO authenticated;

-- Floaters: identical to 028 apart from special_ops in the full-day kind list.
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
  ),
  -- Per-crew full-day blocks from the crew's own schedule. special_ops is the
  -- weather / standby day a manager drags onto a crew in the scheduling app.
  unavailable AS (
    SELECT DISTINCT r.crew_id AS id, days.d AS d
    FROM sched_availability_rules r
    CROSS JOIN days
    WHERE r.is_active
      AND r.kind IN ('pto', 'unavailable', 'late_day', 'office_day', 'special_ops')
      -- Times present means it blocks only those slots, not the whole day.
      AND r.start_time IS NULL
      AND r.end_time IS NULL
      AND days.d >= r.effective_start
      AND (r.effective_end IS NULL OR days.d <= r.effective_end)
      AND (
        COALESCE(cardinality(r.weekdays), 0) = 0
        OR EXTRACT(DOW FROM days.d)::int = ANY (r.weekdays)
      )
      AND (
        COALESCE(r.repeat_interval, 1) <= 1
        OR COALESCE(cardinality(r.weekdays), 0) = 0
        OR (
          (
            (
              ((days.d - EXTRACT(DOW FROM days.d)::int)
                 - (r.effective_start - EXTRACT(DOW FROM r.effective_start)::int)) / 7
            ) % r.repeat_interval + r.repeat_interval
          ) % r.repeat_interval
        ) = 0
      )
      AND NOT EXISTS (
        SELECT 1
        FROM sched_availability_exceptions e
        WHERE e.rule_id = r.id
          AND e.exception_date = days.d
          AND e.action = 'skip'
      )
  ),
  -- Company-wide whole-day blocks apply to everyone at once.
  closed AS (
    SELECT days.d AS d
    FROM sched_calendar_blocks b
    CROSS JOIN days
    WHERE b.is_active
      AND b.start_time IS NULL
      AND b.end_time IS NULL
      AND days.d >= b.start_date
      AND days.d <= COALESCE(b.end_date, b.start_date)
  )
  SELECT days.d, leads.id, leads.name
  FROM days
  CROSS JOIN leads
  WHERE NOT EXISTS (
    SELECT 1 FROM busy WHERE busy.id = leads.id AND busy.d = days.d
  )
  AND NOT EXISTS (
    SELECT 1 FROM unavailable u WHERE u.id = leads.id AND u.d = days.d
  )
  AND NOT EXISTS (
    SELECT 1 FROM closed cl WHERE cl.d = days.d
  )
  ORDER BY days.d, leads.name;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sched_free_install_leads(date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.sched_free_install_leads(date, date) TO authenticated;

COMMIT;
