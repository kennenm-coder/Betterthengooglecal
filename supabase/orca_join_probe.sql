-- ============================================================
-- Orca join probe — "how would you match it?", answered with numbers
--
-- ⚠ THIS DOES NOT WORK YET, AND IT NEVER TOUCHES ORCA.
--
-- Orca Scan is a separate system. No SQL of ours can query it. What
-- this file reads is `public.orca_rows` — a COPY of Orca's data kept
-- inside Supabase, fed by the webhook. That table:
--
--     * does not exist until migration 039 is applied
--     * is empty until scripts/orca-backfill.mjs has loaded an export
--
-- Run it before both of those and you get, correctly:
--     ERROR: relation "public.orca_rows" does not exist
--
-- ➜ TO ANSWER THE JOIN QUESTION TODAY, use the other probe. It reads
--   the Orca CSV export straight off disk and needs no migration:
--
--       node scripts/orca-join-probe.mjs "C:/path/to/export.csv"
--
-- This SQL version is for later — once the mirror is live, it is the
-- quicker way to re-check the same things as the data changes.
--
-- Read-only. Nothing here writes.
--
-- The question it settles: Orca labels rows with the factory's 7-digit
-- Job Order Number, we label everything with an 8-digit order number,
-- and almost no row carries both. Where does the join come from?
-- ============================================================


-- ── 1. What are we actually looking at? ─────────────────────
-- A shape count first, so the rest has something to be a fraction of.

select
  count(*)                                                      as rows_total,
  count(*) filter (where btrim(coalesce(customer_po,'')) ~ '^[0-9]{8}$')
                                                                as po_is_ours,
  count(*) filter (where btrim(coalesce(customer_po,'')) ~ '^ZX')
                                                                as po_is_factory,
  count(*) filter (where coalesce(job_order_number,'') <> '')   as has_job_number,
  count(*) filter (where order_number is not null)              as resolved_today
from public.orca_rows
where deleted_at is null;


-- ── 2. The free links, harvested from rows that carry both ──
-- Some rows already have OUR order number in Customer PO *and* the
-- factory's Job Order Number. Each one of those is a confirmed link,
-- sitting in the data, costing nobody anything. And because a link
-- places every row sharing that job number, a handful of these can
-- place hundreds of rows.
--
-- This is the single highest-value query here. If `would_place` comes
-- back large, the join is largely a solved problem already.

with pairs as (
  select distinct
    btrim(job_order_number) as job_order_number,
    btrim(customer_po)      as order_number
  from public.orca_rows
  where deleted_at is null
    and btrim(coalesce(customer_po,'')) ~ '^[0-9]{8}$'
    and coalesce(job_order_number,'') <> ''
),
-- A job number that points at two different order numbers is not a
-- link, it is a data problem. Those are excluded and listed below.
clean as (
  select job_order_number, min(order_number) as order_number
  from pairs
  group by job_order_number
  having count(distinct order_number) = 1
)
select
  (select count(*) from clean)                                   as links_available,
  (select count(*) from public.orca_rows r
     join clean c on c.job_order_number = r.job_order_number
    where r.deleted_at is null and r.order_number is null)       as would_place;

-- The ambiguous ones, if any — look at these before trusting the above.
with pairs as (
  select distinct
    btrim(job_order_number) as job_order_number,
    btrim(customer_po)      as order_number
  from public.orca_rows
  where deleted_at is null
    and btrim(coalesce(customer_po,'')) ~ '^[0-9]{8}$'
    and coalesce(job_order_number,'') <> ''
)
select job_order_number, array_agg(order_number) as competing_order_numbers
from pairs
group by job_order_number
having count(distinct order_number) > 1;


-- ── 3. Is our order number hiding in the Name column? ───────
-- The factory rows' Name looks like `-,04794151/097`. That 8-digit
-- number is our order-number shape. If it IS our order number, then
-- roughly 1,300 rows can resolve themselves with no process change at
-- all — no retyping at receiving, no new rForce column, nothing.
--
-- This is the query that decides it. `confirmed` counts the ones whose
-- extracted number is a real order in work_orders; `not_in_work_orders`
-- is the number that look right but match nothing of ours.

with guesses as (
  select
    r.barcode,
    r.name,
    substring(coalesce(r.name,'') from '(?<![0-9])([0-9]{8})(?![0-9])') as guess
  from public.orca_rows r
  where r.deleted_at is null
    and r.order_number is null
)
select
  count(*)                                        as unresolved_rows,
  count(guess)                                    as name_holds_an_8_digit,
  count(*) filter (where guess is not null
                     and exists (select 1 from public.work_orders w
                                  where w.order_number = guess))
                                                  as confirmed_real_orders,
  count(*) filter (where guess is not null
                     and not exists (select 1 from public.work_orders w
                                      where w.order_number = guess))
                                                  as not_in_work_orders
from guesses;

-- A sample to eyeball, whichever way the counts land.
with guesses as (
  select
    r.name,
    r.barcode,
    substring(coalesce(r.name,'') from '(?<![0-9])([0-9]{8})(?![0-9])') as guess
  from public.orca_rows r
  where r.deleted_at is null and r.order_number is null
)
select g.name, g.barcode, g.guess, w.customer_name
from guesses g
left join public.work_orders w on w.order_number = g.guess
where g.guess is not null
limit 25;


-- ── 4. Does the barcode carry the job number? ───────────────
-- Factory barcodes look like `98124444.003`, and `8124444` is the job
-- number with a 9 stuck on the front. If that holds, a row missing its
-- Job Order Number column can still be grouped with its siblings.

select
  count(*)                                                    as rows_checked,
  count(*) filter (
    where coalesce(job_order_number,'') <> ''
      and barcode like '9' || btrim(job_order_number) || '%')  as barcode_matches_job,
  count(*) filter (
    where coalesce(job_order_number,'') <> ''
      and barcode not like '9' || btrim(job_order_number) || '%') as barcode_differs
from public.orca_rows
where deleted_at is null;


-- ── 5. How much would each strategy be worth? ───────────────
-- Side by side, on the real data, so the choice is arithmetic rather
-- than argument.

with r as (
  select * from public.orca_rows where deleted_at is null
)
select
  'already resolved'          as strategy,
  count(*) filter (where order_number is not null) as rows_placed
from r
union all
select
  'harvest links from rows carrying both',
  (select count(*) from r r2
    where r2.order_number is null
      and r2.job_order_number in (
        select btrim(job_order_number) from r r3
         where btrim(coalesce(r3.customer_po,'')) ~ '^[0-9]{8}$'
           and coalesce(r3.job_order_number,'') <> ''))
union all
select
  '8-digit number inside Name, confirmed against work_orders',
  (select count(*) from r r4
    where r4.order_number is null
      and exists (
        select 1 from public.work_orders w
         where w.order_number = substring(coalesce(r4.name,'')
                                 from '(?<![0-9])([0-9]{8})(?![0-9])')));
