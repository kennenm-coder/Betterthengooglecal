-- ============================================================
-- Migration 066: Job Alert -- several notes per person per job
--
-- 064 allowed ONE note per person per appointment. Kennen wants to open a
-- job's Job Alert and see everything already there, edit or delete their own
-- notes, and add a new one -- so a person can keep more than one note on a
-- job. Drops the one-per-person unique rule. Each note still belongs to its
-- writer (the 064 policies are unchanged: everyone reads, only the writer
-- edits or deletes), and the daily buzz still goes out once per job.
--
-- Safe to re-run. Run in Supabase SQL Editor.
-- ============================================================

BEGIN;

alter table public.job_alerts
  drop constraint if exists job_alerts_work_order_id_created_by_key;

COMMIT;

-- Check: expect 0 rows (the unique index is gone).
--   select indexname from pg_indexes
--    where tablename = 'job_alerts' and indexname = 'job_alerts_work_order_id_created_by_key';
