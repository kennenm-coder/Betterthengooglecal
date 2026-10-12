// ─── WRITE-UP → TRIM ORDERING QUEUE ────────────────────────────────────────
// A submitted write-up's trim lines open a standalone trim order in the
// material-list maker's queue, as a shell someone finishes there later.
//
// The receiving table is `standalone_trim_orders`, which that app owns:
//
//   nwo-material-list-maker/cut-list-pro/lib/storage.js  saveStandaloneOrder
//   nwo-material-list-maker/cut-list-pro/components/TrimOnlyOrder.jsx  emptyLine
//
// Two things about its shape matter and are easy to get wrong:
//
//   - status "ready_to_order" is what puts the order in the queue's Ready
//     bucket. That app filters on this string, so nothing there needs to change
//     for a write-up's order to show up.
//   - every line needs an `id`. The order editor tracks rows by it, and a line
//     without one cannot be edited over there.
//
// Lines whose vendor is in-house (WAREHOUSE / RBA SHOP) or unset never come
// here — those mean the trim is already on hand. See trim-vendor.ts.
//
// A failure here must never cost a write-up: callers submit first and hand the
// trim over afterwards, and every function below resolves rather than throwing.

import { getSupabase } from "./supabase";
import { WriteUpMaterialItem } from "./types";
import { isOrderable } from "./trim-vendor";

/** One line as the material-list maker's order editor expects it. */
interface StandaloneOrderLine {
  id: string;
  profileId: string;
  profile: string;
  category: string;
  species: string;
  color: string;
  vendor: string;
  qty: number;
  lengths: string;
}

/** An earlier write-up trim order on the same job. */
export interface PriorTrimOrder {
  po: string;
  status: string;
  savedAt: string;
  /** The trim already on it, for an overlap check at a glance. */
  profiles: string[];
}

export interface TrimOrderResult {
  po: string;
  /** 1 for the first write-up trim order on this job, 2 for the next, … */
  sequence: number;
  lineCount: number;
  /** Non-empty when this job already had write-up trim orders. */
  priorOrders: PriorTrimOrder[];
}

/** Write-up trim orders are numbered per job, so the PO number itself says
 *  which job it belongs to and that it is the second (or third) one. */
const PO_PREFIX = "WU";

function poPrefixFor(orderNumber: string): string {
  return `${PO_PREFIX}-${String(orderNumber).trim()}-`;
}

function newLineId(): string {
  return "qo-" + Date.now() + Math.random().toString(36).slice(2, 5);
}

/** The trim lines from a write-up that actually need ordering. */
export function orderableTrimLines(materials: WriteUpMaterialItem[]): StandaloneOrderLine[] {
  return materials
    .filter((m) => m.kind !== "part" && (m.item || "").trim() && isOrderable(m.vendor))
    .map((m) => ({
      id: newLineId(),
      profileId: m.profileId || "",
      profile: (m.item || "").trim(),
      category: m.category || "",
      species: m.species || "",
      color: m.color || "",
      vendor: (m.vendor || "").trim(),
      qty: m.qty > 0 ? m.qty : 1,
      lengths: m.lengths || "",
    }));
}

/** Identity of a trim line for "is this the same line?" purposes. Quantity is
 *  part of it on purpose: bumping 5 pieces to 8 is a change that still needs
 *  ordering, and the repeat-order warning points at the earlier one so the
 *  difference can be reconciled rather than ordered twice over. */
function lineSignature(m: WriteUpMaterialItem): string {
  return [
    (m.item || "").trim().toLowerCase(),
    (m.color || "").trim().toLowerCase(),
    (m.species || "").trim().toLowerCase(),
    (m.lengths || "").trim().toLowerCase(),
    (m.vendor || "").trim().toLowerCase(),
    m.qty,
    m.unit || "",
  ].join("|");
}

/**
 * The trim on `next` that wasn't already on `previous` — what an edit actually
 * added.
 *
 * Editing a write-up has to hand over the NEW trim only. Sending the whole list
 * again would open an order duplicating everything the first one already
 * covers, which is the opposite of the point. Counted as a multiset, so adding
 * a second identical line sends one, not none.
 */
export function newlyAddedTrim(
  previous: WriteUpMaterialItem[],
  next: WriteUpMaterialItem[]
): WriteUpMaterialItem[] {
  const before = new Map<string, number>();
  for (const m of previous) {
    if (m.kind === "part") continue;
    const k = lineSignature(m);
    before.set(k, (before.get(k) || 0) + 1);
  }
  const added: WriteUpMaterialItem[] = [];
  for (const m of next) {
    if (m.kind === "part") continue;
    const k = lineSignature(m);
    const left = before.get(k) || 0;
    if (left > 0) before.set(k, left - 1);
    else added.push(m);
  }
  return added;
}

/** Every write-up trim order already opened for this job, newest first. */
export async function fetchPriorTrimOrders(orderNumber: string): Promise<PriorTrimOrder[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("standalone_trim_orders")
      .select("po, status, lines, updated_at, ordered_at")
      .like("po", `${poPrefixFor(orderNumber)}%`)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      po: row.po,
      status: row.status || "",
      savedAt: row.ordered_at || row.updated_at || "",
      profiles: [
        ...new Set(
          (Array.isArray(row.lines) ? row.lines : [])
            .map((l: any) => String(l?.profile || "").trim())
            .filter(Boolean)
        ),
      ] as string[],
    }));
  } catch (e) {
    console.warn("fetchPriorTrimOrders failed:", e);
    return [];
  }
}

/** Human-readable status, matching the queue's own buckets. */
function statusLabel(status: string): string {
  if (status === "ready_to_order") return "not ordered yet";
  if (status === "on_hold") return "on hold";
  if (status === "ordered") return "ordered";
  return status || "unknown";
}

function shortDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, "0")}`;
}

/** The order's note. Carries the job reference, and — when this job has had a
 *  write-up trim order before — what those orders already cover, so whoever
 *  places this one can check for overlap first. Kept factual: this note prints
 *  on the vendor PO unless it is cleared in the order editor. */
export function buildOrderNote(
  orderNumber: string,
  customerName: string,
  sequence: number,
  priorOrders: PriorTrimOrder[]
): string {
  const lines = [
    `Service write-up — job ${orderNumber}${customerName ? ` (${customerName})` : ""}`,
  ];
  if (sequence > 1 && priorOrders.length) {
    lines.push(
      "",
      `Trim order #${sequence} on this job. Check the earlier order${
        priorOrders.length > 1 ? "s" : ""
      } below before ordering — some of this may already be covered.`
    );
    for (const p of priorOrders) {
      const when = shortDate(p.savedAt);
      const covers = p.profiles.length ? ` — ${p.profiles.join(", ")}` : "";
      lines.push(`  ${p.po} (${statusLabel(p.status)}${when ? `, ${when}` : ""})${covers}`);
    }
  }
  return lines.join("\n");
}

/**
 * Open a standalone trim order for a submitted write-up's trim.
 *
 * Returns null when there is nothing to order — no trim, or every line is
 * in-house stock — and on any failure, so a write-up never fails over this.
 *
 * An earlier order on the same job is never touched, ordered or not: this
 * always opens a new one, numbered so it is obvious it is the second.
 */
export async function sendTrimToOrdering(args: {
  orderNumber: string;
  customerName: string;
  materials: WriteUpMaterialItem[];
}): Promise<TrimOrderResult | null> {
  const { orderNumber, customerName, materials } = args;
  const lines = orderableTrimLines(materials);
  if (!lines.length) return null;

  const supabase = getSupabase();
  if (!supabase) return null;

  try {
    const priorOrders = await fetchPriorTrimOrders(orderNumber);
    const now = new Date().toISOString();

    // `po` is the table's key. Two write-ups submitted on the same job at the
    // same moment would both count the same prior orders and pick the same
    // number, so a collision is retried on the next one up rather than losing
    // the second one's trim.
    for (let attempt = 0; attempt < 5; attempt++) {
      const sequence = priorOrders.length + 1 + attempt;
      const po = `${poPrefixFor(orderNumber)}${sequence}`;
      const base = {
        po,
        homeowner: customerName || null,
        note: buildOrderNote(orderNumber, customerName, sequence, priorOrders),
        status: "ready_to_order",
        lines,
        updated_at: now,
      };

      // The companion columns the material-list app writes. They arrived in
      // later migrations over there, so a database that hasn't run those yet
      // rejects the whole insert for naming them — in which case fall back to
      // the columns that have always existed rather than losing the order.
      let { error } = await supabase.from("standalone_trim_orders").insert({
        ...base,
        vendor_notes: {},
        vendor_adjustments: {},
        material_acks: {},
        send_log: [],
      });
      if (error && isMissingColumn(error)) {
        ({ error } = await supabase.from("standalone_trim_orders").insert(base));
      }

      if (!error) return { po, sequence, lineCount: lines.length, priorOrders };
      if (!isDuplicateKey(error)) throw error;
    }
    throw new Error("could not find a free PO number after 5 tries");
  } catch (e) {
    console.warn("sendTrimToOrdering failed:", e);
    return null;
  }
}

/** True when a write failed only because a column isn't in the schema yet —
 *  the same check the material-list app makes for its own later columns. */
function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === "PGRST204" || error?.code === "42703";
}

/** True when the insert lost a race for this PO number. */
function isDuplicateKey(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}
