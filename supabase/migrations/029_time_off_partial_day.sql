-- ============================================================
-- Migration 029: partial-day time off
--
-- Time off has been whole days only: a start date, an optional end date,
-- and the person is simply "off". Most of the real requests aren't that
-- clean — someone leaves at noon on Thursday and is back at nine on Friday.
-- Until now that got written as a full day off, which overstates it.
--
-- Two optional clock times, one on each end of the range:
--
--   start_time  when they leave on start_date   (NULL = gone all day)
--   end_time    when they return on end_date    (NULL = out all day)
--
-- Both stay nullable and nothing reads them for scheduling yet — the
-- banner, the week bar, and the requests table display them, and that is
-- all. Anything that decides who is available (floaters, availability)
-- still treats a day inside the range as a full day off.
-- ============================================================

ALTER TABLE public.time_off_requests
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time   time;

COMMENT ON COLUMN public.time_off_requests.start_time IS
  'Optional time of day the employee leaves on start_date. NULL = off the whole day.';
COMMENT ON COLUMN public.time_off_requests.end_time IS
  'Optional time of day the employee returns on end_date (or start_date for a single-day request). NULL = off the whole day.';
