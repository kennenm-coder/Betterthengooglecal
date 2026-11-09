-- Special assignments: tell the calendar which kind of crew a tile belongs to.
--
-- A Special Ops / Office Day tile has no work order, so it has no work order
-- type. The crew it sits on does have one (measure tech, install, ...). Duck
-- Force uses it to give a measure tech's tile the same audience as Tech Measure
-- appointments: admins and people holding the measure-tech role.
--
-- The return type changes (two new columns), so the old function is dropped
-- first. Same access rules as 050. Safe to re-run.

BEGIN;

DROP FUNCTION IF EXISTS public.sched_special_days(date, date);

CREATE FUNCTION public.sched_special_days(
  p_start date,
  p_end   date
)
RETURNS TABLE (
  work_date date,
  crew_name text,
  crew_aliases text[],
  kind text,
  crew_type text,
  additional_types text[]
)
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
  SELECT r.effective_start, c.name, COALESCE(c.aliases, '{}'), r.kind,
         c.crew_type::text, COALESCE(c.additional_types, '{}')::text[]
  FROM sched_availability_rules r
  JOIN sched_crews c ON c.id = r.crew_id
  WHERE r.is_active
    AND c.is_active
    AND r.kind IN ('special_ops', 'office_day')
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

COMMIT;
