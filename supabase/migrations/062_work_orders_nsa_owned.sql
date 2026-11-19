-- ============================================================
-- Migration 062: work_orders.nsa_owned — rForce's "NSA Ownership"
--
-- The work-order report now carries an "NSA Ownership" checkbox as its
-- last column (1 / 0). Jobs owned by the NSA get a marker on the tile
-- and on the expanded card, so the column lands on work_orders and is
-- passed through work_orders_visible.
--
-- APPLY THIS BEFORE DEPLOYING THE CODE THAT WRITES IT. The upload route
-- includes nsa_owned in its upsert whenever the report has the column;
-- against a table without it every hourly import would fail.
--
-- The flag is only ever written by a report that HAS the column. A
-- report without it leaves the stored value alone (see lib/nsa.ts), so
-- the default below is only the starting point for jobs nobody has
-- re-imported yet.
--
-- Not sensitive, so the installer view passes it through on EVERY row,
-- including other crews' jobs. The view body is 035's, restated
-- verbatim with one column added at the END — CREATE OR REPLACE VIEW
-- cannot insert a column anywhere else.
--
-- Run in the Supabase SQL Editor. Idempotent — safe to re-run.
-- ============================================================

BEGIN;

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS nsa_owned boolean NOT NULL DEFAULT false;

CREATE OR REPLACE VIEW public.work_orders_visible AS
WITH me AS MATERIALIZED (
  SELECT public.is_installer() AS restricted,
         public.my_crew_names() AS names
)
SELECT
  -- ── Always visible ──
  w.id,
  w.order_number,
  w.work_order_number,
  w.status,
  w.appointment_status,
  w.customer_name,
  w.contact_name,
  w.address,
  w.booking_date,
  w.scheduled_start,
  w.scheduled_end,
  w.work_order_type,
  w.order_owner,
  w.sales_rep,
  w.tech_measure,
  w.installer,
  w.service_rep,
  w.primary_resource,
  w.day_crews,
  w.order_alerts,
  w.account_name,
  w.job_close_date,
  w.latitude,
  w.longitude,
  w.uploaded_at,
  w.updated_at,

  -- Job size.
  w.product_count,
  w.total_units,
  w.windows,
  w.patio_doors,
  w.doors,

  -- ── Their own crew's jobs only ──
  CASE WHEN mine THEN w.phones ELSE NULL END                   AS phones,
  CASE WHEN mine THEN w.email ELSE NULL END                    AS email,
  CASE WHEN mine THEN w.combined_retail_total ELSE NULL END    AS combined_retail_total,
  CASE WHEN mine THEN w.description ELSE '' END                AS description,
  CASE WHEN mine THEN w.service_description ELSE '' END        AS service_description,
  CASE WHEN mine THEN w.scheduler_notes ELSE '' END            AS scheduler_notes,

  mine AS is_mine,

  -- Added by 062. Last, because CREATE OR REPLACE VIEW only appends.
  w.nsa_owned
FROM public.work_orders w
CROSS JOIN me
CROSS JOIN LATERAL (
  SELECT NOT me.restricted
         OR public.wo_is_mine(w.installer, w.primary_resource,
                              w.service_rep, w.day_crews, me.names) AS mine
) m
-- The only access gate on this view. See migration 035's SECURITY NOTE.
WHERE public.is_allowlisted();

-- CREATE OR REPLACE keeps the grants, but 035's are restated so this file
-- stands on its own.
GRANT SELECT ON public.work_orders_visible TO authenticated;
REVOKE ALL ON public.work_orders_visible FROM anon;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verify (run separately):
--   select count(*) filter (where nsa_owned) as nsa, count(*) as total
--     from public.work_orders_visible;
--   -- 0 NSA until the first report that carries the column is imported;
--   -- the 2026-11-19 sample report has 40 flagged rows across 23 orders.
