/**
 * Service jobs and the parts they are waiting on.
 *
 * A service job's parts only became findable in migration 042, when
 * `purchase_orders.order_number` started meaning the job a PO belongs to
 * rather than the order it was sold under. Before that they were filed against
 * the original install and there was no way to ask "what is this service job
 * waiting for". Now there is, and this is the screen that asks it for all of
 * them at once instead of one tile at a time.
 *
 * Two things it is built to surface, which nothing else in the apps shows:
 *   * service jobs whose parts are sitting on the dock and which nobody has
 *     scheduled — on the live data, some have been waiting since last year;
 *   * service jobs where the vendor has not acknowledged a PO, which is the
 *     only state somebody has to go chase a human about.
 */

import { getSupabase } from "./supabase";
import { fetchPurchaseOrderIndex, describeParts, type PartsSummary } from "./purchase-orders";

/**
 * Service work orders that are finished. rForce says so two ways and they do
 * not always agree, so a job is done when EITHER says it is.
 */
const DONE_STATUS = "Service Complete";
const DONE_APPOINTMENT = "Appt Complete / Closed";

export interface ServicePartsRow {
  orderNumber: string;
  customerName: string;
  address: string;
  /** rForce's job status, e.g. "Service To Be Scheduled". */
  status: string;
  /** Null when the service visit has not been put on the calendar yet. */
  scheduledStart: string | null;
  serviceDescription: string;
  parts: PartsSummary;
  /** The ship date behind the chip, ISO, for sorting. */
  shipDate: string | null;
  /** When the parts landed, ISO, for sorting the dock list oldest-first. */
  receivedAt: string | null;
}

/** The order the groups are worked in: what can be acted on comes first. */
export const PARTS_GROUPS = [
  {
    key: "received",
    title: "Parts on the dock",
    blurb: "Everything has landed. These can be scheduled.",
  },
  {
    key: "partial",
    title: "Some parts in",
    blurb: "Part of the order landed; the rest is still coming.",
  },
  {
    key: "ordered",
    title: "On the way",
    blurb: "The vendor has confirmed every PO and given a ship date.",
  },
  {
    key: "waiting",
    title: "Vendor has not confirmed",
    blurb: "No ship date until they do. These are the ones to chase.",
  },
] as const;

export type PartsGroupKey = (typeof PARTS_GROUPS)[number]["key"];

/**
 * Every open service job that has purchase orders in rForce.
 *
 * Returns an empty list rather than throwing when the caller cannot read the
 * purchase-order table — installers are kept out of it by migration 040, and
 * an empty screen is the right answer for them.
 */
export async function fetchServiceParts(): Promise<ServicePartsRow[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const index = await fetchPurchaseOrderIndex();
  if (index.size === 0) return [];

  const { data, error } = await supabase
    .from("work_orders")
    .select(
      "order_number, customer_name, address, status, appointment_status, scheduled_start, service_description"
    )
    .eq("work_order_type", "Service")
    // An explicit limit, because the default page size is smaller than the
    // number of service work orders and a short read would quietly hide jobs.
    .limit(5000);

  if (error || !data) return [];

  const rows: ServicePartsRow[] = [];
  const seen = new Set<string>();

  for (const wo of data as Record<string, string | null>[]) {
    const orderNumber = (wo.order_number ?? "").trim();
    if (!orderNumber || seen.has(orderNumber)) continue;
    if ((wo.status ?? "") === DONE_STATUS) continue;
    if ((wo.appointment_status ?? "") === DONE_APPOINTMENT) continue;

    const rollup = index.get(orderNumber);
    const parts = describeParts(rollup);
    if (!parts || !rollup) continue;

    seen.add(orderNumber);
    rows.push({
      orderNumber,
      customerName: wo.customer_name ?? "",
      address: wo.address ?? "",
      status: wo.status ?? "",
      scheduledStart: wo.scheduled_start ?? null,
      serviceDescription: wo.service_description ?? "",
      parts,
      shipDate: rollup.latestShipDate,
      receivedAt: rollup.lastReceivedAt,
    });
  }

  return rows;
}

/**
 * Sort inside a group so the worst case floats up — which is the oldest ship
 * date in every group, for different reasons.
 *
 * On the dock, it means longest sitting there unscheduled. Elsewhere, it means
 * next to land. Undated rows go last: no date means the vendor has not
 * committed to one.
 *
 * Deliberately NOT `receivedAt` for the dock group, which would look like the
 * obvious choice. That stamp records when the feed first REPORTED a PO as
 * received, so every row already in the table carries the day of the first
 * import rather than the day the product actually arrived — it sorts them all
 * equal today, and would keep hiding the genuinely stale ones for as long as
 * the backfilled rows outnumber the new. The ship date was true when it was
 * written.
 */
export function sortGroup(rows: ServicePartsRow[], group: PartsGroupKey): ServicePartsRow[] {
  void group;
  return [...rows].sort((a, b) => {
    if (!a.shipDate && !b.shipDate) return 0;
    if (!a.shipDate) return 1;
    if (!b.shipDate) return -1;
    return a.shipDate.localeCompare(b.shipDate);
  });
}

/** True when the parts are here but nobody has put the visit on the calendar. */
export function needsScheduling(row: ServicePartsRow): boolean {
  return row.parts.stage === "received" && !row.scheduledStart;
}
