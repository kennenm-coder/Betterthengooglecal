# Installer Scan-Out — Build Plan

**Status:** Plan only. Nothing built, nothing committed, no Orca data touched.
**Decided:** 2026-10-19 — the checklist lives in THIS app (the calendar), because
installers already live here. The cut-list app keeps the Orca write plumbing it
already has.
**Revised:** 2026-10-19 — checked against the calendar's own code; the
corrections are folded in below and called out where they land.

> **Rule for whoever builds this: do not write to the Inventory 2026 sheet
> while building.** It is the live warehouse. The only test write allowed is to
> a row named `ZZ DEMO` that Kennen has created by hand, and only after he says
> go. The WebHook Out **Test** button in Orca is safe — it sends a `test` event
> and writes nothing. Everything in Phases 1 and 2 can be built and shipped
> without a single write.

## What we're building

An installer opens a job's install paperwork, sees every Orca inventory row
that belongs to that job — windows, doors, hardware, trim bundles — and ticks a
box per row as they load it. Each tick writes back to Orca: the row's
`Loading Status` becomes `Loaded` and `Installer` becomes the person who ticked
it. Unticking puts it back to `Staged`. The warehouse and the office can then see,
per job, that everything is in and gone out the door.

The install paperwork's unit list is **not** a second checklist. It is used to
**cross-reference**: "Orca has rows for 11 units; this job has 12 — here is the
one with nothing in the warehouse."

Kennen's framing: *"identify what items in orca apply to a job and then have
them check off the line items … the unit section could be used to cross
reference with orca and make sure there's a line item for each item."*

**Phases 1 and 2 are view-only** — the installer sees the list and the
cross-reference but cannot tick anything. That is deliberately shippable on its
own, and is what "view only for now" means here.

## What already exists (don't rebuild it)

**In Orca.** The Inventory 2026 sheet already has the whole vocabulary:

| column | values in use today |
|---|---|
| `Loading Status` | `Staged` (237 rows), `Not Staged` (38), blank (1427) |
| `Stager` | Auston, Greg, Helper, Jake, Matt, Tait, Tyler |
| `Installer` | Alex, Dave, Jason, Josh Maas, Josh Mac, Keith, Ken, Logan, Matt, Morgan, Randy, Sam, Shane, Tim Fitz, Tom, Trevor (+ "Installer") |
| `Staged out` | a date |
| `Status` | Backordered, Not Received, Ordered, Received, Returned, Sent Out, Sent To Paint/Stain, Stock |

So the stager/installer workflow is real and in use — filled in by hand today.
This feature lets the installer drive the last step of it from their phone.

Full column list (40): Barcode, Name, Customer PO, Expected Quantity, How Much
to Order, Status, Actual Quantity, Location, Vendor, Floor ID, Description,
Stager, Loading Status, Installer, SO Line Item, SO Reference B, RForce Link,
Price, Total Stock Value, Actual Ship Date, SO Line Item Variant, BO Qty, Job
Order Number, Backorder ETA, Staged out, SO Sequence, Truck Ship Date, Order
Qty, Attachment, Delivered Qty, Received Date, Stock on hand, Component
Ordered, Notes, SO Position, Last Modified By, Changed By, Changed On, GTIN-14,
UPC-A.

**In this app.** The `installer` role (migrations 033/035/036,
`INSTALLER_ROLE_PLAN.md`): exclusive, tied to a crew via
`allowed_emails.sched_crew_id`. `my_crew_names()` returns the login's own
resource name, their lead's, and both rosters' aliases — as one unordered set,
not own-name-first. `order_is_mine(order_number)` answers "is this
8-digit order one of mine". `useAuth()` exposes `crewNames` to the client for
installers. `src/app/install/[id]/page.tsx` already renders the Unit Summary and
NWO Material List from `install_docs`; `[id]` is `jobs.id` and the PO comes from
`doc.header.poNumber`. `src/lib/auth.ts` has `requireAuth()` and
`getAdminClient()` (service role). Migrations are applied by hand in the SQL
editor; next number is **039**.

**In the cut-list app.** `lib/orcaInventory.js` + `app/api/orca/route.ts` already
write trim bundles into the **Trim Inventory** sheet via WebHook In, one row per
job per vendor, barcode `RBA-<PO>-<ABBR>-<DDMMYYHHMMSS>`. Everything learned
there about Orca is in that repo's `CLAUDE.md` under "Orca Scan". Read it first.
The short version is below.

## The two sheets

| sheet | WebHook In URL | holds |
|---|---|---|
| Inventory 2026 | `https://api.orcascan.com/sheets/XLrm9ppKJ225z0df` | factory units, doors, hardware, parts — one row per SO line item |
| Trim Inventory | `https://api.orcascan.com/sheets/LBewDR8Om02X3zPl` | trim bundles the cut-list app writes, one row per job per vendor |

The token in a WebHook In URL is **probably not** the sheet's internal id. The
`orca-sheet-id` header on a WebHook Out request is. Learn each sheet's real id
from the first **Test** payload and keep those as the constants the receiver
checks against — don't assume the URL token.

## How Orca talks (established facts, not guesses)

**Reading — WebHook Out** (Sheet Settings → Events API). Orca POSTs JSON to a
URL of ours on every change. Row values are keyed by **column name**, plus
system fields `___orca_event` (`rows:add`, `rows:update`, `rows:delete`,
`rows:import:append`, `rows:import:replace`, `columns:*`, `sheet:*`, `test`),
`___orca_row_id`, `___orca_sheet_name`, `___orca_user_email`. Headers:
`orca-sheet-id`, `orca-timestamp`, `orca-secret`, `orca-request-type:
webhook-out`, `orca-user-email`. One POST per change; imports arrive as one
request carrying a `rows` array. **Retry and timeout behaviour is undocumented**
— the receiver must be idempotent and answer fast.

**One thing here is NOT established, and the plan leans on it:** whether Orca
fires WebHook Out for a change *we* made through WebHook In. Kennen's read
(2026-10-19) is that this is fine — the material-list app already gets
confirmation back when it writes trim bundles — and the plan is to test it
rather than design around it. Worth keeping the two apart while testing,
though: WebHook In answering **200** only says Orca accepted the request, and
it answers 200 for a dropped select value too. The echo is a *separate*
message arriving at `/api/orca/events` afterwards. If only the 200 comes back,
the silent-drop detection is gone even though the write itself works. Everything in
Phase 3 that catches a silently-dropped value, and everything that keeps two
phones on one job in step, depends on that echo coming back. Plenty of systems
suppress the events they caused themselves. Prove it in Phase 0 against the
`ZZ DEMO` row before building on it — if there is no echo, the scan route has
to read the row back itself and the "ticks, then unticks itself" tell is gone.

**Writing — WebHook In.** POST JSON to the sheet's URL with
`___orca_action: "update"`, the `Barcode`, and only the fields to change.
`orca-secret` header if the sheet has a Secret. Limits: 100 rows per request,
15 requests per second. Two hazards:

1. **`update` creates the row if the barcode doesn't exist.** For this feature
   that is a bug, not a feature — a typo'd barcode would add a junk row to the
   live inventory. The writer must only ever send a barcode it got from the
   mirror.
2. **Select columns fail silently.** `Loading Status`, `Status`, `Location` are
   guarded selects. A value not on the option list returns HTTP 200 and leaves
   the cell blank or defaulted. `Loaded` does not exist on any column today.
   Nothing works until it is added, and nothing will tell you it hasn't been.

**The REST API** (`api.orcascan.com/v1/…`) needs a Business subscription and
answers 403 on our plan. Don't spend time on it.

## The join problem — read this before anything else

The checklist needs "which Orca rows belong to this job". Profiling the
Inventory 2026 export (1,702 rows) on 2026-10-19:

| key in Orca | format | rows that have it | matches something of ours? |
|---|---|---|---|
| `Customer PO` | 8-digit `04717321` | **154** | yes — `work_orders.order_number` / `jobs.data->job->>poNumber` |
| `Customer PO` | factory `ZX3162953P` | **1,321** | no |
| `Job Order Number` | 7-digit `8124444` | **1,531** (never maps to more than one PO) | **no** — not in `work_orders`, not in the rForce export's 22 columns, not in the cut-list job |
| `Name` | `Abbott,Kelly` on PO rows, `/007` or `-,04794151/097` on ZX rows | — | unusable |
| `RForce Link` | — | 0 | empty |

So: the key Orca reliably has (`Job Order Number`, the factory's job id — the
barcodes even embed it: `98124444.003…` ↔ `8124444`) is one this app has
never seen, and the key this app has (`order_number`) is on fewer than one row
in ten. **For roughly 90% of rows the join is not solvable from the data either
side holds today.** This is the first thing to settle, and it is a process
question, not a code one.

Options, in order of preference:

**A. Get the Job Order Number onto our side.** It is an rForce field. If the
hourly Power Automate export (`src/app/api/upload/route.ts`) can carry it as a
23rd column into `work_orders`, the join is automatic, covers every factory row,
and costs the warehouse nothing. Needs someone to find the field in rForce and
add it to the report.

**B. Have the warehouse put the 8-digit order number in `Customer PO`** on
every row at receiving. Zero code. But it is 1,300 rows of retyping on day one,
a habit forever after, and one missed row is one invisible item.

**C. Mapping table maintained by the office.** `orca_job_links(job_order_number
→ order_number)`, filled by hand per job. Works, scales badly.

**D. Harvest the links the data already holds.** Added 2026-10-19, after
looking at the profile again. Some rows carry BOTH our 8-digit order number in
`Customer PO` *and* the factory's `Job Order Number` — and a link places every
row sharing that job number, so one such row can place the fifteen siblings
that carry only one of them. That costs nobody anything and needs no decision.
`supabase/orca_join_probe.sql` measures exactly what it is worth on the real
rows; migration 041's `orca_harvest_links()` does it, skipping any job number
with two competing answers and never overwriting a hand-made link.

**And one to test before paying for A, B or C:** the factory rows' `Name`
looks like `-,04794151/097`. That 8-digit number is our order-number shape. If
it really is our order number, about 1,300 rows resolve themselves with no
process change at all. The resolver already tries it as a last resort, and
section 3 of the probe counts how many of those guesses are real orders in
`work_orders`. Worth running before asking anyone to retype anything.

Whichever wins, the schema below carries an `order_number` column on the
mirror, filled by a resolver that tries each source in turn. That keeps the
code the same across A, B, C and D — only the resolver's input changes.

**The Trim Inventory sheet has no such problem**: the cut-list app writes the
8-digit PO into the barcode and the Name, so its rows resolve directly.

## Architecture

```
Orca (both sheets) ──WebHook Out──► POST /api/orca/events ──► orca_rows  (Supabase mirror)
                                                                  │
                                              /install/[id] reads rows for this PO (RLS-gated)
                                                                  │
   tick ──► POST /api/orca/scan ──WebHook In──► Orca ──WebHook Out──► orca_rows (echo confirms)
```

The mirror is the only thing the UI reads. It stays honest when the warehouse
edits Orca directly, because that edit comes back through WebHook Out too. A
tick writes the mirror optimistically on Orca's 200 and the echo overwrites it
with whatever Orca actually stored — which is how a silently-dropped `Loaded`
would show up as a row that ticks and then unticks itself. That echo is an
assumption until Phase 0 proves it (see above); the rest of the diagram holds
either way.

## Data model — migration `039_orca_mirror.sql`

```sql
create table public.orca_rows (
  sheet_id          text not null,            -- Orca's internal id (from orca-sheet-id)
  barcode           text not null,
  orca_row_id       text,                     -- ___orca_row_id; null until the first live event
  -- extracted for querying; everything else stays in data
  name              text,
  customer_po       text,
  job_order_number  text,
  order_number      text,                     -- THE JOIN. 8-digit. Resolved, may be null.
  status            text,
  loading_status    text,
  installer         text,
  stager            text,
  location          text,
  description       text,
  so_line_item      text,
  staged_out        text,
  changed_on        text,
  data              jsonb not null,           -- the whole row as Orca sent it
  deleted_at        timestamptz,              -- rows:delete soft-deletes; nothing is lost
  updated_at        timestamptz not null default now(),
  primary key (sheet_id, barcode)
);
create index on public.orca_rows (order_number) where deleted_at is null;
create index on public.orca_rows (job_order_number);

create table public.orca_job_links (          -- option C's table; also where A/B land their answer
  job_order_number  text primary key,
  order_number      text not null,
  source            text not null,            -- 'rforce' | 'warehouse' | 'manual'
  created_at        timestamptz default now()
);

create table public.orca_events (             -- raw audit of every webhook hit; invaluable, cheap
  id            bigserial primary key,
  sheet_id      text,
  event         text,
  barcode       text,
  received_at   timestamptz default now(),
  payload       jsonb
);
```

Keyed on `(sheet_id, barcode)`, not `orca_row_id`, for two reasons: the Excel
backfill has barcodes but no row ids, and WebHook In updates by barcode anyway.
Two consequences follow from that key, and both need handling:

- **Check the barcodes before running the migration.** The key assumes every
  row in both sheets has a barcode and no two share one. A blank or a duplicate
  in the 1,702-row export silently collapses rows during the backfill, and the
  count check at the end is the only thing that would notice. Count rows against
  distinct barcodes in the Excel first.
- **A barcode edited in Orca leaves a ghost.** The warehouse renames one,
  `rows:update` arrives under the new key, and you get a second mirror row with
  the old one still showing on the screen. When the payload carries
  `___orca_row_id` and a row with that id already exists under a different
  barcode, soft-delete the old key in the same statement.

**RLS.** `orca_rows`: SELECT for any allowlisted account that is not
installer-only; for installers, `order_number is not null and
public.order_is_mine(order_number)`. No client writes at all — the receiver
uses the service role. Same shape as 036. `orca_job_links`: read allowlisted,
write admin. `orca_events`: admin only.

**The resolver** (one SQL function, `orca_resolve_order_number(customer_po,
job_order_number, barcode, name)`): 8-digit `customer_po` wins; else
`orca_job_links`; else an 8-digit number parsed out of a cut-list-style barcode
(`RBA-04717321-WC-…`) or `Name`; else null. Called by the receiver and the
backfill. When option A lands, it just gets a better `orca_job_links`.

It needs a companion **re-resolve pass** — `orca_reresolve_order_numbers()`,
running the resolver again over every row whose `order_number` is still null.
Without it, rows mirrored before the join was solved keep their null forever and
filling `orca_job_links` later changes nothing on screen. Fire it from a trigger
on `orca_job_links` insert, and run it by hand after any bulk load.

## The receiver — `src/app/api/orca/events/route.ts`

- `POST` only. No user session — this is Orca calling us.
- Secret first: reject unless `orca-request-type === 'webhook-out'` and
  `orca-secret` equals `ORCA_WEBHOOK_SECRET` (constant-time compare). Anything
  else: 401, log nothing sensitive.
- **Then insert into `orca_events` — before the sheet-id check, not after.**
  The two sheet ids are learned *from* the first Test payload, so a receiver
  that rejects unknown ids up front rejects the one request that would have told
  you them. A valid secret with an unrecognised sheet id: audit the row, return
  200, touch nothing else. Once `ORCA_INVENTORY_SHEET_ID` and
  `ORCA_TRIM_SHEET_ID` are set, only those two reach `orca_rows`.
- `rows:add` / `rows:update` → upsert `orca_rows` on `(sheet_id, barcode)`,
  `deleted_at = null`. `rows:delete` → set `deleted_at`. `rows:import:*` →
  the body carries `rows: [...]`; upsert each. `test` and `columns:*` /
  `sheet:*` → audit only, 200.
- Service-role client (`getAdminClient()`), `runtime = "nodejs"`.
- Idempotent by construction — replaying any event yields the same state.
  Replay is not the only hazard, though: a retry can arrive *after* a newer
  change. Guard the upsert with `changed_on`, overwriting only when the incoming
  row is at least as new as the stored one, or a late retry quietly restores
  stale values.
- Return 200 within a second. Do nothing slow in the handler.

## Backfill — `scripts/orca-backfill.mjs`

WebHook Out only sends changes from the moment it is switched on; the 1,702
existing rows never arrive on their own. One-time: Kennen exports each sheet to
Excel, the script parses it (same column names; the cut-list app already parses
this format in `lib/shopInventory.js`) and upserts into `orca_rows` with the
service role. Read-only on Orca. Re-runnable. Print a count per sheet and
compare to the sheet's row count in Orca.

## The screen — `src/app/install/[id]/page.tsx`

A new **Staging** section above the Unit Summary, visible to anyone who can see
the page. For this job's PO it shows every `orca_rows` row (both sheets, not
deleted), grouped **Units & parts** (Inventory sheet) and **Trim** (Trim sheet):

| per row | from |
|---|---|
| checkbox (Phase 3; Phase 2 renders a read-only mark) | `loading_status` |
| description, SO line item | the row |
| location | `location` |
| staged by / scanned by | `stager`, `installer` |
| state pill: Not Staged / Staged / Loaded | `loading_status` |

Header chip: **"9 of 12 scanned out"**. Rows whose `loading_status` is not
`Staged` or `Loaded` are shown but never tickable — a `Not Staged` item is not
ready to leave, and that is the stager's call, not the installer's.

**Cross-reference panel**, from the install doc already loaded on this page:
units in the doc vs unit rows in Orca (match on count first; match on size or SO
line item later if the data supports it); vendors on the NWO material list vs
Trim-sheet rows (one per vendor). Anything on the doc with no Orca row is listed
as **"nothing in the warehouse for this"**. Anything in Orca with no doc
counterpart is listed too. This is the part that catches the window nobody
ordered, and it needs no writes at all.

If `order_number` could not be resolved for a job — the ZX case before the join
is fixed — say so plainly on the panel rather than showing an empty list.

## The write — `src/app/api/orca/scan/route.ts` (Phase 3)

`POST { sheetId, barcode, checked }`.

1. `requireAuth()`, then the role gate — **but not `canDoFieldWork(roles)`**.
   That one is admin + field-manager only (`src/lib/roles.ts`, whose own comment
   says installers are excluded), so it would 403 the exact people this feature
   is for. Add `canScanOut(roles)` alongside it, covering installer plus whoever
   open question 4 settles on.
2. Load the mirror row. **If it isn't in the mirror, refuse** — never send a
   barcode to Orca that didn't come from Orca (the create-on-update hazard).
3. Installer-only accounts: `order_is_mine(order_number)` must be true — **and
   it cannot be asked through `getAdminClient()`**. It and `my_crew_names()`
   read the signed-in email out of `auth.jwt()`; the service role carries no
   session, so they come back empty and every installer tick fails closed, which
   on screen looks like "this job isn't yours" rather than like a bug. Run the
   ownership check on the session-aware client from `requireAuth()`, or add an
   email-taking variant and call that with the service role.
4. State machine: `checked` requires `loading_status = 'Staged'`; `!checked`
   requires `'Loaded'`. Anything else → 409 with the current state, and the UI
   reloads the row.
5. Who: the installer's **own** resource name — and `my_crew_names()` will not
   give it. Postgres arrays start at 1, so `[0]` is empty; worse, the array
   mixes their crew name, its aliases, their lead's name and the lead's aliases
   into one set that `array_agg(DISTINCT)` sorts alphabetically. Picking an
   element gets you whichever name sorts first, which may be an alias or their
   lead. Add `my_own_crew_name()` in migration 039: the `sched_crews.name`
   joined straight off the login's `allowed_emails.sched_crew_id` — no lead, no
   aliases. For a member/admin, the login's display name. Must match the
   spelling already in the `Installer` column (see Watch out for).
6. WebHook In to the row's sheet:
   `{ ___orca_action: 'update', Barcode, 'Loading Status': 'Loaded' | 'Staged',
   Installer: name | '', 'Staged out': today | '' }` with `orca-secret`.
   **An untick must not blank a field we never filled.** `Staged out` is the
   stager's date on plenty of rows today; clearing it on untick destroys
   warehouse data. Clear only what the matching tick wrote — compare against the
   mirror row as it stood before the tick — or leave `Staged out` alone
   entirely until open question 3 is answered.
7. On Orca's 200: write the same values to the mirror and return the row. The
   WebHook Out echo will overwrite it moments later with the truth.
8. Audit who/when in `orca_events` (`event: 'scan'`) so there is a record on
   our side independent of Orca's.

UI: optimistic tick, debounced, one in flight per row, revert on error with the
message shown. 15 requests/second is far above a human with a phone.

## Environment (Vercel → Settings → Environment Variables)

```
ORCA_WEBHOOK_SECRET               one value; set the SAME Secret on both sheets in Orca
ORCA_INVENTORY_SHEET_ID           from the orca-sheet-id header of the Test payload
ORCA_TRIM_SHEET_ID                likewise
ORCA_INVENTORY_WEBHOOK_IN_URL     https://api.orcascan.com/sheets/XLrm9ppKJ225z0df
ORCA_TRIM_WEBHOOK_IN_URL          https://api.orcascan.com/sheets/LBewDR8Om02X3zPl
```

> **Setting a Secret on the Trim Inventory sheet breaks the cut-list app's
> sends** until `ORCA_WEBHOOK_SECRET` is also set in *that* app's Vercel
> project — its route already sends `orca-secret` when the variable exists.
> Do both in the same sitting.

## Build order

**Phase 0 — decide the join, configure Orca (no code).**
Pick A, B or C above. Add `Loaded` to the `Loading Status` option list.
Confirm whether `Installer` is a free-text or a select column; if select, every
crew name an installer login can carry must be an option, spelled as
`sched_crews.name` spells it. Set a Secret on both sheets (and in the cut-list
app, same sitting). Delete the stray test row `RBA-00000000-WC-1610261436`
("DEMO, ZZ") that is sitting in Inventory 2026.

Three checks belong here too — minutes each, and each can change what gets
built:

- **Does the echo exist?** Expected to, and being tested rather than designed
  around. This is the one write the rule at the top allows: the `ZZ DEMO` row,
  by hand, after Kennen says go. Write to it through WebHook In, then look for
  a NEW row in `orca_events` — not just a 200 on the request, which proves
  only that Orca accepted it. If no event arrives, the write still works but
  the silent-drop detection is gone and the scan route has to read the row
  back itself.
- **Are the barcodes clean?** In each sheet's Excel export, count rows against
  distinct barcodes and count the blanks. The mirror's primary key assumes one
  barcode per row, never empty.
- **What does a blank `Loading Status` mean?** 1,427 of 1,702 rows are blank
  against 237 `Staged`. Only `Staged` rows are tickable, so if blank means
  "nobody filled it in" rather than "not staged yet", most of a job's list lands
  untickable on day one and Phase 2 reads as broken rather than accurate.

**Phase 1 — the mirror. View-only.**
Migration 039. The receiver. Deploy. Point both sheets' WebHook Out at
`https://<calendar host>/api/orca/events`, press Test, confirm a `test` row in
`orca_events` and capture the two sheet ids. Backfill from Excel. Verify counts.
From here on, every change the warehouse makes in Orca lands in Supabase within
seconds — useful on its own, before any screen exists.

**Phase 2 — the screen. View-only.**
Staging section and cross-reference on the install page. Ship it. This is where
"view only for now" ends, and it already answers "is everything in and staged?"

**Phase 3 — the tick.**
Scan route, checkboxes, state machine. First real write goes to a `ZZ DEMO` row
Kennen makes by hand, with him watching the sheet. Confirm `Loading Status`
actually reads `Loaded` afterwards — a silent drop looks like success from our
side until the echo arrives.

**Phase 4 — edges.**
Supabase realtime on `orca_rows` so two phones on one job stay in step. A
"changed in the warehouse since you loaded this" banner when the echo disagrees
with the screen. Trim an `orca_events` TTL by hand. Admin page listing jobs
whose `order_number` could not be resolved.

## What is built — branch `orca-scan-out`

Phases 1, 2 and 3 are written. Nothing is switched on: no migration is applied,
no WebHook is pointed anywhere, and the write path is closed until an env var
names someone.

| file | what it is |
|---|---|
| `supabase/migrations/039_orca_mirror.sql` | the three tables, the resolver, `orca_apply_row()`, `my_own_crew_name()`, the re-resolve pass and its trigger, RLS |
| `src/app/api/orca/events/route.ts` | the WebHook Out receiver |
| `src/app/api/orca/scan/route.ts` | the tick (POST), and GET "may I tick, and which sheet is trim" |
| `src/lib/orca.ts` | sheet ids, the WebHook In URLs, the write allowlist, the constant-time secret compare |
| `src/lib/orca-staging.ts` | reading the mirror, the cross-reference |
| `src/components/StagingSection.tsx` | the Staging section; `StagingView` is the presentation on its own |
| `src/app/dev-staging/page.tsx` | dev-only harness — sample rows, no database, no Orca |
| `scripts/orca-backfill.mjs` | the one-time load, from a CSV export (not Excel: `csv-parse` is already a dependency) |
| `supabase/migrations/040_orca_link_corrections.sql` | makes a link correctable: 039's trigger only filled blanks, so a corrected link left the old order number on the rows and a deleted one could not be undone |
| `src/app/orca-links/page.tsx` | Warehouse Links — the admin screen that fills `orca_job_links`, reached from Settings |
| `src/lib/orca-links.ts` | grouping the unmatched rows, saving and removing links, the name-based suggestions |
| `src/components/OrcaLinksView.tsx` | its presentation, on its own |
| `src/app/dev-orca-links/page.tsx` | dev-only harness for that screen |

**Seeing it before any of that.** `npm run dev`, then `/dev-staging` for the
installer's screen and `/dev-orca-links` for the office's. Made-up rows,
every state, the cross-check failing on purpose. Nothing either one does can
reach a database, let alone Orca.

**Switching it on, in this order.**

1. Apply migrations 039 and 040 in the SQL editor. The install page stops saying "the
   warehouse list isn't available" and starts saying "nothing matched to this
   job yet", which is the honest answer until there are rows.
2. Set `ORCA_WEBHOOK_SECRET` in Vercel and the same Secret on both sheets in
   Orca — and in the cut-list app's Vercel project in the same sitting, or its
   trim sends start failing.
3. Point both sheets' WebHook Out at `/api/orca/events` and press Test. With
   no sheet ids configured yet the receiver answers `{"bootstrap": true}` and
   the payload lands in `orca_events`; read `orca-sheet-id` off it and set
   `ORCA_INVENTORY_SHEET_ID` and `ORCA_TRIM_SHEET_ID`.
4. Export each sheet to CSV and run the backfill. It reports blank and
   duplicate barcodes before writing anything, and says how many rows got an
   order number.
5. Leave `ORCA_SCAN_TEST_EMAILS` empty and the whole thing is view-only for
   everyone. Put one email in it and only that account gets checkboxes — which
   is how to try the first write without the field reaching live inventory.
6. Before that first tick: add `Loaded` to the `Loading Status` option list
   in Orca, or every tick will look like it worked and change nothing.

**Still open, and not guessed at in the code.** The join (A/B/C) — until it is
settled, only rows whose Customer PO already holds our order number, plus the
cut-list app's trim rows, resolve to a job. Option C now has a screen behind
it (Settings → Warehouse Links), so the office can close the gap by hand while
A is chased; A and B still beat it, because neither needs anyone to keep
typing. The echo. Whether `Installer` is a
select column, and what a member or admin ticking on someone's behalf should
be called in it: today they are stamped with their own account name, which
will be dropped if the column is a guarded select.

## Watch out for

- **Silent select failures** are the whole story of the first integration.
  When a column comes back empty or wrong, suspect its option list before the
  code. The echo through WebHook Out is the only way to *see* it.
- **`Installer` spelling.** Orca has `Josh Maas` and `Josh Mac` already. The
  calendar's `sched_crews.name` is the source of truth; if they disagree with
  Orca's existing list, fix Orca's list, don't invent a third spelling.
- **Create-on-update.** A WebHook In `update` for an unknown barcode makes a new
  row. The scan route must refuse any barcode not already in the mirror.
- **Retries are undocumented.** Assume Orca may send an event twice. The
  receiver is an upsert, so that is harmless — as long as it stays an upsert.
- **The ZX rows.** Until Phase 0's decision lands, ~1,300 rows have no job. The
  screen must say "can't match this job to the warehouse yet", never show an
  empty list that reads as "nothing staged".
- **Rate limits** are per sheet: 15/s. A backfill is read-only and doesn't
  count; a future bulk write would.
- **Two writers.** The warehouse edits rows in Orca; the installer edits the
  same rows from here. The state machine in step 4 plus the echo keeps it
  honest, but a row can legitimately change under the screen. Reload on 409.
- **Partial shipments.** A job can have rows in `Received`, `Backordered` and
  `Not Received` at once. The checklist shows all of them; only `Staged` ones
  are tickable; the cross-reference counts them all.
- **The service role has no identity.** `my_crew_names()`, `order_is_mine()`
  and `is_installer()` all key off `auth.jwt() ->> 'email'`. Through
  `getAdminClient()` they return empty and fail closed, which reads on screen as
  "not your job" instead of as a wiring mistake.
- **Out-of-order events.** An upsert survives the same event twice; it does not
  survive an old retry landing after a newer change. `changed_on` is the guard.
- **Nulls don't fix themselves.** A row mirrored before the join was solved
  keeps `order_number = null` until something re-resolves it.

## Not in scope, worth doing later

- The stager's half — marking rows `Staged` from a phone instead of the Orca
  app. Same plumbing, different role gate.
- Writing the install doc's unit list *into* Orca when a job is submitted, so
  the cross-reference becomes a match instead of a count. Depends on Phase 0:
  it needs the Job Order Number, or it needs to write the 8-digit PO into
  `Customer PO`, which is option B done by software instead of by hand.
- Decrementing the Trim sheet's bulk stock rows when a job draws from the shop.
  Two systems writing one count; not until the mirror has proven itself.

## Open questions for Kennen

1. **Join source — A, B, C or D?** Run `supabase/orca_join_probe.sql` first:
   D (harvest what the data already holds) and the `Name` test are both free,
   and between them they may leave little enough that A never needs chasing.
2. ~~`Loading Status` is the column, and what value?~~ **Settled 2026-10-19:**
   the column is `Loading Status` and the value is **`Loaded`**, which Kennen
   believes is already on the option list — he is confirming. Not `Status`,
   which is supply-chain state.
3. Should a tick also stamp `Staged out` with today's date, and an untick
   clear it?
4. Who can tick — installers only, or members and admins too? Either way
   `canDoFieldWork()` is the wrong gate, since it excludes installers; this
   answer decides what the new `canScanOut()` contains.
5. Is `Installer` a free-text or a select column in Orca?
6. On an untick, should `Staged out` be cleared at all, given the stager may be
   the one who set it? (Follows from 3.)
