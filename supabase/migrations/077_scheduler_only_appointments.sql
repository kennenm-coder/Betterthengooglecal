-- ============================================================
-- Migration 077: Scheduling-app-only appointments
--
-- Kennen, 2026-11-20: when the scheduler books an appointment that rForce does
-- not have (yet, or at all), Duck Force should still show it -- as its own
-- "Scheduling app only" tile -- so field managers know it is coming even though
-- rForce is not picking it up.
--
-- Everything else about the calendar is unchanged: rForce stays the only source
-- for times, status and details of every job it knows about. This function only
-- answers "which live scheduling-app appointments have NO rForce counterpart?"
--
-- An appointment counts as having a counterpart (and is NOT returned) when ANY of:
--   1. it has an active link to an rForce work order (sched_appointment_links);
--   2. a work_orders row carries the same work order number;
--   3. it has no work order number but shares an ORDER number with a work_orders
--      row whose dates overlap the appointment's days (a manual booking that
--      rForce has since caught up with under a number we were never told).
-- "A work_orders row" means any type -- including JIP, LSWP, HOA, Paint/Stain and
-- Collections, which rForce has but Duck Force does not draw. rForce knowing
-- about it means rForce IS picking it up, so no tile.
--
-- Only live appointments count: scheduled, confirmed, in progress. Cancelled,
-- unscheduled (no date), rescheduled and complete ones are skipped.
--
-- The scheduling tables are locked to the scheduling roles (019), so the feed is
-- a SECURITY DEFINER function returning only what a tile shows: type, customer,
-- address, order/WO number, the days, the times and the crew names. No notes, no
-- flags. Same pattern, same guards, as sched_special_days (050). An installer is
-- limited to appointments with their own crew on them, like their other jobs.
--
-- Needs 019 (is_allowlisted), 033 (is_installer, my_crew_names) and the
-- scheduling app's sched_crew_days (20261001_001). Safe to re-run.
-- Run in Supabase SQL Editor.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.sched_unmatched_appointments(
  p_start date,
  p_end   date
)
RETURNS TABLE (
  appointment_id    uuid,
  appointment_type  text,
  customer_name     text,
  address           text,
  order_number      text,
  work_order_number text,
  scheduled_date    date,
  last_date         date,
  start_time        text,
  end_time          text,
  lead_crew         text,
  day_crews         jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
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
  WITH base AS (
    SELECT a.*,
           (a.scheduled_date + GREATEST(COALESCE(a.duration_days, 1), 1) - 1) AS last_day
    FROM sched_appointments a
    WHERE a.status IN ('scheduled', 'confirmed', 'in_progress')
      AND a.scheduled_date IS NOT NULL
      -- The scheduler also books placeholder "customers" to hold a crew's day
      -- ("DO NOT SCH", "SPECIAL OPS", and typos of it). They are not jobs and rForce
      -- will never have them, so they must not become tiles.
      AND a.customer_name !~* '(^|[^a-z])do[ _-]+not[ _-]+sch'
      AND a.customer_name !~* '(^|[^a-z])spe?c[a-z]*[ _-]+ops([^a-z]|$)'
      AND a.scheduled_date <= p_end
      AND (a.scheduled_date + GREATEST(COALESCE(a.duration_days, 1), 1) - 1) >= p_start
      -- 1. linked to an rForce work order
      AND NOT EXISTS (
        SELECT 1 FROM sched_appointment_links l
        WHERE l.appointment_id = a.id AND l.unlinked_at IS NULL
      )
      -- 2. same work order number as a work_orders row
      AND NOT EXISTS (
        SELECT 1 FROM work_orders w
        WHERE btrim(COALESCE(a.work_order_number, '')) <> ''
          AND btrim(w.work_order_number) = btrim(a.work_order_number)
      )
      -- 3. no work order number on the appointment, but rForce has the same ORDER
      --    on those days. (An appointment WITH a work order number that rForce
      --    lacks must not be suppressed by a sibling work order on the same
      --    order -- an order carries a measure, an install and services.)
      AND NOT EXISTS (
        SELECT 1 FROM work_orders w
        WHERE btrim(COALESCE(a.work_order_number, '')) = ''
          AND btrim(COALESCE(a.order_number, '')) <> ''
          AND btrim(w.order_number) = btrim(a.order_number)
          AND w.scheduled_start IS NOT NULL
          AND left(w.scheduled_start::text, 10)::date
                <= (a.scheduled_date + GREATEST(COALESCE(a.duration_days, 1), 1) - 1)
          AND left(COALESCE(w.scheduled_end, w.scheduled_start)::text, 10)::date
                >= a.scheduled_date
      )
  ),
  per_day AS (
    SELECT b.id, cd.work_date, jsonb_agg(DISTINCT c.name ORDER BY c.name) AS names
    FROM base b
    CROSS JOIN LATERAL sched_crew_days(
           b.crew_id, b.secondary_crew_id, b.tertiary_crew_id,
           b.secondary_day_offsets, b.tertiary_day_offsets,
           b.scheduled_date, b.duration_days
         ) AS cd
    JOIN sched_crews c ON c.id = cd.crew_id
    GROUP BY b.id, cd.work_date
  ),
  crew_map AS (
    SELECT pd.id,
           jsonb_object_agg(pd.work_date::text, pd.names) AS day_crews,
           ARRAY(
             SELECT DISTINCT lower(btrim(n))
             FROM per_day p2, jsonb_array_elements_text(p2.names) AS n
             WHERE p2.id = pd.id
           ) AS crew_keys
    FROM per_day pd
    GROUP BY pd.id
  )
  SELECT b.id,
         b.appointment_type::text,
         b.customer_name,
         b.address,
         b.order_number,
         b.work_order_number,
         b.scheduled_date,
         b.last_day,
         b.start_time::text,
         b.end_time::text,
         lc.name,
         cm.day_crews
  FROM base b
  LEFT JOIN sched_crews lc ON lc.id = b.crew_id
  LEFT JOIN crew_map cm ON cm.id = b.id
  WHERE (
    NOT public.is_installer()
    OR COALESCE(cm.crew_keys, '{}') && ARRAY(
         SELECT lower(btrim(m)) FROM unnest(public.my_crew_names()) AS m
       )
  )
  ORDER BY b.scheduled_date, b.start_time, b.customer_name;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sched_unmatched_appointments(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sched_unmatched_appointments(date, date) TO authenticated;

COMMIT;
