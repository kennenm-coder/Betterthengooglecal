import { WorkOrder } from "./types";

export function lastFirst(fullName: string): string {
  if (!fullName) return "";
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return fullName;
  const last = parts[parts.length - 1];
  const first = parts.slice(0, -1).join(" ");
  return `${last}, ${first}`;
}

export function crewName(order: WorkOrder): string {
  return order.primaryResource || order.installer || order.serviceRep || "";
}

/**
 * Every crew on this job — all of them, not just the one rForce exports.
 *
 * Pass the date being rendered to get that day's crews: a helper crew can be on
 * only part of a multi-day install, so day 2 of a three-day job may list two
 * crews while days 1 and 3 list one. Omit the date for the union across the
 * whole job (overview bars, crew groupings, filter options).
 *
 * Falls back to the single rForce resource whenever the scheduling app hasn't
 * published anything for this job, or has nothing for that particular date — so
 * a tile never loses the crew it shows today.
 */
export function crewsForDate(order: WorkOrder, dateStr?: string | null): string[] {
  const map = order.dayCrews;
  if (map) {
    if (dateStr) {
      const forDay = map[dateStr];
      if (forDay && forDay.length > 0) return forDay;
    } else {
      const all = new Set<string>();
      for (const names of Object.values(map)) {
        for (const n of names) if (n) all.add(n);
      }
      if (all.size > 0) return Array.from(all).sort();
    }
  }
  const single = crewName(order);
  return single ? [single] : [];
}

/** "Tue 10/6" — compact enough to list one line per day of a span. */
export function shortDay(iso: string): string {
  // Parsed as local midnight: a bare date string would be read as UTC and slide
  // a day backwards in every timezone west of Greenwich.
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });
}

/** Is this crew on the job — on the given date, or on any day of it? */
export function hasCrew(
  order: WorkOrder,
  crew: string,
  dateStr?: string | null
): boolean {
  return crewsForDate(order, dateStr).includes(crew);
}

export function sortByNameAlpha(orders: WorkOrder[]): WorkOrder[] {
  return [...orders].sort((a, b) =>
    lastFirst(a.customerName).localeCompare(lastFirst(b.customerName))
  );
}

export function sortByStartTime(orders: WorkOrder[]): WorkOrder[] {
  return [...orders].sort((a, b) =>
    (a.scheduledStart || "").localeCompare(b.scheduledStart || "")
  );
}

export function extractCity(address: string): string {
  if (!address) return "";
  const parts = address.split(",");
  if (parts.length >= 2) return parts[1].trim();
  return "";
}

/**
 * Every crew name on these jobs, deduped and sorted — the per-day scheduling
 * crews plus all three raw rForce fields, so a helper crew or a service rep
 * who only ever appears in one of them still makes the list. Used wherever a
 * field manager picks from "everyone who shows up on the calendar" (the
 * write-up crew picker): the scheduling roster itself is not readable by
 * field logins, but the jobs they already have cached are.
 *
 * "Keith Morris" and "keith morris" are one person, so names fold on case and
 * whitespace; the first spelling seen is the one kept.
 */
export function allCrewNames(orders: WorkOrder[]): string[] {
  const seen = new Map<string, string>();
  const add = (raw: string | null | undefined) => {
    const name = (raw || "").trim();
    if (!name) return;
    const key = name.toLowerCase().replace(/\s+/g, " ");
    if (!seen.has(key)) seen.set(key, name);
  };
  for (const o of orders) {
    for (const n of crewsForDate(o)) add(n);
    add(o.primaryResource);
    add(o.installer);
    add(o.serviceRep);
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}
