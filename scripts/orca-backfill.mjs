// One-time backfill of the Orca mirror.
//
// WebHook Out only sends CHANGES, from the moment it is switched on. The rows
// already sitting in Orca — about 1,700 of them — never arrive on their own.
// This loads them once from an export, and from then on the webhook keeps the
// mirror current.
//
// Read-only on Orca: it touches a file you exported, never the sheet.
// Re-runnable: every row goes through the same orca_apply_row() the webhook
// uses, which is an upsert.
//
// HOW TO USE
//
//   1. In Orca, open the sheet → Export → CSV. (CSV, not Excel — the column
//      names are identical and this needs no extra library.)
//   2. Find the sheet's internal id. Easiest: press Test on the sheet's
//      WebHook Out, then read orca-sheet-id off the newest row in
//      public.orca_events. It is NOT the token in the WebHook In URL.
//   3. Run, once per sheet:
//
//      node scripts/orca-backfill.mjs <sheet-id> "C:/path/to/export.csv"
//
//      Add --dry-run to parse and report without writing anything.
//
//   4. Compare the count it prints to the sheet's row count in Orca.
//
// Env (from .env.local, or already in the shell):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";

// ── Env, from .env.local if it is there ──────────────────────
function loadEnvLocal() {
  try {
    const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, k, raw] = m;
      if (process.env[k]) continue;
      process.env[k] = raw.replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env.local — the variables may already be in the shell.
  }
}
loadEnvLocal();

const [sheetId, csvPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dryRun = process.argv.includes("--dry-run");

if (!sheetId || !csvPath) {
  console.error(
    "Usage: node scripts/orca-backfill.mjs <sheet-id> <export.csv> [--dry-run]"
  );
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set " +
      "(put them in .env.local)."
  );
  process.exit(1);
}

// ── Parse ───────────────────────────────────────────────────
const rows = parse(readFileSync(csvPath, "utf8"), {
  columns: true,
  skip_empty_lines: true,
  bom: true,
  relax_column_count: true,
});

console.log(`Parsed ${rows.length} rows from ${csvPath}`);

// The mirror is keyed on (sheet_id, barcode), so a blank or duplicated barcode
// is the one thing that can quietly lose rows. Say so before writing, not
// after — this is the check Phase 0 of the plan asks for.
const barcodes = rows.map((r) => String(r.Barcode ?? "").trim());
const blank = barcodes.filter((b) => b === "").length;
const seen = new Set();
const dupes = new Set();
for (const b of barcodes) {
  if (b === "") continue;
  if (seen.has(b)) dupes.add(b);
  seen.add(b);
}

console.log(`  ${seen.size} distinct barcodes`);
if (blank > 0) {
  console.log(`  ${blank} row(s) with NO barcode — these cannot be mirrored`);
}
if (dupes.size > 0) {
  console.log(
    `  ${dupes.size} duplicated barcode(s) — later rows overwrite earlier ones:`
  );
  for (const b of [...dupes].slice(0, 10)) console.log(`      ${b}`);
  if (dupes.size > 10) console.log(`      … and ${dupes.size - 10} more`);
}

if (dryRun) {
  console.log("\n--dry-run: nothing written.");
  process.exit(0);
}

// ── Load ────────────────────────────────────────────────────
const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let written = 0;
let skipped = 0;
let failed = 0;

for (const row of rows) {
  const barcode = String(row.Barcode ?? "").trim();
  if (!barcode) {
    skipped++;
    continue;
  }

  // Same function the webhook uses, so the extraction, the order-number
  // resolve and the guards are identical either way in.
  const { data, error } = await supabase.rpc("orca_apply_row", {
    p_sheet_id: sheetId,
    p_barcode: barcode,
    p_row_id: null, // an export has no row ids; the first live event fills them
    p_data: row,
  });

  if (error) {
    failed++;
    if (failed <= 5) console.error(`  ${barcode}: ${error.message}`);
  } else if (data === true) {
    written++;
  } else {
    skipped++;
  }

  if ((written + skipped + failed) % 250 === 0) {
    console.log(`  … ${written + skipped + failed} of ${rows.length}`);
  }
}

console.log(`\nWrote ${written}, skipped ${skipped}, failed ${failed}.`);

// How many of them can actually be tied to a job — the number that decides
// whether the install page has anything to show.
const { count: resolved } = await supabase
  .from("orca_rows")
  .select("*", { count: "exact", head: true })
  .eq("sheet_id", sheetId)
  .not("order_number", "is", null)
  .is("deleted_at", null);

const { count: total } = await supabase
  .from("orca_rows")
  .select("*", { count: "exact", head: true })
  .eq("sheet_id", sheetId)
  .is("deleted_at", null);

console.log(
  `Mirror now holds ${total ?? "?"} rows for this sheet; ${resolved ?? "?"} are ` +
    `tied to an order number.`
);
if ((total ?? 0) > 0 && (resolved ?? 0) < (total ?? 0)) {
  console.log(
    "The rest need the join settled (plan, Phase 0) — fill orca_job_links and\n" +
      "the trigger there will reach these rows, or run\n" +
      "  select public.orca_reresolve_order_numbers();"
  );
}
