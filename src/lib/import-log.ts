/**
 * Shared import log backed by Supabase `import_logs` table.
 * Entries auto-expire after 3 days — old rows are deleted on read.
 */

import { createClient } from "@supabase/supabase-js";

const TTL_DAYS = 3;

/** One field that changed on an updated order, with its before/after values. */
export interface ImportLogFieldChange {
  /** Human-readable field name, e.g. "Scheduled Start". */
  field: string;
  /** Previous value (display string; "—" when it was empty). */
  from: string;
  /** New value (display string; "—" when empty). */
  to: string;
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

/**
 * Server-side: write an import log entry.
 * Called from the upload API route after each successful import.
 */
export async function writeImportLog(entry: {
  format: string;
  source: string;
  total_count: number;
  added_count: number;
  updated_count: number;
  orders: ImportLogOrder[];
}): Promise<void> {
  const supabase = getServiceClient();

  // Insert the log entry (cap stored orders at 50)
  await supabase.from("import_logs").insert({
    format: entry.format,
    source: entry.source,
    total_count: entry.total_count,
    added_count: entry.added_count,
    updated_count: entry.updated_count,
    orders: entry.orders.slice(0, 50),
  });

  // Clean up entries older than 3 days
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
  isDate?: boolean;
}[] = [
  { key: "scheduledStart", col: "scheduled_start", label: "Scheduled Start", isDate: true },
  { key: "scheduledEnd", col: "scheduled_end", label: "Scheduled End", isDate: true },
  { key: "status", col: "status", label: "Status" },
  { key: "appointmentStatus", col: "appointment_status", label: "Appt Status" },
  { key: "installer", col: "installer", label: "Installer" },
  { key: "primaryResource", col: "primary_resource", label: "Resource" },
  { key: "serviceRep", col: "service_rep", label: "Service Rep" },
  { key: "techMeasure", col: "tech_measure", label: "Tech Measure" },
  { key: "address", col: "address", label: "Address" },
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
