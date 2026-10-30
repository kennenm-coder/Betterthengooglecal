/**
 * The service jobs a write-up turned into, and the parts they are waiting on.
 *
 * A write-up is filed against whatever job the field manager was standing on —
 * nearly always the original install. When the office orders parts to fix it,
 * rForce opens a SERVICE order with its own number: on live data only 4 of
 * 1,704 order numbers carry both a service work order and install-side work.
 * So the POs sitting on a write-up's own order number are the house's original
 * windows, not the parts for the fix, and reading them would light up 117 of
 * 163 open write-ups with news from last year.
 *
 * The address is therefore the join, the same way migration 039 matches
 * write-ups onto a service tile — this is that lookup run backwards. It finds
 * a service order at the write-up's address and reads ITS parts. 102 of 163
 * open write-ups match one.
 *
 * What that costs: two service jobs at one house pool together. The write-up
 * tile shows every match as its own card rather than merging them, so the
 * pooling is visible instead of silent, and a write-up with no service order
 * at its address gets nothing at all — which is what keeps this to the
 * write-ups that became service work.
 */

import { getSupabase } from "./supabase";
import { addressKey } from "./address-match";
import { fetchPurchaseOrderIndex, shortShipDate, type PurchaseOrderRollup } from "./purchase-orders";

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
  rollup: PurchaseOrderRollup;
  /** ZIP off the address, to tell two same-street houses apart. */
  zip: string;
}

/** Keyed by normalized street line; several service jobs can share one. */
export type ServicePartsIndex = Map<string, ServicePartsRow[]>;

/**
 * Every open service job that has purchase orders, keyed by street.
 *
 * Returns an empty index rather than throwing when the caller cannot read the
 * purchase-order table — installers are kept out of it by migration 040, and
 * no parts card is the right answer for them.
 */
export async function fetchServicePartsIndex(): Promise<ServicePartsIndex> {
  const index: ServicePartsIndex = new Map();
  const supabase = getSupabase();
  if (!supabase) return index;

  const rollups = await fetchPurchaseOrderIndex();
  if (rollups.size === 0) return index;

  const { data, error } = await supabase
    .from("work_orders")
    .select(
      "order_number, customer_name, address, status, appointment_status, scheduled_start, service_description"
    )
    .eq("work_order_type", "Service")
    // An explicit limit, because the default page size is smaller than the
    // number of service work orders and a short read would quietly hide jobs.
    .limit(5000);

  if (error || !data) return index;

  const seen = new Set<string>();

  for (const wo of data as Record<string, string | null>[]) {
    const orderNumber = (wo.order_number ?? "").trim();
    if (!orderNumber || seen.has(orderNumber)) continue;
    if ((wo.status ?? "") === DONE_STATUS) continue;
    if ((wo.appointment_status ?? "") === DONE_APPOINTMENT) continue;

    const rollup = rollups.get(orderNumber);
    if (!rollup || rollup.poCount === 0) continue;

    const key = addressKey(wo.address);
    if (!key.street) continue;

    seen.add(orderNumber);
    const list = index.get(key.street) || [];
    list.push({
      orderNumber,
      customerName: wo.customer_name ?? "",
      address: wo.address ?? "",
      status: wo.status ?? "",
      scheduledStart: wo.scheduled_start ?? null,
      serviceDescription: wo.service_description ?? "",
      rollup,
      zip: key.zip,
    });
    index.set(key.street, list);
  }

  for (const [street, list] of index) index.set(street, sortRows(list));
  return index;
}

/**
 * The service jobs with parts at this address.
 *
 * ZIP rules a row out only when both sides have one — a write-up stored with
 * the street line alone still belongs to its service order.
 */
export function servicePartsAt(
  index: ServicePartsIndex,
  address: string | null | undefined
): ServicePartsRow[] {
  const key = addressKey(address);
  if (!key.street) return [];
  const hits = index.get(key.street);
  if (!hits) return [];
  return hits.filter((h) => !key.zip || !h.zip || h.zip === key.zip);
}

/**
 * Worst case first, which is the oldest ship date for different reasons: the
 * longest sitting unscheduled when the parts are in, the next to land when
 * they are not. Undated last — no date means the vendor never committed to one.
 *
 * Deliberately NOT the received stamp, which would look like the obvious
 * choice for parts already in. That stamp records when the FEED first reported
 * a PO received, so every row that predates the feed carries the day of the
 * first import rather than the day the product arrived — it sorts them all
 * equal, and would keep hiding the genuinely stale ones. A ship date was true
 * when it was written.
 */
function sortRows(rows: ServicePartsRow[]): ServicePartsRow[] {
  return [...rows].sort((a, b) => {
    const x = a.rollup.latestShipDate;
    const y = b.rollup.latestShipDate;
    if (!x && !y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return x.localeCompare(y);
  });
}

/** True when the parts are here but nobody has put the visit on the calendar. */
export function needsScheduling(row: ServicePartsRow): boolean {
  const { poCount, receivedCount } = row.rollup;
  return poCount > 0 && receivedCount >= poCount && !row.scheduledStart;
}

export type PartsTagTone = "green" | "amber" | "sky" | "gray";

export interface PartsTag {
  tone: PartsTagTone;
  /** What the pill says on the collapsed tile. */
  label: string;
  /** The long version, for the tooltip. */
  detail: string;
  /** Drives the louder styling: the one state somebody has to act on. */
  urgent: boolean;
}

/**
 * "Received in rForce", not "on the dock" — the feed reports what rForce was
 * told, which can run ahead of the product physically landing. Saying the
 * narrower, true thing keeps somebody from driving out to a dock with nothing
 * on it.
 */
const RECEIVED = "Received in rForce";

/**
 * One pill for the collapsed write-up tile, across every service job at the
 * address.
 *
 * Precedence is what somebody would do next, not the stage a job is at: parts
 * in with no visit booked is the whole point of the pill, then a PO the vendor
 * has not acknowledged (the only state that needs a human chased), then the
 * in-between, then the quiet "it is in and booked".
 *
 * Returns null when no service job at this address has POs, so a write-up that
 * never became service work renders exactly as it did before.
 */
export function partsTagFor(rows: ServicePartsRow[]): PartsTag | null {
  if (rows.length === 0) return null;

  const ready = rows.filter(needsScheduling);
  if (ready.length > 0) {
    const ship = shortShipDate(ready[0].rollup.latestShipDate);
    const who =
      ready.length === 1 ? `service order ${ready[0].orderNumber}` : `${ready.length} service orders`;
    return {
      tone: "green",
      label: `${RECEIVED} · not scheduled`,
      detail: `Every PO on ${who} is received in rForce and no visit is booked${
        ship ? ` · last shipped ${ship}` : ""
      }`,
      urgent: true,
    };
  }

  const waiting = rows.filter((r) => r.rollup.acknowledgedCount < r.rollup.poCount);
  if (waiting.length > 0) {
    const short = waiting[0].rollup.poCount - waiting[0].rollup.acknowledgedCount;
    return {
      tone: "gray",
      label: "Vendor has not confirmed",
      detail: `${short} PO${short === 1 ? "" : "s"} on service order ${
        waiting[0].orderNumber
      } still unacknowledged — no ship date until they are`,
      urgent: false,
    };
  }

  const partial = rows.filter(
    (r) => r.rollup.receivedCount > 0 && r.rollup.receivedCount < r.rollup.poCount
  );
  if (partial.length > 0) {
    const r = partial[0].rollup;
    const ship = shortShipDate(r.latestShipDate);
    return {
      tone: "amber",
      label: `${r.receivedCount} of ${r.poCount} in${ship ? ` · ETA ${ship}` : ""}`,
      detail: `Part of service order ${partial[0].orderNumber} is in; the rest${
        ship ? ` ships ${ship}` : " has no ship date yet"
      }`,
      urgent: false,
    };
  }

  const coming = rows.filter((r) => r.rollup.receivedCount === 0);
  if (coming.length > 0) {
    const ship = shortShipDate(coming[0].rollup.latestShipDate);
    return {
      tone: "sky",
      label: ship ? `ETA ${ship}` : "Parts ordered",
      detail: `Every PO on service order ${coming[0].orderNumber} is confirmed${
        ship ? ` · last ships ${ship}` : ", with no ship date yet"
      }`,
      urgent: false,
    };
  }

  // Everything in and booked. Worth saying quietly: it answers "did the parts
  // ever turn up" without anybody opening the tile.
  const booked = rows[0];
  return {
    tone: "gray",
    label: RECEIVED,
    detail: `Service order ${booked.orderNumber} has every PO received${
      booked.scheduledStart ? " · visit booked" : ""
    }`,
    urgent: false,
  };
}
