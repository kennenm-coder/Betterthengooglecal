import { getSupabase } from "./supabase";
import type { WorkOrder } from "./types";

/**
 * Appointments the scheduling app has booked that rForce does not have.
 *
 * Duck Force draws its calendar from rForce, so a job the scheduler books before
 * rForce knows about it (or that rForce never picks up) would otherwise be
 * invisible here. These come back from sched_unmatched_appointments() — see
 * supabase/migrations/077_scheduler_only_appointments.sql for exactly when an
 * appointment counts as "not in rForce" — and are drawn as their own tile,
 * marked "Scheduling app only".
 *
 * They are stand-in WorkOrders (schedulerOnly = true) so the day and week views
 * can place them by time and crew like any other tile. They never enter the
 * stored orders, so counts, search, More for More and the cache never see them.
 */

interface UnmatchedRow {
  appointment_id: string;
  appointment_type: string;
  customer_name: string | null;
  address: string | null;
  order_number: string | null;
  work_order_number: string | null;
  scheduled_date: string;
  last_date: string;
  start_time: string | null;
  end_time: string | null;
  lead_crew: string | null;
  day_crews: Record<string, string[]> | null;
}

/** The scheduling app's appointment types, in the words rForce (and the tile colours) use. */
const TYPE_LABEL: Record<string, string> = {
  install: "Install",
  service: "Service",
  tech_measure: "Tech Measure",
  job_site_visit: "Job Site Visit",
  jip: "JIP",
  lswp: "LSWP",
  hoa: "HOA",
  paint_stain: "Paint/Stain",
  collections: "Collections",
};

function dateOnly(v: string): string {
  // The date can come back as a full timestamp depending on the driver.
  return String(v).slice(0, 10);
}

/** "08:00:00" -> "08:00:00"; "8:00" -> "08:00:00". Null falls back to the given default. */
function clock(t: string | null, fallback: string): string {
  if (!t) return fallback;
  const [h = "00", m = "00", s = "00"] = t.split(":");
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}:${s.slice(0, 2).padStart(2, "0")}`;
}

function toStandIn(row: UnmatchedRow): WorkOrder {
  const first = dateOnly(row.scheduled_date);
  const last = dateOnly(row.last_date);
  const type = TYPE_LABEL[row.appointment_type] ?? row.appointment_type;
  return {
    id: `sched-only-${row.appointment_id}`,
    status: "Scheduling app only",
    orderNumber: row.order_number || "",
    workOrderNumber: row.work_order_number || "",
    address: row.address || "",
    bookingDate: null,
    customerName: row.customer_name || "",
    orderOwner: "",
    salesRep: "",
    techMeasure: "",
    installer: "",
    serviceRep: "",
    appointmentStatus: "Scheduling app only",
    scheduledStart: `${first}T${clock(row.start_time, "08:00:00")}`,
    scheduledEnd: `${last}T${clock(row.end_time, "17:00:00")}`,
    contactName: "",
    email: "",
    phones: [],
    serviceDescription: "",
    primaryResource: row.lead_crew || "",
    dayCrews: row.day_crews ?? null,
    workOrderType: type,
    description: "",
    combinedRetailTotal: 0,
    productCount: 0,
    totalUnits: 0,
    windows: 0,
    patioDoors: 0,
    doors: 0,
    orderAlerts: "",
    accountName: "",
    latitude: null,
    longitude: null,
    schedulerOnly: true,
    isMine: true,
  };
}

// The last answer per date range, for this page session (see the failure path).
const lastGoodByRange = new Map<string, WorkOrder[]>();

/**
 * Scheduling-app-only appointments for an inclusive date range.
 *
 * Returns an empty list rather than throwing when the function is missing or the
 * caller lacks access — these tiles are an extra, and must never be able to break
 * the calendar underneath them.
 */
export async function fetchSchedulerOnly(startDate: string, endDate: string): Promise<WorkOrder[]> {
  const sb = getSupabase();
  if (!sb) return [];

  const rangeKey = `${startDate}|${endDate}`;
  const { data, error } = await sb.rpc("sched_unmatched_appointments", {
    p_start: startDate,
    p_end: endDate,
  });

  if (error || !data) {
    if (error) console.warn("[scheduler-only] lookup failed:", error.message);
    // A failed lookup for a week we've already loaded keeps that week's tiles
    // rather than answering empty (a refresh on a weak signal must not wipe them).
    return lastGoodByRange.get(rangeKey) ?? [];
  }

  const out = (data as UnmatchedRow[]).map(toStandIn);
  lastGoodByRange.set(rangeKey, out);
  return out;
}
