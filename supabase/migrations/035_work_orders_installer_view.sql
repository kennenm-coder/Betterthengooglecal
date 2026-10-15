-- ============================================================
-- Migration 035: work_orders_visible — the installer's trimmed feed
--
-- Installers may find ANY job (they get reassigned mid-day and need
-- to look up where they are going), but only their own crew's jobs
-- come with the full packet. Everything else arrives without the
-- customer's phone/email, the retail total, or the product and
-- service descriptions.
--
-- That split is per COLUMN, and RLS is per ROW, so a policy cannot
-- express it. A view can. Installers — and, so there is only one
-- code path to get wrong, everyone else too — read
-- work_orders_visible instead of work_orders. For a non-installer
-- every column passes through untouched, so the view is a drop-in
-- for the table.
--
-- SECURITY NOTE: this view is owned by postgres and is therefore
-- SECURITY DEFINER (security_invoker = false, the default). It
-- BYPASSES row level security on work_orders. The allowlist check
-- in its WHERE clause is the only thing standing between it and any
-- authenticated Supabase account — do not remove it, and do not add
-- a column here without deciding which side of the split it is on.
--
-- 033 must be applied first (is_installer, my_crew_names).
--
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
-- ============================================================

BEGIN;

-- ── 1. Does this job belong to one of these crews? ───────────
-- Every name the job carries is checked, not just the one a tile
-- shows: all three raw rForce resource fields plus the scheduling
-- app's per-day crew map. A job where `installer` and
-- `primary_resource` name different people belongs to both.
--
-- Names fold to lowercase and collapse whitespace. rForce's fields
-- are free text and the roster is typed by hand, so the same person
-- arrives as "Keith Morris" and "keith  morris". Two different
-- people never collide under that, so folding only ever reunites a
-- crew with their own job.
--
-- Takes the name list as an argument rather than calling
-- my_crew_names() itself, so the caller can resolve it once per
-- statement instead of once per row. IMMUTABLE for the same reason.
--
-- An empty name list owns nothing — an installer with no resource
-- assigned sees no job as theirs, which is the intended fail-closed
-- behaviour.

CREATE OR REPLACE FUNCTION public.wo_is_mine(
  p_installer  text,
  p_primary    text,
  p_service    text,
  p_day_crews  jsonb,
  p_names      text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM (
      SELECT array(SELECT lower(regexp_replace(btrim(n), '\s+', ' ', 'g'))
                   FROM unnest(COALESCE(p_names, '{}')) AS n
                   WHERE btrim(n) <> '') AS ln
    ) x
    WHERE cardinality(x.ln) > 0
      AND (
        lower(regexp_replace(btrim(COALESCE(p_installer, '')), '\s+', ' ', 'g')) = ANY (x.ln)
        OR lower(regexp_replace(btrim(COALESCE(p_primary, '')), '\s+', ' ', 'g')) = ANY (x.ln)
        OR lower(regexp_replace(btrim(COALESCE(p_service, '')), '\s+', ' ', 'g')) = ANY (x.ln)
        OR EXISTS (
          SELECT 1
          FROM jsonb_each(COALESCE(p_day_crews, '{}'::jsonb)) AS d,
               jsonb_array_elements_text(d.value) AS nm
          WHERE lower(regexp_replace(btrim(nm), '\s+', ' ', 'g')) = ANY (x.ln)
        )
      )
  );
$$;

-- ── 2. The view ──────────────────────────────────────────────
-- `me` is MATERIALIZED so is_installer() and my_crew_names() run
-- once per statement, not once per row. For everyone who is not an
-- installer `mine` is true on every row and the CASEs are no-ops.

CREATE OR REPLACE VIEW public.work_orders_visible AS
WITH me AS MATERIALIZED (
  SELECT public.is_installer() AS restricted,
         public.my_crew_names() AS names
)
SELECT
  -- ── Always visible ──
  -- Who and where. An installer sent to another crew's job still
  -- needs the customer, the address, the order number to quote to
  -- the office, who else is on it, and the alerts (gate codes, dogs,
  -- parking) that keep them safe on arrival.
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

  -- Job size. Counts, not specifications — enough to judge how big a
  -- job is without describing what is being installed. Move these
  -- below the line if that reads as too much.
  w.product_count,
  w.total_units,
  w.windows,
  w.patio_doors,
  w.doors,

  -- ── Their own crew's jobs only ──
  -- Contact channels. The customer's name is visible above; the way
  -- to reach them is not, so nobody calls a customer about a job
  -- that is not theirs.
  CASE WHEN mine THEN w.phones ELSE NULL END                   AS phones,
  CASE WHEN mine THEN w.email ELSE NULL END                    AS email,
  -- Money.
  CASE WHEN mine THEN w.combined_retail_total ELSE NULL END    AS combined_retail_total,
  -- Product specs and install/service instructions.
  CASE WHEN mine THEN w.description ELSE '' END                AS description,
  CASE WHEN mine THEN w.service_description ELSE '' END        AS service_description,
  CASE WHEN mine THEN w.scheduler_notes ELSE '' END            AS scheduler_notes,

  -- Lets the app label a trimmed row rather than leaving the reader
  -- wondering why the phone number is blank.
  mine AS is_mine
FROM public.work_orders w
CROSS JOIN me
CROSS JOIN LATERAL (
  SELECT NOT me.restricted
         OR public.wo_is_mine(w.installer, w.primary_resource,
                              w.service_rep, w.day_crews, me.names) AS mine
) m
-- The only access gate on this view. See the SECURITY NOTE above.
WHERE public.is_allowlisted();

COMMENT ON VIEW public.work_orders_visible IS
  'work_orders with the sensitive columns blanked on jobs that do not belong to '
  'the calling installer. Identical to the table for every other role. Bypasses '
  'RLS (owner-rights view) — the is_allowlisted() predicate is the access gate.';

-- Explicit, not inherited: from 2026-10-30 Supabase stops granting Data API
-- access to new objects automatically (see 024). Read-only, and never anon —
-- the app's writes still go to the table.
GRANT SELECT ON public.work_orders_visible TO authenticated;
REVOKE ALL ON public.work_orders_visible FROM anon;

-- ── 3. Shut the direct door ──────────────────────────────────
-- Without this an installer just queries work_orders instead and the
-- view is decoration. Every other allowlisted role is unchanged.
--
-- The scheduling app and the auditor read work_orders too; they hold
-- scheduling / inventory-specialist roles, not installer, so they are
-- unaffected. Writes (admins_write_work_orders, the scheduling
-- insert/update from 019) are untouched.

DROP POLICY IF EXISTS "allowlisted_read_work_orders" ON public.work_orders;
CREATE POLICY "allowlisted_read_work_orders"
  ON public.work_orders
  FOR SELECT
  USING (public.get_user_role() IS NOT NULL AND NOT public.is_installer());

COMMIT;

-- The REST API will not serve a brand new view until PostgREST reloads its
-- schema cache. That normally happens on its own within a few seconds; this
-- makes it immediate, so the app does not 404 on work_orders_visible in the
-- gap.
NOTIFY pgrst, 'reload schema';

-- Verify (run separately):
--
-- As yourself (admin) — should match, and is_mine should be all true:
--   select count(*) from public.work_orders;
--   select count(*) from public.work_orders_visible;
--   select count(*) from public.work_orders_visible where not is_mine;
--
-- Signed in as a test installer:
--   select count(*) from public.work_orders;            -- expect 0
--   select count(*) from public.work_orders_visible;    -- expect all jobs
--   select count(*) from public.work_orders_visible where is_mine;
--   select customer_name, phones, description
--     from public.work_orders_visible where not is_mine limit 5;
--     -- expect a name, a null phone, an empty description
