// Is a write-up JIP or Service work? Decided HERE, once, and stored on the
// write-up (field_work_orders.writeup_kind, migration 053) so the other apps
// read the answer instead of working it out again. The paint & stain shop's
// Work Tracker in the material-list maker ticks its "JIP / Service" box from it.
//
// Kennen's rule (2026-11-12):
//
//   1. Find the job's install date: its Install work order in work_orders —
//      the last day it is scheduled for (a two-day install ends on day two).
//   2. If the FIRST write-up on the job was made more than JIP_WINDOW_DAYS
//      after the install, it is Service — and so is every later one.
//   3. If the first write-up falls within JIP_WINDOW_DAYS (or before the
//      install has even happened), it and every later write-up are JIP until
//      the job reaches closed. A write-up made after that is Service.
//
// "The job reached closed" is the calendar's own Job Closed (writeup-stage.ts):
//   - job_closed_since on any of the job's write-ups (the import's clock), or
//   - auto_closed_at less AUTO_CLOSE_DAYS (the clock is cleared when the import
//     closes the write-up, but the close is stamped exactly that long after it), or
//   - the job's own rForce order dropping off the report — the import's
//     definition of closed — at the last import that still carried it. This one
//     matters when every write-up on the job had been closed by hand before
//     rForce closed the job, so nothing stamped a clock.
//
// A write-up is one SUBMISSION (batch_id): every unit row in it gets the same
// answer, dated by its earliest row. Drafts are not write-ups yet and are
// skipped. Archived ones were still made, so they still count as "the first".
//
// An answer is never changed once stored — it is the record of what the work
// was when it was written up, like the install document. No install date on
// file means no answer (null), and the shop's box stays blank rather than
// guessed; the next import tries again.
//
// Pure (no database), so the hourly import, the submit-time stamp and
// scripts/checks/writeup-kind.check.ts all run the same rules.

import { AUTO_CLOSE_DAYS, ohioDay, type OrderRow } from "./writeup-stage";

/** Days after the install a first write-up still counts as JIP. */
export const JIP_WINDOW_DAYS = 30;

export type WriteUpKind = "jip" | "service";

export type KindRule =
  /** First write-up within the window, job not closed when this one was made. */
  | "within_window"
  /** The install has not happened yet (no date on it, not complete). */
  | "before_install"
  /** The first write-up on the job came more than the window after install. */
  | "first_after_window"
  /** Made after the job reached closed. */
  | "after_job_closed";

export interface KindDetail {
  rule: KindRule;
  /** YYYY-MM-DD (Ohio): the install's last scheduled day. */
  installDay?: string;
  /** YYYY-MM-DD (Ohio): when the job's first write-up was made. */
  firstWriteUpDay?: string;
  /** Days from the install to the first write-up (negative = before it). */
  daysAfterInstall?: number;
  /** YYYY-MM-DD (Ohio): when the job reached closed, if it has. */
  jobClosedDay?: string;
}

export interface KindDecision {
  kind: WriteUpKind;
  detail: KindDetail;
}

/** The columns of a field_work_orders row the rule reads. */
export interface KindWriteUpRow {
  id: string;
  batch_id: string | null;
  created_at: string;
  status: string;
  job_closed_since?: string | null;
  auto_closed_at?: string | null;
}

const INSTALL_DONE = new Set(["Install Complete", "Job Closed", "Appt Complete / Closed"]);

/** Whole days from one YYYY-MM-DD to another. */
export function daysBetween(fromYmd: string, toYmd: string): number {
  const [y1, m1, d1] = fromYmd.split("-").map(Number);
  const [y2, m2, d2] = toYmd.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/**
 * The job's install, from its own work_orders rows.
 *   dated   — the last day an Install appointment is scheduled for
 *   not_yet — there is an Install order but no date, and it is not complete:
 *             the install has not happened, so any write-up is before it
 *   unknown — no Install order on file, or one marked complete with no date
 */
export function installOf(ownRows: OrderRow[]): { state: "dated" | "not_yet" | "unknown"; day?: string } {
  let rows = ownRows.filter((r) => (r.work_order_type || "").trim() === "Install");
  // An order typed oddly still says "Install …" in its status.
  if (rows.length === 0) rows = ownRows.filter((r) => /^install\b/i.test((r.status || "").trim()));
  if (rows.length === 0) return { state: "unknown" };
  const days = rows
    .map((r) => r.scheduled_start)
    .filter((s): s is string => !!s)
    .map(ohioDay)
    .sort();
  if (days.length) return { state: "dated", day: days[days.length - 1] };
  const done = rows.some((r) => INSTALL_DONE.has((r.status || "").trim()));
  return done ? { state: "unknown" } : { state: "not_yet" };
}

/**
 * When the job reached closed, as an ISO time, or null while it is open.
 * `cutoff` is the import's off-report line (offReportCutoff); without one the
 * rForce signal is not judged.
 */
export function jobClosedAt(ownRows: OrderRow[], writeUps: KindWriteUpRow[], cutoff: string | null): string | null {
  const times: string[] = [];
  for (const w of writeUps) {
    if (w.job_closed_since) times.push(new Date(w.job_closed_since).toISOString());
    if (w.auto_closed_at) {
      times.push(new Date(new Date(w.auto_closed_at).getTime() - AUTO_CLOSE_DAYS * 86_400_000).toISOString());
    }
  }
  if (cutoff && ownRows.length) {
    const lastSeen = ownRows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), "");
    if (lastSeen && lastSeen < cutoff) times.push(new Date(lastSeen).toISOString());
  }
  return times.length ? times.sort()[0] : null;
}

/** The key a write-up submission goes by: its batch, else the lone row. */
export function batchKeyOf(w: KindWriteUpRow): string {
  return w.batch_id || `row:${w.id}`;
}

/**
 * Decide every write-up submission on ONE job.
 *
 * Returns a map from batch key (batchKeyOf) to the decision, or to null when
 * there is no install date to judge by. Drafts get no entry.
 */
export function decideWriteUpKinds(input: {
  /** Every work_orders row carrying the job's order number. */
  ownRows: OrderRow[];
  /** Every field_work_orders row on the job (drafts are skipped here). */
  writeUps: KindWriteUpRow[];
  cutoff: string | null;
}): Map<string, KindDecision | null> {
  const out = new Map<string, KindDecision | null>();
  const real = input.writeUps.filter((w) => w.status !== "draft" && w.created_at);

  const madeAt = new Map<string, string>();
  for (const w of real) {
    const k = batchKeyOf(w);
    const t = new Date(w.created_at).toISOString();
    const prev = madeAt.get(k);
    if (!prev || t < prev) madeAt.set(k, t);
  }
  const batches = [...madeAt.entries()].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  if (batches.length === 0) return out;

  const install = installOf(input.ownRows);
  if (install.state === "unknown") {
    for (const [k] of batches) out.set(k, null);
    return out;
  }

  const firstDay = ohioDay(batches[0][1]);
  const base: KindDetail = { rule: "within_window", firstWriteUpDay: firstDay };
  if (install.state === "dated" && install.day) {
    base.installDay = install.day;
    base.daysAfterInstall = daysBetween(install.day, firstDay);
  }

  if (base.daysAfterInstall != null && base.daysAfterInstall > JIP_WINDOW_DAYS) {
    for (const [k] of batches) out.set(k, { kind: "service", detail: { ...base, rule: "first_after_window" } });
    return out;
  }

  const closedAt = jobClosedAt(input.ownRows, input.writeUps, input.cutoff);
  const closedDetail = closedAt ? { jobClosedDay: ohioDay(closedAt) } : {};
  const openRule: KindRule = install.state === "not_yet" ? "before_install" : "within_window";
  for (const [k, at] of batches) {
    if (closedAt && at >= closedAt) {
      out.set(k, { kind: "service", detail: { ...base, ...closedDetail, rule: "after_job_closed" } });
    } else {
      out.set(k, { kind: "jip", detail: { ...base, rule: openRule } });
    }
  }
  return out;
}

/** One line saying why, for a tooltip or the office. */
export function writeUpKindReason(kind: WriteUpKind, d: KindDetail | null): string {
  const detail = d || ({ rule: kind === "jip" ? "within_window" : "first_after_window" } as KindDetail);
  const days = detail.daysAfterInstall;
  switch (detail.rule) {
    case "before_install":
      return "JIP: written up before the install happened";
    case "within_window":
      return `JIP: the first write-up came ${days ?? "?"} day${days === 1 ? "" : "s"} after the install (within ${JIP_WINDOW_DAYS}), and the job was still open`;
    case "first_after_window":
      return `Service: the first write-up came ${days ?? "?"} days after the install (more than ${JIP_WINDOW_DAYS})`;
    case "after_job_closed":
      return `Service: written up after the job closed${detail.jobClosedDay ? ` (${detail.jobClosedDay})` : ""}`;
  }
}
