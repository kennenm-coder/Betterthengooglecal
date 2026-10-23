-- 039 — Active write-ups by address
--
-- Service work orders carry their own number, so the write-ups a service crew
-- needs were filed against the original install and can't be found by order
-- number. The calendar now pulls a thin index of every ACTIVE write-up on boot
-- (id, order_number, address) and matches it to each service tile's address.
--
-- That pull is the query this index serves: three columns, filtered to the two
-- statuses that count as active. Small today, but it runs on every app open for
-- every field manager, so it should never be a sequential scan of the table.
--
-- Address matching itself is done client-side (src/lib/address-match.ts), not
-- here: "123 N Main St" and "123 North Main Street, Springfield OR" are the
-- same house, and normalizing that in SQL would mean a generated column plus a
-- second index to keep in step with the app's rules.

create index if not exists idx_field_work_orders_active_address
  on public.field_work_orders (address)
  where status in ('in_review', 'open');
