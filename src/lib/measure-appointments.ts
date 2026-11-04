// The measure tech's own list: Tech Measure work orders assigned to them.
//
// Pure on purpose, and it imports NOTHING — no Supabase, no React, no `@/` alias,
// no date-fns. scripts/check-measure-appointments.mjs loads this file straight
// into node, so everything the screen decides (who a row belongs to, which
// bucket it lands in, whether a link is safe to draw) is checked without a
// browser, a login or a database. The query lives in measure-appointments-store.ts.
//
// HOW A TECH IS IDENTIFIED. There is no id link between a login and a work order.
// rForce writes the assigned tech as FREE TEXT — `work_orders.tech_measure`
// ("Primary Tech Measure Name") and, on the appointment itself, `primary_resource`
// — and the only name a login carries is `allowed_emails.name`, which an admin
// types on the Team page. So the match is the person's name, compared with case
// and spacing folded away and nothing cleverer. A tech whose Team-page name does
// not spell out the rForce name sees an empty list (and the screen says whose
// name it looked for), never somebody else's.

/** rForce's own name for a measure appointment, matched exactly. */
export const MEASURE_WORK_ORDER_TYPE = "Tech Measure";

/**
 * How far back "Date passed, still open" looks. A measure nobody ever closed in
 * rForce would otherwise sit in the list for ever; past this it is old news for
 * the office, not a task for the tech. Also keeps the query bounded.
 */
export const MEASURE_LOOKBACK_DAYS = 90;

/** One PostgREST page. A bound on principle: an unbounded select over a shared table. */
export const MEASURE_MAX_ROWS = 1000;

export interface MeasureAppointment {
  id: string;
  orderNumber: string;
  workOrderNumber: string;
  customerName: string;
  address: string;
  /** Local wall-clock ISO ("2026-11-05T08:00:00"), no zone — as the calendar keeps it. */
  scheduledStart: string | null;
  appointmentStatus: string;
  /** Workflow status; rForce also puts odd things here, so it is only ever searched, never shown on its own. */
  status: string;
  /** The assigned tech, free text from rForce. */
  techMeasure: string;
  /** The resource booked on this appointment, free text from rForce. */
  primaryResource: string;
}

/** The columns the query selects, as they come back (all nullable). */
export interface MeasureRow {
  id?: string | null;
  order_number?: string | null;
  work_order_number?: string | null;
  customer_name?: string | null;
  contact_name?: string | null;
  account_name?: string | null;
  address?: string | null;
  appointment_status?: string | null;
  status?: string | null;
  scheduled_start?: string | null;
  tech_measure?: string | null;
  primary_resource?: string | null;
}

// ─── Rows ────────────────────────────────────────────────────────────────────

/** Same rule as store.ts: the timestamps are wall-clock stored as UTC, so the zone is noise. */
function stripZone(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return iso.replace(/Z$/, "").replace(/[+-]\d{2}:\d{2}$/, "");
}

export function toMeasureAppointment(row: MeasureRow): MeasureAppointment {
  const workOrderNumber = (row.work_order_number ?? "").trim();
  return {
    id: String(row.id ?? workOrderNumber ?? ""),
    orderNumber: (row.order_number ?? "").trim(),
    workOrderNumber,
    // Same fallbacks TrimGauge uses for the same table.
    customerName: (row.customer_name || row.contact_name || row.account_name || "").trim(),
    address: (row.address ?? "").trim(),
    scheduledStart: stripZone(row.scheduled_start),
    appointmentStatus: (row.appointment_status ?? "").trim(),
    status: (row.status ?? "").trim(),
    techMeasure: (row.tech_measure ?? "").trim(),
    primaryResource: (row.primary_resource ?? "").trim(),
  };
}

// ─── Who it belongs to ───────────────────────────────────────────────────────

/**
 * A name reduced to what two spellings of the same person share: no accents, no
 * curly quotes, one space between words, lower case. Two different people never
 * collide under this, so folding only ever reunites a tech with their own row.
 */
export function foldName(name: string | null | undefined): string {
  return (name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Is this appointment assigned to the person called `myName`?
 *
 * Every name the appointment carries is checked, not just one: rForce leaves
 * `tech_measure` blank on some rows that plainly have a tech, and the booked
 * resource is the other place the same person turns up. Whole-name equality
 * only — "Nate" does not match "Nate Sattler", and neither does a surname.
 *
 * A blank name matches NOTHING (fail closed). It must never read as "no filter".
 */
export function isAssignedTo(a: Pick<MeasureAppointment, "techMeasure" | "primaryResource">, myName: string): boolean {
  const mine = foldName(myName);
  if (!mine) return false;
  return foldName(a.techMeasure) === mine || foldName(a.primaryResource) === mine;
}

export function filterAssignedTo<T extends Pick<MeasureAppointment, "techMeasure" | "primaryResource">>(
  list: T[],
  myName: string
): T[] {
  return list.filter((a) => isAssignedTo(a, myName));
}

/**
 * The one word of a name to narrow the DATABASE query with, so a tech's screen
 * does not pull every tech's rows just to throw most of them away. The longest
 * word, cleaned of anything that would break a PostgREST filter. The exact
 * match above still decides what is shown; this only bounds what is fetched.
 */
export function nameSearchToken(name: string | null | undefined): string {
  const words = foldName(name)
    .split(" ")
    .map((w) => w.replace(/[^a-z0-9'-]/g, ""))
    .filter(Boolean);
  if (!words.length) return "";
  return words.reduce((best, w) => (w.length > best.length ? w : best), "");
}

// ─── Status ──────────────────────────────────────────────────────────────────

/**
 * Cancelled, by any spelling. Both status columns are rForce free text with no
 * list of values to check against ("Cancelled", "Canceled", "Cancel Pending"),
 * so it is a pattern — the same one TrimGauge applies to the same table.
 */
export function isCancelled(a: Pick<MeasureAppointment, "status" | "appointmentStatus">): boolean {
  return /cancel/i.test(`${a.status} ${a.appointmentStatus}`);
}

/** Done: "Appt Complete / Closed" and its relatives. */
export function isClosed(a: Pick<MeasureAppointment, "status" | "appointmentStatus">): boolean {
  return /complete|closed/i.test(`${a.status} ${a.appointmentStatus}`);
}

// ─── Dates ───────────────────────────────────────────────────────────────────

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A local calendar day as YYYY-MM-DD. Local, not UTC: an 8 am measure is still today's at 11 pm UTC. */
export function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The last day of the calendar's week. The calendar's weeks run Sunday to Saturday (weekStartsOn: 0). */
export function weekEndKey(now: Date): string {
  return dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + (6 - now.getDay())));
}

/** Where the query starts looking: midnight, MEASURE_LOOKBACK_DAYS ago, in the calendar's own timestamp shape. */
export function measureLookbackStart(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - MEASURE_LOOKBACK_DAYS);
  return `${dayKey(d)}T00:00:00`;
}

/** Whole days from `later` back to `earlier`, both YYYY-MM-DD. Calendar days, so daylight saving cannot skew it. */
function daysBetween(earlier: string, later: string): number {
  const [ay, am, ad] = earlier.split("-").map(Number);
  const [by, bm, bd] = later.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** How many days ago the appointment was (0 for today, negative for the future); null when it has no date. */
export function daysAgo(a: Pick<MeasureAppointment, "scheduledStart">, now: Date): number | null {
  const day = a.scheduledStart ? a.scheduledStart.slice(0, 10) : "";
  if (!DAY_RE.test(day)) return null;
  return daysBetween(day, dayKey(now));
}

// ─── Grouping ────────────────────────────────────────────────────────────────

export type MeasureGroupKey = "today" | "week" | "later" | "overdue" | "unscheduled";

/** The order they are drawn in. */
export const MEASURE_GROUP_ORDER: MeasureGroupKey[] = ["today", "week", "later", "overdue", "unscheduled"];

export const MEASURE_GROUP_LABELS: Record<MeasureGroupKey, string> = {
  today: "Today",
  week: "This week",
  later: "Later",
  overdue: "Date passed, still open",
  unscheduled: "Not scheduled yet",
};

export interface MeasureGroup {
  key: MeasureGroupKey;
  label: string;
  items: MeasureAppointment[];
}

/**
 * Which bucket an appointment belongs in, or null when it does not belong on
 * the list at all.
 *
 *   cancelled                          → never listed
 *   no date, still open                → "Not scheduled yet"   (To be Scheduled)
 *   an earlier day, still open         → "Date passed, still open"
 *   an earlier day, closed             → not listed (it happened and was closed)
 *   today                              → "Today"   (even if already closed: it shows what got done)
 *   after today, up to Saturday        → "This week"
 *   anything later                     → "Later"
 */
export function classifyMeasure(a: MeasureAppointment, now: Date): MeasureGroupKey | null {
  if (isCancelled(a)) return null;
  const closed = isClosed(a);
  const day = a.scheduledStart ? a.scheduledStart.slice(0, 10) : "";
  if (!DAY_RE.test(day)) return closed ? null : "unscheduled";
  const today = dayKey(now);
  if (day < today) return closed ? null : "overdue";
  if (day === today) return "today";
  if (day <= weekEndKey(now)) return "week";
  return "later";
}

function compareAppointments(a: MeasureAppointment, b: MeasureAppointment): number {
  return (
    (a.scheduledStart ?? "9999").localeCompare(b.scheduledStart ?? "9999") ||
    a.customerName.localeCompare(b.customerName) ||
    a.orderNumber.localeCompare(b.orderNumber) ||
    a.id.localeCompare(b.id)
  );
}

/** Sorted into the groups above, soonest first inside each. Empty groups are left out. */
export function groupMeasureAppointments(list: MeasureAppointment[], now: Date): MeasureGroup[] {
  const buckets = new Map<MeasureGroupKey, MeasureAppointment[]>();
  for (const a of list) {
    const key = classifyMeasure(a, now);
    if (!key) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(a);
    else buckets.set(key, [a]);
  }
  return MEASURE_GROUP_ORDER.filter((k) => buckets.has(k)).map((k) => ({
    key: k,
    label: MEASURE_GROUP_LABELS[k],
    items: buckets.get(k)!.sort(compareAppointments),
  }));
}

// ─── Links ───────────────────────────────────────────────────────────────────

/** Google Maps on the web — opens the handset's maps app where one is registered, works everywhere else. */
export function mapsUrl(address: string): string | null {
  const a = address.trim();
  return a ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a)}` : null;
}

/**
 * Where "Open in Measure Tools" points: TrimGauge, the measuring app. The
 * calendar never had a setting for it, so this is the one — an absolute http(s)
 * address in NEXT_PUBLIC_TRIMGAUGE_URL (inlined at build time). Unset, blank or
 * not a web address returns null and the link is simply not drawn.
 *
 * TrimGauge has no per-job deep link yet, so this opens its front page.
 */
export function measureToolsUrl(raw: string | null | undefined = process.env.NEXT_PUBLIC_TRIMGAUGE_URL): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}
