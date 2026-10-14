-- ============================================================
-- Migration 037: Lifecycle nudges on field write-ups
--
-- Write-ups should work their way through to archived on their own. Two
-- timestamps make that possible:
--
--   closed_at            when the row was last marked closed. Cleared when it
--                        is reopened; kept when it is archived. The app flags
--                        a write-up closed 3+ months as "should this be
--                        archived?", and one open 6+ months (from when it was
--                        written) as "does this still need to be open?".
--
--   nudge_snoozed_until  set when someone answers "keep it" / "still open".
--                        The flag stays quiet until this passes, then asks
--                        again. Any status change clears it.
--
-- Rows closed before this migration never had closed_at recorded, so their
-- last-updated time stands in for it.
--
-- Run in Supabase SQL Editor.
-- ============================================================

alter table public.field_work_orders
  add column if not exists closed_at timestamptz;

alter table public.field_work_orders
  add column if not exists nudge_snoozed_until timestamptz;

update public.field_work_orders
   set closed_at = updated_at
 where status in ('closed', 'archived')
   and closed_at is null;

comment on column public.field_work_orders.closed_at is
  'When this row was last marked closed. Null while open; kept through archive.';

comment on column public.field_work_orders.nudge_snoozed_until is
  'Archive/close nudge answered "not yet" — stay quiet until this time.';
