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
import { mergeLengths } from "./lengths";
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
  /** Came from the write-up (as opposed to a line the office added on the
   *  order). Only these are touched when the write-up's trim changes. */
  fromWriteup?: boolean;
}

/** An earlier write-up trim order on the same job. */
export interface PriorTrimOrder {
  po: string;
  status: string;
  savedAt: string;
  /** The trim already on it, for an overlap check at a glance. */
  profiles: string[];
}

/** A handoff that could NOT be written. The trim still needs ordering, so this
 *  is shown on the write-up's confirmation rather than swallowed — a silently
 *  dropped order is how this went unnoticed from 2026-10-12 to 2026-10-15,
 *  when every field manager's insert was being refused by RLS. */
export interface TrimOrderFailure {
  failed: true;
  /** How many trim lines did not make it over. */
  lineCount: number;
  /** Short, field-readable reason. */
  reason: string;
}

export type TrimHandoff = TrimOrderResult | TrimOrderFailure;

/** True when the handoff failed, as opposed to succeeding or having nothing
 *  to send (null). */
export function handoffFailed(h: TrimHandoff | null): h is TrimOrderFailure {
  return !!h && (h as TrimOrderFailure).failed === true;
}

export interface TrimOrderResult {
  po: string;
  /** 1 for the first write-up trim order on this job, 2 for the next, … */
  sequence: number;
  lineCount: number;
  /** Non-empty when this job already had write-up trim orders. */
  priorOrders: PriorTrimOrder[];
  /** Set when an edit changed the trim on an order that was already open, in
   *  place of opening a second one. */
  updated?: { added: number; removed: number; changed: number };
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

/** Whether two lengths entries combine into one that still says the same
 *  thing. "4@8'" + "2@8'" is 6 pieces and "2" + "2" is 4 of something, but
 *  ".5" + ".5" is half a roll twice over, which mergeLengths keeps as ".5" —
 *  merging those two lines would order half of what the field asked for. So
 *  anything that doesn't add up is left as separate lines. */
function lengthsAddUp(a: string, b: string): boolean {
  const left = (a || "").trim();
  const right = (b || "").trim();
  if (!left || left === "—" || !right || right === "—") return true;
  const counted = (s: string) => /(\d+)@(\S+)/.test(s);
  if (counted(left) && counted(right)) return true;
  return /^\d+$/.test(left) && /^\d+$/.test(right);
}

/**
 * The trim lines from a write-up that actually need ordering.
 *
 * Identical lines are combined into one, quantities added and lengths merged.
 * A work item spanning three units now carries a material list PER UNIT, so the
 * same casing on all three arrives here as three lines — and the order editor
 * has no unit on a line, so those would read as three anonymous copies of each
 * other and print as three rows on the vendor's PO. One line to buy is what the
 * office always got from a write-up, and what its own material total still
 * shows, so that is what goes over.
 */
export function orderableTrimLines(materials: WriteUpMaterialItem[]): StandaloneOrderLine[] {
  const out: StandaloneOrderLine[] = [];
  const byKey = new Map<string, StandaloneOrderLine>();
  for (const m of materials) {
    if (m.kind === "part" || !(m.item || "").trim() || !isOrderable(m.vendor)) continue;
    const line: StandaloneOrderLine = {
      id: newLineId(),
      profileId: m.profileId || "",
      profile: (m.item || "").trim(),
      category: m.category || "",
      species: m.species || "",
      color: m.color || "",
      vendor: (m.vendor || "").trim(),
      qty: m.qty > 0 ? m.qty : 1,
      lengths: m.lengths || "",
      fromWriteup: true,
    };
    // The unit of measure joins the key even though a line doesn't carry one:
    // 2 tubes and 2 pieces of the same thing are not 4 of anything.
    const key = [
      line.profileId,
      line.profile.toLowerCase(),
      line.species.toLowerCase(),
      line.color.toLowerCase(),
      line.vendor.toLowerCase(),
      (m.unit || "").trim().toLowerCase(),
    ].join("|");
    const seen = byKey.get(key);
    if (!seen || !lengthsAddUp(seen.lengths, line.lengths)) {
      if (!seen) byKey.set(key, line);
      out.push(line);
      continue;
    }
    seen.qty += line.qty;
    seen.lengths = mergeLengths(seen.lengths, line.lengths);
  }
  return out;
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
 * in-house stock. On a failure it returns a TrimOrderFailure instead: still
 * never throws, so a write-up never fails over this, but the caller can SAY
 * the trim didn't go rather than leaving it to a console warning.
 *
 * An earlier order on the same job is never touched, ordered or not: this
 * always opens a new one, numbered so it is obvious it is the second.
 */
export async function sendTrimToOrdering(args: {
  orderNumber: string;
  customerName: string;
  materials: WriteUpMaterialItem[];
}): Promise<TrimHandoff | null> {
  const { orderNumber, customerName, materials } = args;
  const lines = orderableTrimLines(materials);
  if (!lines.length) return null;

  const supabase = getSupabase();
  if (!supabase) {
    return { failed: true, lineCount: lines.length, reason: "no connection to the database" };
  }

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
        // Ties the order to its write-up by column, not by name, so a rename
        // in the material-list app (which deletes the WU- row and re-saves it
        // under the real number) cannot orphan it. See migration 044.
        writeup_job: String(orderNumber).trim(),
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
        // Older database: drop the link column first, then the later
        // companion columns, rather than losing the order.
        const { writeup_job: _link, ...noLink } = base;
        void _link;
        ({ error } = await supabase.from("standalone_trim_orders").insert(noLink));
      }

      if (!error) return { po, sequence, lineCount: lines.length, priorOrders };
      if (!isDuplicateKey(error)) throw error;
    }
    throw new Error("could not find a free PO number after 5 tries");
  } catch (e) {
    console.warn("sendTrimToOrdering failed:", e);
    return { failed: true, lineCount: lines.length, reason: failureReason(e) };
  }
}

// ─── EDITING A WRITE-UP WHOSE TRIM IS ALREADY ON AN ORDER ──────────────────
//
// An edit that changes the write-up's TRIM updates the order it already opened
// (while that order is still unplaced) instead of opening a second one. An edit
// that changes anything else -- notes, photos, units, work items, parts -- never
// reaches this code's database calls at all: trimChanged() is the gate.

/** True only when the write-up's trim lines (parts excluded) are different
 *  between the two lists: added, removed, or any field of a line changed -- the
 *  vendor included, since moving a line to another vendor is a materials change.
 *  The order of the lines does not matter. */
export function trimChanged(
  previous: WriteUpMaterialItem[],
  next: WriteUpMaterialItem[]
): boolean {
  const count = (list: WriteUpMaterialItem[]) => {
    const map = new Map<string, number>();
    for (const m of list) {
      if (m.kind === "part") continue;
      const k = lineSignature(m);
      map.set(k, (map.get(k) || 0) + 1);
    }
    return map;
  };
  const a = count(previous);
  const b = count(next);
  if (a.size !== b.size) return true;
  for (const [k, n] of a) if (b.get(k) !== n) return true;
  return false;
}

/** What identifies "the same trim" across an edit, vendor and quantity aside. */
function lineKey(l: {
  profileId?: string;
  profile?: string;
  item?: string;
  species?: string;
  color?: string;
}): string {
  return [
    l.profileId || "",
    String(l.profile ?? l.item ?? "").trim().toLowerCase(),
    String(l.species || "").trim().toLowerCase(),
    String(l.color || "").trim().toLowerCase(),
  ].join("|");
}

/** The vendor the write-up itself carried for each trim line, by key. */
function writeupVendors(list: WriteUpMaterialItem[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of list) {
    if (m.kind === "part") continue;
    out.set(lineKey(m), (m.vendor || "").trim());
  }
  return out;
}

/** The newest unplaced order this write-up opened, or null. Found by the link
 *  column, so it still works after the office renamed it. */
async function findOpenLinkedOrder(orderNumber: string): Promise<{
  po: string;
  note: string | null;
  lines: StandaloneOrderLine[];
} | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("standalone_trim_orders")
    .select("po, note, lines, status, created_at")
    .eq("writeup_job", String(orderNumber).trim())
    .in("status", ["ready_to_order", "on_hold"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return {
    po: row.po,
    note: row.note ?? null,
    lines: Array.isArray(row.lines) ? (row.lines as StandaloneOrderLine[]) : [],
  };
}

/**
 * Hand a saved edit's trim to ordering.
 *
 *  - Nothing in the TRIM changed  -> null. No query is made.
 *  - The job has an order that isn't placed yet -> that order is UPDATED:
 *    lines the write-up added are added, lines it dropped are removed, and a
 *    changed quantity or length is carried over. The vendor already on an
 *    order line is KEPT (whoever is ordering owns it) unless this edit changed
 *    that line's vendor on the write-up. Lines the office added by hand are
 *    never removed.
 *  - No open order (never opened, or already placed) -> a new order with just
 *    what was added, exactly as before.
 *
 * Like sendTrimToOrdering this never throws.
 */
export async function syncEditedTrim(args: {
  orderNumber: string;
  customerName: string;
  before: WriteUpMaterialItem[];
  after: WriteUpMaterialItem[];
}): Promise<TrimHandoff | null> {
  const { orderNumber, customerName, before, after } = args;
  if (!trimChanged(before, after)) return null;

  const desired = orderableTrimLines(after);
  let open: Awaited<ReturnType<typeof findOpenLinkedOrder>> = null;
  try {
    open = await findOpenLinkedOrder(orderNumber);
  } catch (e) {
    console.warn("findOpenLinkedOrder failed:", e);
    // Fall through to opening a new order rather than dropping the trim.
  }

  if (!open) {
    const added = newlyAddedTrim(before, after);
    if (!added.length) return null;
    return sendTrimToOrdering({ orderNumber, customerName, materials: added });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return { failed: true, lineCount: desired.length, reason: "no connection to the database" };
  }

  try {
    const vendorBefore = writeupVendors(before);
    const vendorAfter = writeupVendors(after);
    const wanted = new Map<string, StandaloneOrderLine>();
    for (const d of desired) wanted.set(lineKey(d), d);

    let added = 0;
    let removed = 0;
    let changed = 0;
    const used = new Set<string>();
    const lines: StandaloneOrderLine[] = [];

    for (const existing of open.lines) {
      const k = lineKey(existing);
      const want = wanted.get(k);
      if (!want || used.has(k)) {
        // The write-up no longer wants it. Only lines it put there are removed;
        // anything the office typed in themselves stays.
        if (existing.fromWriteup && !want) {
          removed++;
          continue;
        }
        lines.push(existing);
        continue;
      }
      used.add(k);
      const next: StandaloneOrderLine = { ...existing };
      if (existing.qty !== want.qty || (existing.lengths || "") !== (want.lengths || "")) {
        next.qty = want.qty;
        next.lengths = want.lengths;
        changed++;
      }
      // Vendor: the order's choice wins unless THIS edit moved the line.
      if (vendorBefore.get(k) !== vendorAfter.get(k) && want.vendor !== existing.vendor) {
        next.vendor = want.vendor;
        changed++;
      }
      next.fromWriteup = true;
      lines.push(next);
    }
    for (const [k, want] of wanted) {
      if (used.has(k)) continue;
      lines.push(want);
      added++;
    }

    const result: TrimOrderResult = {
      po: open.po,
      sequence: 1,
      lineCount: lines.length,
      priorOrders: [],
      updated: { added, removed, changed },
    };
    if (!added && !removed && !changed) return result;

    const now = new Date().toISOString();
    const stamp = new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
    const bits = [
      added ? `${added} added` : "",
      removed ? `${removed} removed` : "",
      changed ? `${changed} changed` : "",
    ].filter(Boolean);
    const note = [open.note || "", `Write-up edited ${stamp} — trim ${bits.join(", ")}. Review before ordering.`]
      .filter(Boolean)
      .join("\n");

    const { error } = await supabase
      .from("standalone_trim_orders")
      .update({ lines, note, updated_at: now, writeup_changed_at: now })
      .eq("po", open.po);
    if (error) throw error;
    return result;
  } catch (e) {
    console.warn("syncEditedTrim failed:", e);
    return { failed: true, lineCount: desired.length, reason: failureReason(e) };
  }
}

/** One trim order tied to a write-up, for showing on the write-up. */
export interface LinkedTrimOrder {
  po: string;
  status: string;
  updatedAt: string;
  orderedAt: string | null;
  lines: { profile: string; species: string; color: string; vendor: string; qty: number; lengths: string }[];
}

/** Every trim order opened for this job's write-up, newest first. Read-only. */
export async function fetchLinkedTrimOrders(orderNumber: string): Promise<LinkedTrimOrder[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("standalone_trim_orders")
      .select("po, status, lines, updated_at, ordered_at")
      .eq("writeup_job", String(orderNumber).trim())
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      po: row.po,
      status: row.status || "",
      updatedAt: row.updated_at || "",
      orderedAt: row.ordered_at || null,
      lines: (Array.isArray(row.lines) ? row.lines : [])
        .filter((l: any) => l && (l.profile || l.profileId))
        .map((l: any) => ({
          profile: String(l.profile || ""),
          species: String(l.species || ""),
          color: String(l.color || ""),
          vendor: String(l.vendor || ""),
          qty: Number(l.qty) || 0,
          lengths: String(l.lengths || ""),
        })),
    }));
  } catch (e) {
    // Includes "column does not exist" before migration 044 is applied.
    console.warn("fetchLinkedTrimOrders failed:", e);
    return [];
  }
}

/** Why the write didn't land, in words a field manager can repeat to the
 *  office. 42501 is Postgres's "row-level security refused this" — the exact
 *  failure this handoff hit for its first three days. */
function failureReason(e: unknown): string {
  const code = (e as { code?: string } | null)?.code;
  if (code === "42501") return "this account isn't allowed to open trim orders";
  const msg = (e as { message?: string } | null)?.message;
  return msg ? String(msg) : "unknown error";
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
