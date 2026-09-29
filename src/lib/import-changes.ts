/**
 * Turns raw import-log entries into something a human reads.
 *
 * The log is written per upload, but nobody thinks in uploads — they think
 * "what happened to my jobs today". These helpers fold every upload in the
 * retention window into one row per job, showing the NET before/after: if a
 * job moved at 9am and moved again at 3pm, you see one line from where it
 * started to where it ended up, and a job that moved out and back disappears.
 */

import {
  ChangeKind,
  ImportLogEntry,
  ImportLogFieldChange,
} from "./import-log";
import { format, isSameDay, parseISO } from "date-fns";

/** Placeholder the server writes for an empty value. */
const EMPTY = "—";

/** One job's net change across every upload in the window. */
export interface JobChange {
  /** Work order number, or the customer name when the WO# is blank. */
  key: string;
  workOrderNumber: string;
  customerName: string;
  action: "added" | "updated";
  /** Net field changes, oldest `from` → newest `to`. */
  changes: ImportLogFieldChange[];
  kinds: ChangeKind[];
  /** Most recent scheduled start we saw for the job. */
  scheduledStart: string | null;
  /** Timestamp of the last upload that touched it. */
  lastAt: string;
  /** How many uploads touched it inside the window. */
  touches: number;
}

/** Change kinds for rows written before kinds were stored. */
const LEGACY_KIND: Record<string, ChangeKind> = {
  "Scheduled Start": "schedule",
  "Scheduled End": "schedule",
  Status: "status",
  "Appt Status": "status",
  Installer: "crew",
  Resource: "crew",
  "Service Rep": "crew",
  "Tech Measure": "crew",
  Address: "address",
};

export function kindOf(c: ImportLogFieldChange): ChangeKind {
  return c.kind ?? LEGACY_KIND[c.field] ?? (c.isDate ? "schedule" : "status");
}

/**
 * True for a job that has no date on it and never did inside this window —
 * not field work anyone is tracking. A job that WAS scheduled and got taken
 * off the schedule is the opposite: it has no date now, but the unscheduling
 * itself is recorded as a Scheduled Start change, which is exactly the thing
 * a field manager needs to see.
 *
 * The upload side already applies this rule, so it only bites on entries
 * written before the rule existed and still inside the retention window.
 */
function isOffSchedule(job: Pick<JobChange, "scheduledStart" | "changes">): boolean {
  if (job.scheduledStart) return false;
  return !job.changes.some((c) => c.field === "Scheduled Start");
}

/** Fold every entry into one row per job, newest-touched first. */
export function mergeJobChanges(entries: ImportLogEntry[]): JobChange[] {
  // Oldest first, so `from` keeps the earliest value and `lastAt` ends up on
  // the most recent upload that touched the job.
  const ordered = [...entries].sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  );

  const byJob = new Map<
    string,
    { job: Omit<JobChange, "changes" | "kinds">; fields: Map<string, ImportLogFieldChange> }
  >();

  for (const entry of ordered) {
    for (const o of entry.orders ?? []) {
      const key = o.workOrderNumber || o.customerName;
      if (!key) continue;

      let rec = byJob.get(key);
      if (!rec) {
        rec = {
          job: {
            key,
            workOrderNumber: o.workOrderNumber,
            customerName: o.customerName,
            action: o.action,
            scheduledStart: o.scheduledStart,
            lastAt: entry.created_at,
            touches: 0,
          },
          fields: new Map(),
        };
        byJob.set(key, rec);
      }

      rec.job.touches++;
      rec.job.lastAt = entry.created_at;
      rec.job.scheduledStart = o.scheduledStart;
      if (o.customerName) rec.job.customerName = o.customerName;
      // A job that arrived inside the window still reads as "new", even if it
      // was edited afterwards.
      if (o.action === "added") rec.job.action = "added";

      for (const c of o.changes ?? []) {
        const prev = rec.fields.get(c.field);
        if (prev) prev.to = c.to;
        else rec.fields.set(c.field, { ...c });
      }
    }
  }

  const out: JobChange[] = [];
  for (const { job, fields } of byJob.values()) {
    // A field that ended where it began is not a change worth reading.
    const changes = Array.from(fields.values()).filter((c) => c.from !== c.to);
    if (job.action !== "added" && changes.length === 0) continue;
    if (isOffSchedule({ ...job, changes })) continue;
    const kinds = Array.from(new Set(changes.map(kindOf)));
    out.push({ ...job, changes, kinds });
  }

  out.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return out;
}

/** One rendered change, phrased the way a person would say it. */
export interface ChangeLine {
  kind: ChangeKind;
  /** What changed, e.g. "Moved", "Installer". */
  label: string;
  /** Previous value — omitted when the line needs no arrow. */
  from?: string;
  /** Current value. */
  to: string;
}

function dt(v: string): string {
  try {
    return format(parseISO(v), "EEE MMM d, h:mm a");
  } catch {
    return v;
  }
}

function tm(v: string): string {
  try {
    return format(parseISO(v), "h:mm a");
  } catch {
    return v;
  }
}

function dayOf(v: string): Date | null {
  try {
    const d = parseISO(v);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/** "—" reads as a hole in a table; in a sentence it should say "none". */
function human(v: string): string {
  return v === EMPTY ? "none" : v;
}

/**
 * Build the display lines for a job. Scheduled Start and Scheduled End collapse
 * into a single line — a move shifts both, and nobody needs to read it twice.
 */
export function buildChangeLines(job: JobChange): ChangeLine[] {
  const lines: ChangeLine[] = [];
  const byField = new Map(job.changes.map((c) => [c.field, c]));
  const start = byField.get("Scheduled Start");
  const end = byField.get("Scheduled End");

  if (job.action === "added") {
    lines.push({
      kind: "schedule",
      label: "New job",
      to: job.scheduledStart ? dt(job.scheduledStart) : "not scheduled",
    });
  }

  if (start) {
    if (start.to === EMPTY) {
      lines.push({ kind: "schedule", label: "Unscheduled", to: `was ${dt(start.from)}` });
    } else if (start.from === EMPTY) {
      lines.push({ kind: "schedule", label: "Scheduled", to: dt(start.to) });
    } else {
      const a = dayOf(start.from);
      const b = dayOf(start.to);
      if (a && b && isSameDay(a, b)) {
        lines.push({
          kind: "schedule",
          label: "Time changed",
          from: dt(start.from),
          to: tm(start.to),
        });
      } else {
        lines.push({
          kind: "schedule",
          label: "Moved",
          from: dt(start.from),
          to: dt(start.to),
        });
      }
    }
  } else if (end) {
    lines.push({ kind: "schedule", label: "End time", from: tm(end.from), to: tm(end.to) });
  }

  for (const c of job.changes) {
    if (c.field === "Scheduled Start" || c.field === "Scheduled End") continue;
    lines.push({ kind: kindOf(c), label: c.field, from: human(c.from), to: human(c.to) });
  }

  return lines;
}

/** Filter buckets shown as chips above the list. */
export type ChangeFilter = "new" | ChangeKind;

export const FILTER_LABELS: Record<ChangeFilter, string> = {
  new: "New",
  schedule: "Moved",
  crew: "Crew",
  status: "Status",
  address: "Address",
};

export const FILTER_ORDER: ChangeFilter[] = ["new", "schedule", "crew", "status", "address"];

export function matchesFilter(job: JobChange, filter: ChangeFilter): boolean {
  if (filter === "new") return job.action === "added";
  return job.kinds.includes(filter);
}

/** Does this job match a free-text search of name or work order number? */
export function matchesQuery(job: JobChange, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    job.customerName.toLowerCase().includes(q) ||
    job.workOrderNumber.toLowerCase().includes(q)
  );
}
