-- Floaters: respect the scheduling app's availability rules.
--
-- "Free" meant only "has no appointment", so a crew whose custom schedule has
-- them off — Shane Grounds is off Thursdays and Fridays — showed as a floater
-- on exactly the days they do not work. No job is not the same as available.
--
-- This mirrors getCrewAvailability() in RBANWO-Scheduling/src/lib/availability.ts,
-- specifically the `available === false` case, which is a FULL-DAY block:
--
--   * a per-crew rule of kind pto / unavailable / late_day / office_day that
--     carries NO start_time and NO end_time (times mean it blocks only the
--     overlapping 2-hour slots, not the day), or
--   * a company-wide calendar block (holiday / company_meeting) covering the
--     date with no times — those apply to every crew at once.
--
-- A rule applies to a date when the date is inside [effective_start,
-- effective_end], the weekday matches (empty weekdays = every day), the
-- biweekly/triweekly interval lands on that week, and no exception row skips
-- it. Weekday numbering agrees on both sides: JS getDay() and Postgres
-- EXTRACT(DOW) are both 0 = Sunday.
--
-- Week arithmetic matches date-fns differenceInCalendarWeeks with
-- weekStartsOn: 0 — each date is snapped back to its Sunday before dividing,
-- and the modulo is taken twice so negatives behave as they do in JS.
--
-- Identical to 027 apart from the new unavailable CTE and its NOT EXISTS.
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
  ),
  -- Per-crew full-day blocks from the crew's own schedule.
  unavailable AS (
    SELECT DISTINCT r.crew_id AS id, days.d AS d
    FROM sched_availability_rules r
    CROSS JOIN days
    WHERE r.is_active
      AND r.kind IN ('pto', 'unavailable', 'late_day', 'office_day')
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

COMMIT;
