# Installer Role — Build Plan

**Status:** All four phases built. Not deployed, not committed.
**Decided:** 2026-10-13

> **Migrations 033, 035 and 036 must be applied to the live database, in
> that order, before this code ships.** The app now reads
> `work_orders_visible`, which 035 creates — without it the calendar loads
> nothing for everybody. 034 belongs to the write-up suggested-crews feature,
> not to this one.

## What we're building

A new `installer` role for the field calendar, more restricted than `member`.

**Their own jobs** — the jobs their install lead is on — get the full packet:
product specs, install instructions, customer phone, docs, everything a member
sees today.

**Every other job** is findable by search, but trimmed: customer name, address,
order number, who it's assigned to, measure tech, order owner, scheduled time
and order alerts. No phone numbers, no retail total, no product specs, no
install instructions.

The calendar grid itself shows only their own jobs. Search is what covers the
"sent somewhere else today" case.

## How an installer gets set up

1. Account request comes in → admin approves it on the Team page
2. Admin ticks **Installer** (and nothing else — the role is exclusive)
3. In the scheduling app, the person is added as a resource. Leads already
   exist; a helper is added with crew type **second** and their install lead set
   as `primary_crew_id`
4. Back on the Team page, admin picks which resource that login is

Step 4 is the link. The calendar has an email, the scheduling app has a name,
and nothing joins them today. Matching on the name text is not an option — that
is exactly what `sched_crews.aliases` exists to work around.

The Team page should refuse to save the installer role without a resource
picked, so a half-set-up account can't exist.

## Why it reads the scheduling app's roster

"Logan rides with Keith" already lives in the scheduling app, in
`sched_crews.primary_crew_id`, maintained by schedulers in the Resources screen.
The calendar reads it rather than keeping a second copy that drifts.

Same pattern the Floaters banner already uses: one narrow SECURITY DEFINER
function, role-gated inside, reaching into `sched_*` without opening those
tables up (see `026_floaters_free_install_leads.sql`).

### What counts as "my job"

Resolve the login to a crew, then to a lead (their `primary_crew_id`, or
themselves if they are a lead). A job is theirs when **their own name or their
lead's name** appears in either:

- `work_orders.day_crews` (any day) — how the scheduling app publishes crews
- `work_orders.installer` / `primary_resource` / `service_rep` — the raw rForce
  fields, for jobs the scheduling app never touched

Both halves are needed. `day_crews` is null on jobs that only came through the
import. `FilterPanel.tsx` already unions these two sources the same way.

## The field-level split

Postgres RLS is row-level — it cannot say "these eight columns of this row." So
installers don't read `work_orders` directly at all. They read a **view** that
nulls the sensitive columns on jobs that aren't theirs.

Column names and filters stay identical, so `store.ts` changes in exactly one
place — which table name it reads from — and all eight existing queries,
including the two-pass search, keep working untouched.

| Column | Other crews' jobs |
|---|---|
| customer_name, address, order_number, work_order_number | shown |
| installer, primary_resource, service_rep, tech_measure, order_owner, sales_rep | shown |
| scheduled_start / scheduled_end, status, work_order_type | shown |
| order_alerts | shown (carries gate/dog/access warnings) |
| day_crews, account_name, lat/long | shown |
| phones, email, contact_name | **stripped** |
| combined_retail_total | **stripped** |
| description, service_description | **stripped** |
| product_count, total_units, windows, patio_doors, doors | **shown** — job size, not specs. One-line change if you want these stripped too. |

## Four tables carry restricted data

| Table | Today | Change |
|---|---|---|
| `work_orders` | allowlisted read | installers read the trimmed view instead |
| `jobs` | **allowlisted FOR ALL** (read *and write*) | installers: read, own jobs only, no write |
| `install_docs` | allowlisted read | installers: own jobs only |
| `legacy_install_links` | allowlisted read | installers: own jobs only |

`jobs` is the one to watch. It is currently wide open to any allowlisted account
for both reading and writing, so it is both the product-spec leak and a write
hole. It must be in scope.

### A fifth: `/api/orders`

`src/app/api/orders/route.ts` serves `data/orders.json` (550 KB, every order)
from GitHub to **any** authenticated allowlisted user, with the repo's own
token and no role check. It bypasses RLS entirely, so none of the above
restrains it.

Nothing in the app calls it — it looks like a leftover from before the Supabase
move. Deleting it is almost certainly right; gating it to admin is the
conservative version. Either way it must be dealt with in Phase 3, or the whole
restriction is one fetch away from being pointless.

`jobs` and `install_docs` both key to `order_number`
(`jobs.data->job->>poNumber`), so the gate is a lookup against the installer's
own order numbers. `calendar_jobs()` is SECURITY INVOKER, so the gate flows
through it automatically — no change needed there.

## Migrations

Applied by hand in the Supabase SQL editor, as everything in this repo is.

**`033_installer_role.sql`**

- `allowed_emails.sched_crew_id uuid references sched_crews(id)` — the link. An
  id, not a name, so renaming a crew doesn't orphan the login.
- `public.is_installer_only()` — holds installer and nothing that grants broader
  read
- `public.my_crew_names()` — their name plus their lead's, read through the
  scheduling roster. SECURITY DEFINER, role-gated, floaters pattern.
- `public.wo_is_mine(installer, primary_resource, service_rep, day_crews)`

**`035_work_orders_installer_view.sql`**

- `public.work_orders_visible` — the trimmed view above
- Narrow the existing allowlisted-read policy on `work_orders` to exclude
  installer-only accounts
- Grant installers select on the view

**`036_installer_detail_tables.sql`**

- `jobs`: split the FOR ALL policy; installers get read, own jobs only
- `install_docs`: own jobs only for installers
- `legacy_install_links`: own jobs only for installers

## App changes

| File | Change |
|---|---|
| `src/hooks/useAuth.ts` | add `installer` to `UserRole`; expose the crew link |
| `src/lib/auth.ts` | same on the server side |
| `src/lib/roles.ts` | role option, label, style; `isInstallerOnly()`; keep every existing gate excluding it |
| `src/lib/store.ts` | read from `work_orders_visible` instead of `work_orders` for installers — one constant |
| `src/app/admin/page.tsx` | resource picker, exclusivity guard, refuse to save without a resource |
| `src/components/DataProvider.tsx` | lock the grid to their own jobs |
| `src/app/search/page.tsx` | leave search unscoped; mark rows that aren't theirs as limited |
| `src/components/OrderSheet.tsx` | hide the sections whose data came back empty |
| `src/app/install/[id]/page.tsx` | not their job → "this isn't one of your jobs" |
| `src/components/BottomNav.tsx` | hide Write-Ups, Time Off, Legacy Links, Admin |

## Build order

**Phase 1 — role and wiring, no enforcement. DONE.** Migration `033` adds
`allowed_emails.sched_crew_id`, `is_installer()` and `my_crew_names()`. The
Team page has the resource picker, refuses `installer` alongside any other
role, and refuses to save it without a resource. The calendar grid is scoped
to the installer's own crew; an unassigned installer gets a "your account
isn't finished" banner rather than a blank screen. Search is deliberately
left unscoped. Nothing is secured at the database level yet — an installer
still receives every job and could read the rest with the browser tools.

**Phase 2 — the view. DONE.** Migration `035` adds `wo_is_mine()` and the
`work_orders_visible` view, and narrows the `work_orders` read policy so
installers cannot go round it. Every role now reads the view — for a
non-installer it passes every column through untouched — so there is one
code path rather than two. `store.ts` reads through `WORK_ORDERS_READ`;
writes still go to the table. Rows carry `is_mine`, which is what lets a
screen label a trimmed job instead of showing unexplained blanks.

**Phase 3 — detail tables and back doors. DONE.** Migration `036` adds
`order_is_mine()` and gates `jobs`, `install_docs` and
`legacy_install_links` to the installer's own orders — read-only on `jobs`,
which also stops that role inheriting its pre-existing open write access.
`/api/orders` is now admin-only. `/api/import-logs` refuses installers: it
answers with the service-role key, so no RLS reaches it.

**Phase 4 — the edges. DONE.** The Changes tab is hidden and its page
refuses installers by URL. Search marks other crews' jobs "Not your job",
and the job sheet explains what is missing and why. The install-paperwork
page says the job belongs to another crew rather than "Job not found".
Time Off, Write-Ups and Legacy Links were already gated by role checks that
exclude installers.

## Watch out for

- **Roles stack.** Whatever any held role allows, you get. An installer who also
  has `member` ticked bypasses all of this. The Team page guard is load-bearing,
  not cosmetic.
- **Fail closed.** An installer with no resource picked yet sees nothing and a
  "ask an admin to finish setting up your account" message — never the full
  board.
- **Search performance.** The ownership check runs per row against an ilike
  search. Keep `my_crew_names()` stable so it resolves once per statement, and
  watch the first real search.
- **Loan-out days.** A second's login points at one lead. The day they ride with
  someone else, their grid shows the wrong crew's jobs — which is why unscoped
  search exists. This goes away only if the scheduling app starts auto-filling
  seconds onto appointments (see below).

## Not in scope, worth doing later

Make the scheduling app auto-fill a lead's default second when the lead is
booked, so a second's own name reaches `day_crews`. That fixes the loan-out case
here, but the real reason to do it is that the schedule currently does not know
who is on a job: the double-booking guard can't catch a second booked twice,
installer utilization reads seconds as idle, the loading schedule gives a
two-man crew one slot, and every tile in this calendar shows one name on two-man
jobs. Its own project, justified on its own.
