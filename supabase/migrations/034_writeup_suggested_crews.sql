-- ============================================================
-- Migration 034: Suggested crews on field write-ups
--
-- Field managers can tag which resources (crews) could do a write-up's
-- work. It is a hint for the office when scheduling the return trip, not
-- an assignment, so it lives on the whole-job row of a submission next to
-- responsibility / defect_code and is a plain list of crew names as they
-- appear on the calendar.
--
-- `suggested_crews_all` says how to read a list of two or more: false
-- (default) = any ONE of them can take it; true = send ALL of them
-- together (a lead plus helpers). Meaningless for a list of one.
--
-- Shown only on the Write-Ups page expanded tile. NEVER in the PDF export
-- or the email — a crew whose name is missing would read it as a slight.
--
-- Run in Supabase SQL Editor.
-- ============================================================

alter table public.field_work_orders
  add column if not exists suggested_crews jsonb;

alter table public.field_work_orders
  add column if not exists suggested_crews_all boolean not null default false;

comment on column public.field_work_orders.suggested_crews is
  'Crew names that could do this write-up''s work (whole-job row only). '
  'Write-Ups tile only — never printed to the PDF or emailed.';

comment on column public.field_work_orders.suggested_crews_all is
  'With 2+ suggested crews: true = all of them go together, false = any one will do.';
