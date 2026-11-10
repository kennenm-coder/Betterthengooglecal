// Where an open write-up's work stands in rForce, and when it should close
// itself.
//
// A write-up carries the order the field manager stood on — nearly always the
// install. The work it asks for happens on SERVICE orders rForce opens later,
// each with its own number, so the only thing tying them back is the address
// (see address-match.ts). The hourly import works the stage out once for every
// open write-up and stores it; the page just reads it.
//
// "Closed" in rForce is never sent: the report filters closed orders out. So an
// order counts as closed once it has been missing from the last
// MISSING_RUNS imports. The feed runs hourly 8am-5pm on weekdays, so that is
// about one working day — counted in imports, not hours, so a weekend gap
// doesn't make every order look closed on Monday morning.
//
// This file is pure (no database) so the server import and the page share one
// set of rules and one set of words.

/** Imports an order has to be missing from before it counts as closed. */
export const MISSING_RUNS = 10;

/** Days a write-up sits in Job Closed before it closes itself. */
export const AUTO_CLOSE_DAYS = 7;

export type StageKey =
  | "past_due"
  | "needs_scheduling"
  | "complete_not_closed"
  | "waiting_product"
  | "not_started"
  | "jip"
  | "scheduled"
  | "legacy"
  | "job_closed"
  | "closed_reopened";

export interface StageDetail {
  /** The order the tag is about (the one needing the most attention). */
  orderNumber?: string;
  /** That order's rForce status, word for word. */
  status?: string;
  /** YYYY-MM-DD: the visit date for scheduled / past_due. */
  date?: string;
  /** Orders behind this write-up still on the rForce report. */
  openOrders?: number;
}

/** One appointment row as the import stores it in work_orders. */
export interface OrderRow {
  order_number: string;
  status: string | null;
  work_order_type: string | null;
  scheduled_start: string | null;
  /** Last import that carried this row — the upload bumps it on every row. */
  updated_at: string;
}

// ── Which rForce statuses mean what ─────────────────────────────────────────
// Statuses not listed here fall through to "not_started" (New, Quote, On
// Hold, Customer Call Back, Seasonal Service, Pending Cancellation, ...), which
// shows the status word itself, so a new rForce status never hides.

const COMPLETE = new Set([
  "Service Complete",
  "Install Complete",
  "Warranty Accepted",
  "Job Closed",
  "Appt Complete / Closed",
]);
const WAITING_PRODUCT = new Set(["Product Ordered", "To Be Ordered", "Ready to Order", "Order Released"]);
const NEEDS_SCHEDULING = new Set(["Service To Be Scheduled", "Install Needed"]);
const SCHEDULED = new Set(["Service Scheduled", "Install Scheduled", "Scheduled & Assigned"]);
const JIP = "Job in Progress";

/** Most-needs-a-person first. A write-up with several open orders shows the
 *  one at the top of this list. JIP is last: the install order usually stays
 *  "Job in Progress" the whole time its service work runs, so it is only the
 *  headline when nothing else at the address is open. */
const PRECEDENCE: StageKey[] = [
  "past_due",
  "needs_scheduling",
  "complete_not_closed",
  "waiting_product",
  "not_started",
  "scheduled",
  "jip",
];

/** A date's calendar day in Ohio, as YYYY-MM-DD. */
export function ohioDay(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** The stage of one order still on the rForce report. */
function orderStage(rows: OrderRow[], today: string): { key: StageKey; detail: StageDetail } {
  // The freshest row carries the order's current status.
  const latest = [...rows].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  const status = (latest.status || "").trim();
  const days = rows
    .map((r) => r.scheduled_start)
    .filter((s): s is string => !!s)
    .map(ohioDay)
    .sort();
  const upcoming = days.find((d) => d >= today);
  const lastPast = [...days].reverse().find((d) => d < today);
  const base = { orderNumber: latest.order_number, status };

  // A visit on the calendar answers "where is it" whatever the status says.
  if (upcoming && !COMPLETE.has(status)) return { key: "scheduled", detail: { ...base, date: upcoming } };
  if (COMPLETE.has(status)) return { key: "complete_not_closed", detail: base };
  if (WAITING_PRODUCT.has(status)) return { key: "waiting_product", detail: base };
  if (NEEDS_SCHEDULING.has(status)) return { key: "needs_scheduling", detail: base };
  if (SCHEDULED.has(status)) {
    return lastPast
      ? { key: "past_due", detail: { ...base, date: lastPast } }
      : { key: "needs_scheduling", detail: base };
  }
  if (status === JIP) return { key: "jip", detail: base };
  return { key: "not_started", detail: base };
}

export interface StageInput {
  /** Every work_orders row carrying the write-up's own order number. */
  ownRows: OrderRow[];
  /** Service and Job Site Visit rows at the same address on OTHER orders. */
  addressRows: OrderRow[];
  /** Rows last seen before this count as off the report (closed). */
  cutoff: string;
  now: Date;
}

/**
 * Where this write-up's work stands.
 *
 * legacy     — rForce has never sent its own order; nothing to go on.
 * job_closed — its own order and every order at the address are off the report.
 * otherwise  — the stage of whichever still-open order most needs a person.
 */
export function computeStage(input: StageInput): { key: StageKey; detail: StageDetail } {
  if (input.ownRows.length === 0) return { key: "legacy", detail: {} };

  const byOrder = new Map<string, OrderRow[]>();
  for (const r of [...input.ownRows, ...input.addressRows]) {
    if (!r.order_number) continue;
    const list = byOrder.get(r.order_number) || [];
    list.push(r);
    byOrder.set(r.order_number, list);
  }

  const today = ohioDay(input.now);
  const open: { key: StageKey; detail: StageDetail }[] = [];
  for (const rows of byOrder.values()) {
    const lastSeen = rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), "");
    if (lastSeen < input.cutoff) continue; // off the report = closed in rForce
    open.push(orderStage(rows, today));
  }

  if (open.length === 0) return { key: "job_closed", detail: { openOrders: 0 } };

  open.sort((a, b) => {
    const p = PRECEDENCE.indexOf(a.key) - PRECEDENCE.indexOf(b.key);
    if (p !== 0) return p;
    // Two of the same kind: the earliest date first (the oldest miss, the
    // next visit).
    return (a.detail.date || "9999").localeCompare(b.detail.date || "9999");
  });
  return { key: open[0].key, detail: { ...open[0].detail, openOrders: open.length } };
}

/**
 * The time before which a row counts as off the report.
 *
 * `runs` are the import ledger's timestamps. With a full window, it is the
 * MISSING_RUNS-th newest import (less a minute, since a row's stamp is taken
 * a moment before the run is logged). Before the ledger has filled — the first
 * day after this shipped — it falls back to a day before the oldest run.
 */
export function offReportCutoff(runs: string[]): string | null {
  if (runs.length === 0) return null;
  const sorted = [...runs].sort().reverse();
  if (sorted.length >= MISSING_RUNS) {
    return new Date(new Date(sorted[MISSING_RUNS - 1]).getTime() - 60_000).toISOString();
  }
  const oldest = sorted[sorted.length - 1];
  return new Date(new Date(oldest).getTime() - 24 * 3600_000).toISOString();
}

/** When a write-up that entered Job Closed at `since` closes itself. */
export function autoCloseAt(since: string): Date {
  return new Date(new Date(since).getTime() + AUTO_CLOSE_DAYS * 24 * 3600_000);
}

// ── Words and colours for the page ──────────────────────────────────────────

export type StageTone = "red" | "amber" | "sky" | "blue" | "green" | "violet" | "gray";

function shortDay(ymd?: string): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** The tag on a tile. */
export function stageTag(key: StageKey, detail: StageDetail | null): { label: string; tone: StageTone; title: string } {
  const d = detail || {};
  const more = d.openOrders && d.openOrders > 1 ? ` · +${d.openOrders - 1} more` : "";
  const title = d.orderNumber
    ? `rForce order #${d.orderNumber}${d.status ? ` — ${d.status}` : ""}${
        d.openOrders && d.openOrders > 1 ? ` (${d.openOrders} orders still open at this address)` : ""
      }`
    : "";
  switch (key) {
    case "past_due":
      return { label: `Past date (${shortDay(d.date)}) · not complete${more}`, tone: "red", title };
    case "needs_scheduling":
      return { label: `Needs scheduling${more}`, tone: "amber", title };
    case "complete_not_closed":
      return { label: `Complete · not closed in rForce${more}`, tone: "green", title };
    case "waiting_product":
      return { label: `Waiting on product${more}`, tone: "sky", title };
    case "not_started":
      return { label: `${d.status || "Not started"}${more}`, tone: "gray", title };
    case "jip":
      return { label: `Install in progress (JIP)${more}`, tone: "violet", title };
    case "scheduled":
      return { label: `Scheduled ${shortDay(d.date)}${more}`, tone: "blue", title };
    case "legacy":
      return {
        label: "Legacy",
        tone: "gray",
        title: "rForce has never sent this order — it will not close on its own",
      };
    case "job_closed":
      return { label: "All orders closed in rForce", tone: "green", title: "Every rForce order behind this write-up is closed" };
    case "closed_reopened":
      return {
        label: "Orders closed · reopened by hand",
        tone: "gray",
        title: "Auto-closed once and reopened by hand, so it will not auto-close again",
      };
  }
}

/** The Open tab's filter buttons, in the order they show. */
export const STAGE_FILTERS: { key: StageKey; label: string }[] = [
  { key: "past_due", label: "Past date, not complete" },
  { key: "needs_scheduling", label: "Needs scheduling" },
  { key: "complete_not_closed", label: "Complete, not closed" },
  { key: "waiting_product", label: "Waiting on product" },
  { key: "scheduled", label: "Scheduled" },
  { key: "jip", label: "Install in progress (JIP)" },
  { key: "not_started", label: "New / quote / on hold" },
  { key: "legacy", label: "Legacy" },
  { key: "closed_reopened", label: "Reopened by hand" },
];
