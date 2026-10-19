import { getSupabase } from "./supabase";
import type { MaterialUnit } from "./types";
import type { InstallDocRow } from "./install-doc";

// ─── The staging list, and the cross-reference ──────────────────────────────
// What the warehouse has for this job (public.orca_rows, the Orca mirror) set
// against what the job actually needs (the install document already on the
// page).
//
// The unit list on the install document is NOT a second checklist. It is the
// cross-reference: Orca has rows for 11 units, the job has 12, so here is the
// one with nothing in the warehouse. That is the check that catches a window
// nobody ordered, and it needs no writes at all.
//
// Reads go through RLS (migration 039): an allowlisted account sees every row,
// an installer sees only rows for one of their own orders.

export const LOADING_NOT_STAGED = "Not Staged";
export const LOADING_STAGED = "Staged";
export const LOADING_LOADED = "Loaded";

export interface StagingRow {
  sheetId: string;
  barcode: string;
  name: string | null;
  description: string | null;
  soLineItem: string | null;
  location: string | null;
  status: string | null;
  loadingStatus: string | null;
  installer: string | null;
  stager: string | null;
  stagedOut: string | null;
}

export interface StagingData {
  /** Rows from the Inventory sheet — factory units, doors, hardware, parts. */
  units: StagingRow[];
  /** Rows from the Trim sheet — the bundles the cut-list app wrote. */
  trim: StagingRow[];
  loadedCount: number;
  totalCount: number;
}

/** A row is tickable only once the stager has said it is ready to leave. */
export function isTickable(row: StagingRow): boolean {
  return row.loadingStatus === LOADING_STAGED || row.loadingStatus === LOADING_LOADED;
}

export function isLoaded(row: StagingRow): boolean {
  return row.loadingStatus === LOADING_LOADED;
}

/**
 * The state to show per row. A blank `Loading Status` is the commonest value
 * in the sheet today and is NOT the same as `Not Staged` — it means nobody has
 * said either way, so it reads as "not staged yet" and is never tickable.
 */
export function stateLabel(row: StagingRow): string {
  if (row.loadingStatus === LOADING_LOADED) return "Loaded";
  if (row.loadingStatus === LOADING_STAGED) return "Staged";
  if (row.loadingStatus === LOADING_NOT_STAGED) return "Not staged";
  return "Not staged yet";
}

interface MirrorRow {
  sheet_id: string;
  barcode: string;
  name: string | null;
  description: string | null;
  so_line_item: string | null;
  location: string | null;
  status: string | null;
  loading_status: string | null;
  installer: string | null;
  stager: string | null;
  staged_out: string | null;
}

function toStagingRow(r: MirrorRow): StagingRow {
  return {
    sheetId: r.sheet_id,
    barcode: r.barcode,
    name: r.name,
    description: r.description,
    soLineItem: r.so_line_item,
    location: r.location,
    status: r.status,
    loadingStatus: r.loading_status,
    installer: r.installer,
    stager: r.stager,
    stagedOut: r.staged_out,
  };
}

/**
 * Every mirrored row for this order number, split by which sheet it came from.
 *
 * `trimSheetId` tells the two apart. It is public (a sheet id is not a secret
 * — the WebHook In URL token is the thing that is), and without it the whole
 * list simply shows as units, which is wrong but not harmful.
 */
export type StagingResult =
  | { kind: "ok"; data: StagingData }
  /** The mirror could not be read at all — most likely migration 039 isn't
   *  applied yet. Worth saying plainly: "nothing found" would read as though
   *  the warehouse is empty. */
  | { kind: "unavailable"; detail: string };

export async function fetchStagingForOrder(
  orderNumber: string,
  trimSheetId: string | null
): Promise<StagingResult> {
  const supabase = getSupabase();
  if (!supabase) return { kind: "unavailable", detail: "Not signed in." };
  if (!orderNumber) {
    return { kind: "ok", data: { units: [], trim: [], loadedCount: 0, totalCount: 0 } };
  }

  const { data, error } = await supabase
    .from("orca_rows")
    .select("sheet_id, barcode, name, description, so_line_item, location, status, loading_status, installer, stager, staged_out")
    .eq("order_number", orderNumber)
    .is("deleted_at", null)
    .order("so_line_item", { ascending: true });

  if (error) return { kind: "unavailable", detail: error.message };

  const rows = (data || []).map(toStagingRow);
  const trim = trimSheetId ? rows.filter((r) => r.sheetId === trimSheetId) : [];
  const units = trimSheetId ? rows.filter((r) => r.sheetId !== trimSheetId) : rows;

  return {
    kind: "ok",
    data: {
      units,
      trim,
      loadedCount: rows.filter(isLoaded).length,
      totalCount: rows.length,
    },
  };
}

// ─── Cross-reference ────────────────────────────────────────────────────────

export interface CrossReference {
  /** How many units the install document lists. */
  docUnitCount: number;
  /** How many unit rows Orca has for this job. */
  orcaUnitCount: number;
  /** Vendors on the NWO material list with no Trim-sheet row. */
  vendorsMissingTrim: string[];
  /** Trim-sheet rows whose vendor isn't on the material list. */
  trimWithoutVendor: string[];
  /** True when the counts agree and every vendor has a bundle. */
  agrees: boolean;
}

/**
 * Units are matched on COUNT, not identity. Orca's rows carry an SO line item
 * and a factory description; the install document carries our own unit labels
 * and sizes. Nothing reliably ties one to the other today, so claiming a
 * per-unit match would be a guess dressed up as a fact. A count mismatch is
 * still the useful signal: it says go and look.
 *
 * Vendors DO match, because the cut-list app writes one Trim row per job per
 * vendor and puts the vendor's abbreviation in the barcode.
 */
export function buildCrossReference(
  units: MaterialUnit[],
  nwoRows: InstallDocRow[],
  staging: StagingData
): CrossReference {
  const realUnits = units.filter((u) => !u.isMisc);
  const docUnitCount = realUnits.reduce((s, u) => s + (u.qty || 1), 0);
  const orcaUnitCount = staging.units.length;

  const docVendors = new Set(
    nwoRows.map((r) => (r.vendor || "").trim()).filter(Boolean)
  );

  // A Trim row's vendor shows up in its barcode as RBA-<PO>-<ABBR>-<stamp>,
  // and in the Name. Match loosely on either, case-insensitively — the
  // abbreviation in the barcode is not always the vendor's full name.
  const trimHaystack = staging.trim.map((r) =>
    `${r.barcode} ${r.name ?? ""} ${r.description ?? ""}`.toLowerCase()
  );

  const vendorsMissingTrim = [...docVendors].filter((v) => {
    const needle = v.toLowerCase();
    const abbr = needle.replace(/[^a-z]/g, "").slice(0, 2);
    return !trimHaystack.some((h) => h.includes(needle) || (abbr && h.includes(`-${abbr}`)));
  });

  const trimWithoutVendor = staging.trim
    .filter((r) => {
      const h = `${r.barcode} ${r.name ?? ""} ${r.description ?? ""}`.toLowerCase();
      return ![...docVendors].some((v) => {
        const needle = v.toLowerCase();
        const abbr = needle.replace(/[^a-z]/g, "").slice(0, 2);
        return h.includes(needle) || (abbr && h.includes(`-${abbr}`));
      });
    })
    .map((r) => r.description || r.name || r.barcode);

  return {
    docUnitCount,
    orcaUnitCount,
    vendorsMissingTrim,
    trimWithoutVendor,
    agrees:
      docUnitCount === orcaUnitCount &&
      vendorsMissingTrim.length === 0 &&
      trimWithoutVendor.length === 0,
  };
}

/**
 * Apply a tick locally, so the checkbox responds before the round trip
 * finishes — a phone in a warehouse is not on good wifi. This is a guess at
 * what Orca will store, and it is replaced by a reload immediately after. It
 * deliberately does NOT touch `installer`: who the row ends up under is the
 * server's answer, not ours.
 */
export function applyLocal(
  data: StagingData,
  row: StagingRow,
  next: boolean
): StagingData {
  const patch = (r: StagingRow): StagingRow =>
    r.sheetId === row.sheetId && r.barcode === row.barcode
      ? { ...r, loadingStatus: next ? LOADING_LOADED : LOADING_STAGED }
      : r;

  const units = data.units.map(patch);
  const trim = data.trim.map(patch);
  return {
    units,
    trim,
    loadedCount: [...units, ...trim].filter(isLoaded).length,
    totalCount: data.totalCount,
  };
}
