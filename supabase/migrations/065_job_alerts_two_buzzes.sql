-- ============================================================
-- Migration 065: Job Alert -- two buzzes, to every field manager
--
-- Kennen, 2026-11-19: Job Alert is a PUSH (phone buzz + bell entry), not an
-- email, it goes to ALL field managers and admins (not just the writer), and
-- it goes off twice: 5 business days before the appointment and the business
-- day before (a Monday job buzzes the Monday before and the Friday before).
-- One buzz per job, listing every field manager's note with who wrote it.
--
-- Each note records, per buzz, which appointment date it was already sent for,
-- so a rescheduled job buzzes again for its new date:
--   sent5_for_date -- the 5-business-day buzz
--   sent1_for_date -- the business-day-before buzz
-- 064's sent_for_date / send_error belonged to the email version and are no
-- longer used (left in place; nothing reads them). sent_at = last buzz time.
--
-- Safe to re-run. Run in Supabase SQL Editor.
-- ============================================================

BEGIN;

alter table public.job_alerts add column if not exists sent5_for_date date;
alter table public.job_alerts add column if not exists sent1_for_date date;

comment on column public.job_alerts.sent5_for_date is
  'Appointment date the 5-business-day buzz already went out for. Migration 065.';
comment on column public.job_alerts.sent1_for_date is
  'Appointment date the business-day-before buzz already went out for. Migration 065.';
comment on column public.job_alerts.sent_for_date is
  'Unused since 065 (was the email reminder).';

COMMIT;

-- Check: expect both columns.
--   select column_name from information_schema.columns
--    where table_name = 'job_alerts' and column_name in ('sent5_for_date', 'sent1_for_date');
