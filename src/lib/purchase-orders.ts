/**
 * "Is the product in yet?" — the one thing a job tile could never answer.
 *
 * The daily rForce PO report fills `purchase_orders` (migration 040) and
 * `purchase_order_rollup()` (041) summarises it one row per job. Migration 042
 * is what makes this useful on a SERVICE tile: `order_number` is the job a PO
 * belongs to, install or service, so a service job's parts are reachable by
 * its own number for the first time. Before that they were filed under the
 * original install and only 6 of ~292 open service jobs had parts we could
 * see; now 95 do.
 *
 * Two dates not to confuse. `latest_ship_date` here is the VENDOR's estimated
 * ship date. The confirmation auditor separately stores a planned DELIVERY
 * date read off the confirmation PDF, which the material-list app shows as its
 * ETA chips. Different numbers from different places.
 *
 * `received_at` comes from a once-a-day feed, so it means "seen received by
 * this morning" — a date, never a time, and it can lag the real dock by a day.
 */

import { getSupabase } from "./supabase";

export interface PurchaseOrderRollup {
  /** Live POs on this job. */
  poCount: number;
  /** How many the vendor has acknowledged (Confirmed or further along). */
  acknowledgedCount: number;
  /** How many have landed (Received, or Partially Received). */
  receivedCount: number;
  totalCost: number | null;
  /** The last PO to ship — when the job is actually complete. ISO, or null. */
  latestShipDate: string | null;
  lastReceivedAt: string | null;
}

/** Keyed by the job's order number, which is what a work order carries. */
export type PurchaseOrderIndex = Map<string, PurchaseOrderRollup>;

export async function fetchPurchaseOrderIndex(): Promise<PurchaseOrderIndex> {
  const index: PurchaseOrderIndex = new Map();
  const supabase = getSupabase();
  if (!supabase) return index;

  // Empty rather than thrown when the function isn't deployed or the caller's
  // role can't read the table (040 keeps costs away from installers). Every
  // caller treats "nothing known" as "show no parts line", which is the right
  // answer in both cases.
  const { data, error } = await supabase.rpc("purchase_order_rollup");
  if (error || !data) return index;

  for (const row of data as Record<string, unknown>[]) {
    const orderNumber = String(row.order_number ?? "").trim();
    if (!orderNumber) continue;
    index.set(orderNumber, {
      poCount: Number(row.po_count) || 0,
      acknowledgedCount: Number(row.acknowledged_count) || 0,
      receivedCount: Number(row.received_count) || 0,
      totalCost:
        row.total_cost === null || row.total_cost === undefined ? null : Number(row.total_cost),
      latestShipDate: (row.latest_ship_date as string) || null,
      lastReceivedAt: (row.last_received_at as string) || null,
    });
  }
  return index;
}

/** "2026-12-02" -> "12/2". Short, because it sits on a crowded tile. */
export function shortShipDate(iso: string | null): string | null {
  if (!iso) return null;
  const parts = String(iso).slice(0, 10).split("-");
  if (parts.length !== 3) return null;
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

function money(total: number | null): string | null {
  if (total === null || !Number.isFinite(total)) return null;
  return total.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export type PartsStage = "waiting" | "ordered" | "partial" | "received";

export interface PartsSummary {
  stage: PartsStage;
  /** What the chip says. */
  label: string;
  /** The long version, for the tooltip — cost and PO count live here. */
  detail: string;
}

/**
 * What a tile should say about the product, in one phrase.
 *
 * The four states a job passes through, in order: the vendor hasn't
 * acknowledged every PO yet (so no committed ship date exists), all
 * acknowledged and shipping, part of it landed, all of it landed.
 *
 * The partial state earns its own wording because "it's here" would be a lie
 * when half of it is, and an order carries up to nine POs.
 *
 * Returns null when the feed knows nothing about this job, so a tile for a job
 * with no POs renders exactly as it did before.
 */
export function describeParts(rollup: PurchaseOrderRollup | null | undefined): PartsSummary | null {
  if (!rollup || rollup.poCount === 0) return null;

  const { poCount, acknowledgedCount, receivedCount } = rollup;
  const ship = shortShipDate(rollup.latestShipDate);
  const cost = money(rollup.totalCost);
  const poLabel = `${poCount} PO${poCount === 1 ? "" : "s"}`;
  const costNote = cost ? ` · ${cost}` : "";

  if (receivedCount >= poCount) {
    const seen = rollup.lastReceivedAt
      ? new Date(rollup.lastReceivedAt).toLocaleDateString()
      : null;
    return {
      stage: "received",
      label: "On the dock",
      detail: `All ${poLabel} received${seen ? ` · seen ${seen}` : ""}${costNote}`,
    };
  }

  if (receivedCount > 0) {
    return {
      stage: "partial",
      label: `${receivedCount} of ${poCount} in`,
      detail: `${receivedCount} of ${poLabel} received${ship ? ` · rest ships ${ship}` : ""}${costNote}`,
    };
  }

  if (acknowledgedCount >= poCount) {
    return {
      stage: "ordered",
      label: ship ? `Ships ${ship}` : "Ordered",
      detail: `${poLabel} confirmed by the vendor${ship ? ` · last ships ${ship}` : ", no ship date yet"}${costNote}`,
    };
  }

  const waiting = poCount - acknowledgedCount;
  return {
    stage: "waiting",
    label: `${waiting} not confirmed`,
    detail: `${acknowledgedCount} of ${poLabel} confirmed by the vendor — no ship date until they all are${costNote}`,
  };
}
