import { getSupabase } from "./supabase";
import {
  MEASURE_MAX_ROWS,
  MEASURE_WORK_ORDER_TYPE,
  filterAssignedTo,
  foldName,
  measureLookbackStart,
  nameSearchToken,
  toMeasureAppointment,
  type MeasureAppointment,
  type MeasureRow,
} from "./measure-appointments";

// Reads the Tech Measure rows of work_orders — read-only. Nothing in here writes.
//
// Reads go through work_orders_visible, like every other read in the app (see
// WORK_ORDERS_READ in store.ts): for anyone who is not a restricted installer it
// is the table, column for column. Only the columns the screen draws are asked
// for — no phone, no email, no money.

const READ = "work_orders_visible";
const COLUMNS =
  "id, order_number, work_order_number, customer_name, contact_name, account_name, address, appointment_status, status, scheduled_start, tech_measure, primary_resource";

export interface MeasureFetch {
  rows: MeasureAppointment[];
  /** The query came back full, so there may be more than this. */
  truncated: boolean;
  /** Showing the copy saved on this phone because the lookup failed. */
  fromCache: boolean;
  /** ISO time the rows were fetched (or, for a cached copy, saved). */
  fetchedAt: string | null;
  error: string | null;
}

/**
 * Appointments to list, newest query first.
 *
 *   scope "mine": only rows assigned to `name`. The database is narrowed to rows
 *                 mentioning the name's longest word in either assigned-tech
 *                 column, then the exact (folded) name decides. A blank name
 *                 fetches nothing at all.
 *   scope "all" : every tech's, dated ones only (an undated "To be Scheduled"
 *                 row with nobody on it is the office's to chase, not a list).
 *
 * Dated rows start MEASURE_LOOKBACK_DAYS back, so "date passed, still open" is
 * bounded; "mine" also pulls the undated ones, for the "Not scheduled yet" group.
 */
export async function fetchMeasureAppointments(
  scope: "mine" | "all",
  name: string,
  now: Date = new Date()
): Promise<MeasureFetch> {
  const empty: MeasureFetch = { rows: [], truncated: false, fromCache: false, fetchedAt: null, error: null };
  const supabase = getSupabase();
  if (!supabase) return { ...empty, error: "Not connected to the database." };

  const token = scope === "mine" ? nameSearchToken(name) : "";
  if (scope === "mine" && !token) return { ...empty, fetchedAt: now.toISOString() };

  const nameFilter = `tech_measure.ilike.%${token}%,primary_resource.ilike.%${token}%`;

  try {
    // Filters first, then ordering and the bound.
    let datedQuery = supabase
      .from(READ)
      .select(COLUMNS)
      .eq("work_order_type", MEASURE_WORK_ORDER_TYPE)
      .gte("scheduled_start", measureLookbackStart(now));
    if (scope === "mine") datedQuery = datedQuery.or(nameFilter);
    const dated = datedQuery
      .order("scheduled_start", { ascending: true })
      .order("id", { ascending: true })
      .limit(MEASURE_MAX_ROWS);

    const undated =
      scope === "mine"
        ? supabase
            .from(READ)
            .select(COLUMNS)
            .eq("work_order_type", MEASURE_WORK_ORDER_TYPE)
            .is("scheduled_start", null)
            .or(nameFilter)
            .order("id", { ascending: true })
            .limit(200)
        : Promise.resolve(null);

    const [d, u] = await Promise.all([dated, undated]);
    if (d.error) throw new Error(d.error.message);
    if (u?.error) throw new Error(u.error.message);

    const all = [...((d.data ?? []) as MeasureRow[]), ...((u?.data ?? []) as MeasureRow[])].map(toMeasureAppointment);
    return {
      rows: scope === "mine" ? filterAssignedTo(all, name) : all,
      truncated: (d.data?.length ?? 0) >= MEASURE_MAX_ROWS,
      fromCache: false,
      fetchedAt: now.toISOString(),
      error: null,
    };
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : "Could not load appointments." };
  }
}

// ─── Saved copy, for a tech with no signal ──────────────────────────────────
// A basement has no bars, and "where am I going" is exactly the question asked
// there. Only a tech's own list is kept (small); keyed by the folded name so a
// shared handset never shows one tech another's appointments.

const CACHE_PREFIX = "rba-measures:";

interface CachedMeasures {
  fetchedAt: string;
  rows: MeasureAppointment[];
}

export function saveMeasureCache(name: string, rows: MeasureAppointment[], fetchedAt: string): void {
  const key = foldName(name);
  if (!key || typeof window === "undefined") return;
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ fetchedAt, rows } satisfies CachedMeasures));
  } catch {
    /* storage full or blocked — no offline copy, nothing else lost */
  }
}

export function loadMeasureCache(name: string): CachedMeasures | null {
  const key = foldName(name);
  if (!key || typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_PREFIX + key) || "null") as CachedMeasures | null;
    return parsed && Array.isArray(parsed.rows) && typeof parsed.fetchedAt === "string" ? parsed : null;
  } catch {
    return null;
  }
}
