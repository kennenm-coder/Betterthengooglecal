// "How would you match Orca's rows to our jobs?" — answered from the export,
// with no database changes at all.
//
// WHY THIS EXISTS SEPARATELY FROM supabase/orca_join_probe.sql
//
// Orca Scan is its own system. There is no database of ours to query it with.
// The SQL version of this probe reads `orca_rows`, which is a COPY of Orca's
// data inside Supabase — and that copy does not exist until migration 039 is
// applied and the backfill has run. So the SQL version can only answer this
// question later.
//
// This version answers it today. It reads the Orca export straight off disk,
// and only touches Supabase to look up our own `work_orders`, which already
// exists.
//
// THE QUESTION
//
// Orca labels rows with the factory's 7-digit Job Order Number. We label
// everything with an 8-digit order number. Hardly any row carries both, so
// most of the warehouse cannot be tied to a job. Where does the join come
// from, and what is each option actually worth?
//
// HOW TO USE
//
//   1. In Orca, open Inventory 2026 -> Export -> CSV.
//   2. node scripts/orca-join-probe.mjs "C:/path/to/export.csv"
//
// Add --no-db to skip the work_orders lookup and run fully offline (you lose
// the confirmation half of question 3).
//
// Read-only on everything. It writes nothing, anywhere.
//
// Env (only for the work_orders lookup, read from .env.local):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  try {
    const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const m = raw.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      if (process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // Not there — the variables may already be in the shell.
  }
}
loadEnvLocal();

const args = process.argv.slice(2);
const noDb = args.includes("--no-db");
const csvPath = args.find((a) => !a.startsWith("--"));

if (!csvPath) {
  console.error('Usage: node scripts/orca-join-probe.mjs "<export.csv>" [--no-db]');
  process.exit(1);
}

const rows = parse(readFileSync(csvPath, "utf8"), {
  columns: true,
  skip_empty_lines: true,
  bom: true,
  relax_column_count: true,
});

const get = (r, col) => String(r[col] ?? "").trim();
const EIGHT = /^[0-9]{8}$/;
// An 8-digit run that is not part of a longer number. `-,04794151/097` gives
// 04794151; the barcode `98124444.003` correctly gives nothing.
const EMBEDDED_EIGHT = /(?<![0-9])([0-9]{8})(?![0-9])/;

const line = (s = "") => console.log(s);
const pct = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : "-");

line();
line("=".repeat(68));
line(`  Orca join probe - ${rows.length} rows from ${csvPath}`);
line("=".repeat(68));

// ── 1. What is in the sheet ─────────────────────────────────
const ourPo = rows.filter((r) => EIGHT.test(get(r, "Customer PO")));
const factoryPo = rows.filter((r) => /^ZX/i.test(get(r, "Customer PO")));
const hasJobNo = rows.filter((r) => get(r, "Job Order Number") !== "");

line();
line("1. WHAT IS IN THE SHEET");
line(`   Rows                                 ${rows.length}`);
line(`   Customer PO is OUR order number      ${ourPo.length}  (${pct(ourPo.length, rows.length)})`);
line(`   Customer PO is a factory ZX number   ${factoryPo.length}  (${pct(factoryPo.length, rows.length)})`);
line(`   Has a factory Job Order Number       ${hasJobNo.length}  (${pct(hasJobNo.length, rows.length)})`);

// ── 2. The free links already in the data ───────────────────
// A row carrying BOTH our order number and the factory job number is a
// confirmed link. A link places every row sharing that job number, so a
// handful of these can place hundreds.
const pairs = new Map(); // job number -> set of our order numbers
for (const r of rows) {
  const po = get(r, "Customer PO");
  const job = get(r, "Job Order Number");
  if (!EIGHT.test(po) || !job) continue;
  if (!pairs.has(job)) pairs.set(job, new Set());
  pairs.get(job).add(po);
}

const clean = new Map();
const ambiguous = [];
for (const [job, set] of pairs) {
  if (set.size === 1) clean.set(job, [...set][0]);
  else ambiguous.push([job, [...set]]);
}

// How many currently-unplaceable rows would those links place?
let placedByHarvest = 0;
for (const r of rows) {
  const po = get(r, "Customer PO");
  const job = get(r, "Job Order Number");
  if (EIGHT.test(po)) continue; // already placeable on its own
  if (job && clean.has(job)) placedByHarvest++;
}

line();
line("2. LINKS ALREADY SITTING IN THE DATA");
const bothCount = ourPo.filter((r) => get(r, "Job Order Number") !== "").length;
line(`   Rows carrying BOTH numbers           ${bothCount}`);
line(`   Factory jobs they identify           ${clean.size}`);
line(`   Extra rows those links would place   ${placedByHarvest}`);
if (ambiguous.length) {
  line(`   Contradictory (skipped, not guessed) ${ambiguous.length}`);
  for (const [job, list] of ambiguous.slice(0, 5)) {
    line(`      job ${job} -> ${list.join(", ")}`);
  }
  if (ambiguous.length > 5) line(`      ... and ${ambiguous.length - 5} more`);
}

// ── 3. Is our order number hiding in the Name column? ───────
// The factory rows' Name looks like `-,04794151/097`. If that 8-digit number
// is our order number, ~1,300 rows resolve themselves with no process change.
const unplaceable = rows.filter((r) => {
  const po = get(r, "Customer PO");
  const job = get(r, "Job Order Number");
  return !EIGHT.test(po) && !(job && clean.has(job));
});

const guesses = new Map(); // guessed order number -> count of rows
const guessSamples = [];
for (const r of unplaceable) {
  const m = get(r, "Name").match(EMBEDDED_EIGHT);
  if (!m) continue;
  guesses.set(m[1], (guesses.get(m[1]) || 0) + 1);
  if (guessSamples.length < 10) {
    guessSamples.push({ name: get(r, "Name"), guess: m[1], barcode: get(r, "Barcode") });
  }
}

const rowsWithGuess = [...guesses.values()].reduce((a, b) => a + b, 0);

line();
line("3. IS OUR ORDER NUMBER IN THE Name COLUMN?");
line(`   Rows still unplaceable               ${unplaceable.length}`);
line(`   ... whose Name holds an 8-digit no.  ${rowsWithGuess}  (${pct(rowsWithGuess, unplaceable.length)})`);
line(`   Distinct numbers guessed             ${guesses.size}`);

let confirmed = null;
if (!noDb && guesses.size > 0) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    line("   (no Supabase credentials — rerun with --no-db, or set .env.local)");
  } else {
    const supabase = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const all = [...guesses.keys()];
    const real = new Set();
    // Chunked so a long IN list doesn't blow the URL length limit.
    for (let i = 0; i < all.length; i += 200) {
      const chunk = all.slice(i, i + 200);
      const { data, error } = await supabase
        .from("work_orders")
        .select("order_number")
        .in("order_number", chunk);
      if (error) {
        line(`   (work_orders lookup failed: ${error.message})`);
        break;
      }
      for (const row of data || []) real.add(row.order_number);
    }
    let rowsConfirmed = 0;
    for (const [guess, count] of guesses) if (real.has(guess)) rowsConfirmed += count;
    confirmed = { distinct: real.size, rows: rowsConfirmed };

    line(`   ... that are REAL orders of ours     ${real.size} of ${guesses.size}`);
    line(`   Rows that would place                ${rowsConfirmed}`);
  }
}

line();
line("   Sample of what the Name column holds:");
for (const s of guessSamples.slice(0, 6)) {
  line(`      ${s.name.padEnd(28).slice(0, 28)}  ->  ${s.guess}`);
}
if (guessSamples.length === 0) line("      (no 8-digit numbers found in Name)");

// ── 4. Does the barcode carry the job number? ───────────────
// Factory barcodes look like `98124444.003`, which is the job number with a 9
// in front. If that holds, a row missing its Job Order Number can still be
// grouped with its siblings.
let barcodeMatches = 0;
let barcodeDiffers = 0;
for (const r of rows) {
  const job = get(r, "Job Order Number");
  if (!job) continue;
  if (get(r, "Barcode").startsWith("9" + job)) barcodeMatches++;
  else barcodeDiffers++;
}

line();
line("4. DOES THE BARCODE CONTAIN THE JOB NUMBER?");
line(`   Barcode starts with 9 + job number   ${barcodeMatches}`);
line(`   Does not                             ${barcodeDiffers}`);

// ── 5. What is each strategy worth? ─────────────────────────
line();
line("5. WHAT EACH STRATEGY IS WORTH, ON THIS EXPORT");
line(`   Already placeable (our PO on the row) ${ourPo.length}`);
line(`   + harvest the links in the data       ${placedByHarvest}   (free, no process change)`);
if (confirmed) {
  line(`   + the Name column, confirmed real     ${confirmed.rows}   (free, no process change)`);
}
const totalFree = ourPo.length + placedByHarvest + (confirmed ? confirmed.rows : 0);
line(`   ${"-".repeat(38)}`);
line(`   Placeable without asking anyone       ${totalFree}  (${pct(totalFree, rows.length)})`);
line(`   Still needing rForce/retyping/by hand ${rows.length - totalFree}  (${pct(rows.length - totalFree, rows.length)})`);
line();
line("   The last line is the one that decides whether option A is worth");
line("   chasing. If it is small, the Warehouse Links screen can mop it up.");
line();
