/**
 * Orca Scan — the shared bits.
 *
 * Orca is the warehouse's barcode system. Two sheets matter here:
 *
 *   Inventory 2026   factory units, doors, hardware, parts — one row per
 *                    SO line item, scanned in at receiving
 *   Trim Inventory   the trim bundles the cut-list app writes, one row per
 *                    job per vendor
 *
 * Orca pushes every change to us (WebHook Out → /api/orca/events) and takes
 * changes back (WebHook In → POST to the sheet URL). See
 * INSTALLER_SCAN_OUT_PLAN.md for the whole picture, including the two hazards
 * that shape this file: a WebHook In `update` CREATES the row when the barcode
 * is unknown, and a value that isn't on a select column's option list is
 * dropped with a cheerful HTTP 200.
 */

/** A row as the install page needs it. Mirrors public.orca_rows. */
export interface OrcaRow {
  sheet_id: string;
  barcode: string;
  name: string | null;
  customer_po: string | null;
  job_order_number: string | null;
  order_number: string | null;
  status: string | null;
  loading_status: string | null;
  installer: string | null;
  stager: string | null;
  location: string | null;
  description: string | null;
  so_line_item: string | null;
  staged_out: string | null;
  updated_at: string;
}

/** The three states the loading workflow actually uses. */
export const LOADING_NOT_STAGED = "Not Staged";
export const LOADING_STAGED = "Staged";
export const LOADING_LOADED = "Loaded";

/**
 * `Loaded` has to exist on the `Loading Status` option list in Orca before
 * any of this works. It is a guarded select column: a value that isn't an
 * option is dropped silently, HTTP 200 and all, leaving the cell blank. The
 * WebHook Out echo is the only way to see that happen.
 */
export type LoadingState =
  | typeof LOADING_NOT_STAGED
  | typeof LOADING_STAGED
  | typeof LOADING_LOADED;

/** Which of the two sheets a row came from. */
export type OrcaSheet = "inventory" | "trim";

export function sheetKindFor(sheetId: string): OrcaSheet | null {
  if (sheetId && sheetId === process.env.ORCA_INVENTORY_SHEET_ID) return "inventory";
  if (sheetId && sheetId === process.env.ORCA_TRIM_SHEET_ID) return "trim";
  return null;
}

export function webhookInUrlFor(sheetId: string): string | null {
  const kind = sheetKindFor(sheetId);
  if (kind === "inventory") return process.env.ORCA_INVENTORY_WEBHOOK_IN_URL || null;
  if (kind === "trim") return process.env.ORCA_TRIM_WEBHOOK_IN_URL || null;
  return null;
}

/**
 * Is this login allowed to write to Orca?
 *
 * ORCA_SCAN_TEST_EMAILS is a comma-separated allowlist, and the write path is
 * CLOSED when it is empty. Live inventory is the real warehouse: while this
 * feature is being tried out, exactly the people named here can touch it, and
 * everyone else gets the same screen read-only. Clearing the variable turns
 * every write off again without a deploy.
 */
export function canWriteToOrca(email: string | null | undefined): boolean {
  const allow = (process.env.ORCA_SCAN_TEST_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length === 0) return false;
  return !!email && allow.includes(email.toLowerCase());
}

/** Both sheet ids, when configured. Used to decide what reaches the mirror. */
export function knownSheetIds(): string[] {
  return [process.env.ORCA_INVENTORY_SHEET_ID, process.env.ORCA_TRIM_SHEET_ID]
    .filter((v): v is string => !!v && v.trim() !== "");
}

/** Constant-time string compare, so a bad secret leaks nothing by timing. */
export function secretMatches(given: string | null, expected: string | undefined): boolean {
  if (!expected) return false;
  if (!given) return false;
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** Orca's date format for a plain date cell. */
export function orcaToday(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
