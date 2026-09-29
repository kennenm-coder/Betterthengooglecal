/**
 * Shared import log backed by Supabase `import_logs` table.
 * Entries auto-expire after 7 days — old rows are deleted on read.
 *
 * Only WORK ORDER imports are logged. Account uploads are deliberately not
 * recorded: they just backfill customer names onto jobs that already exist, so
 * they are not a change a field manager needs to see on the Changes tab.
 */

import { createClient } from "@supabase/supabase-js";

export const TTL_DAYS = 7;

/** Bucket a changed field falls into — drives the Changes tab filter chips. */
export type ChangeKind = "schedule" | "crew" | "status" | "address";

/** One field that changed on an updated order, with its before/after values. */
export interface ImportLogFieldChange {
  /** Human-readable field name, e.g. "Scheduled Start". */
  field: string;
  /** Previous value (display string; "—" when it was empty). */
  from: string;
  /** New value (display string; "—" when empty). */
  to: string;
  /** Filter bucket. Absent on rows written before change kinds existed. */
  kind?: ChangeKind;
  /** True when the values are ISO timestamps the UI should format as dates. */
  isDate?: boolean;
}

export interface ImportLogOrder {
  workOrderNumber: string;
  customerName: string;
  scheduledStart: string | null;
  action: "added" | "updated";
  /** Field-level before/after diffs — only present on "updated" orders. */
  changes?: ImportLogFieldChange[];
}

export interface ImportLogEntry {
  id: string;
  created_at: string;
  format: string;
  source: string;
  /** Orders that actually changed — NOT the row count of the uploaded file.
   *  Larger than `orders.length` when the import exceeded the stored cap. */
  total_count: number;
  added_count: number;
  updated_count: number;
  orders: ImportLogOrder[];
}

/** Server-side only: get a service-role client */
function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/** How many order rows we keep per log entry. */
const MAX_STORED_ORDERS = 50;

/**
 * Trim stored orders to the cap, splitting the slots evenly between new jobs
 * and changed jobs. A flat "first 50" would let one big batch of new jobs bury
 * every schedule change — the thing the tab exists to show. Either side gives
 * up slots it doesn't need.
 */
function capOrders(orders: ImportLogOrder[]): ImportLogOrder[] {
  if (orders.length <= MAX_STORED_ORDERS) return orders;
  const added = orders.filter((o) => o.action === "added");
  const updated = orders.filter((o) => o.action === "updated");
  const half = Math.floor(MAX_STORED_ORDERS / 2);
  const addedTake = Math.min(
    added.length,
    Math.max(half, MAX_STORED_ORDERS - updated.length)
  );
  const updatedTake = Math.min(updated.length, MAX_STORED_ORDERS - addedTake);
  return [...added.slice(0, addedTake), ...updated.slice(0, updatedTake)];
}

/**
 * Server-side: write an import log entry.
 * Called from the upload API route after each successful import.
 *
 * Imports where nothing changed are not recorded at all — the scheduled
 * Power Automate uploads run all day and would otherwise leave a trail of
 * empty cards to scroll past.
 */
export async function writeImportLog(entry: {
  format: string;
  source: string;
  total_count: number;
  added_count: number;
  updated_count: number;
  orders: ImportLogOrder[];
}): Promise<void> {
  if (entry.added_count === 0 && entry.updated_count === 0) return;

  const supabase = getServiceClient();

  await supabase.from("import_logs").insert({
    format: entry.format,
    source: entry.source,
    total_count: entry.total_count,
    added_count: entry.added_count,
    updated_count: entry.updated_count,
    orders: capOrders(entry.orders),
  });

  // Clean up expired entries
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - TTL_DAYS);
  await supabase
    .from("import_logs")
    .delete()
    .lt("created_at", cutoff.toISOString());
}

/**
 * Fields we surface before/after values for on the Changes tab, in display
 * order. `key` is the WorkOrder (camelCase) property; `col` is the Supabase
 * (snake_case) column on the existing row.
 */
const TRACKED_FIELDS: {
  key: keyof import("./types").WorkOrder;
  col: string;
  label: string;
  kind: ChangeKind;
  isDate?: boolean;
}[] = [
  { key: "scheduledStart", col: "scheduled_start", label: "Scheduled Start", kind: "schedule", isDate: true },
  { key: "scheduledEnd", col: "scheduled_end", label: "Scheduled End", kind: "schedule", isDate: true },
  { key: "status", col: "status", label: "Status", kind: "status" },
  { key: "appointmentStatus", col: "appointment_status", label: "Appt Status", kind: "status" },
  { key: "installer", col: "installer", label: "Installer", kind: "crew" },
  { key: "primaryResource", col: "primary_resource", label: "Resource", kind: "crew" },
  { key: "serviceRep", col: "service_rep", label: "Service Rep", kind: "crew" },
  { key: "techMeasure", col: "tech_measure", label: "Tech Measure", kind: "crew" },
  { key: "address", col: "address", label: "Address", kind: "address" },
];

/** Normalize a raw field value to a comparable/display string. */
function norm(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/**
 * Compare an existing Supabase row against an incoming WorkOrder and return the
 * list of tracked fields that changed, with before/after values.
 */
export function computeOrderChanges(
  existingRow: Record<string, unknown>,
  incoming: import("./types").WorkOrder
): ImportLogFieldChange[] {
  const changes: ImportLogFieldChange[] = [];
  for (const f of TRACKED_FIELDS) {
    const before = norm(existingRow[f.col]);
    const after = norm(incoming[f.key]);
    if (before !== after) {
      changes.push({
        field: f.label,
        from: before || "—",
        to: after || "—",
        kind: f.kind,
        ...(f.isDate ? { isDate: true } : {}),
      });
    }
  }
  return changes;
}

/**
 * Server-side: fetch existing work_order rows (tracked columns only) for the
 * given IDs, keyed by id. Used before upsert to compute new-vs-updated and the
 * per-field before/after diffs.
 */
export async function fetchExistingOrders(
  ids: string[]
): Promise<Map<string, Record<string, unknown>>> {
  const supabase = getServiceClient();
  const existing = new Map<string, Record<string, unknown>>();
  const columns = ["id", ...TRACKED_FIELDS.map((f) => f.col)].join(", ");

  // Query in batches of 500
  const BATCH = 500;
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const { data } = await supabase
      .from("work_orders")
      .select(columns)
      .in("id", chunk);
    if (data) {
      for (const row of data as unknown as Record<string, unknown>[]) {
        existing.set(String(row.id), row);
      }
    }
  }

  return existing;
}
