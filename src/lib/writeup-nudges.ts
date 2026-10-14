// Lifecycle nudges for write-ups: the rules that decide which write-ups the
// Write-Ups page should push to the top and ask about, so old ones work their
// way through to archived instead of piling up.
//
//   closed 3+ months  → "Should this be archived?"   (frees up its photos)
//   open   6+ months  → "Does this still need to be open?"
//
// Answering "not yet" snoozes the question for SNOOZE_MONTHS; it then asks
// again. Any status change clears the snooze (see updateWriteUpStatus).
//
// A third, softer flag — a submitted write-up with no crew picked — is not a
// question, just a count at the top of the page that disappears at zero.

import { addMonths, isBefore, parseISO, subMonths } from "date-fns";
import type { WriteUpSection } from "./writeup-sections";

export type Nudge = "archive" | "close";

export const ARCHIVE_AFTER_MONTHS = 3;
export const CLOSE_AFTER_MONTHS = 6;
export const SNOOZE_MONTHS = 3;

function olderThan(iso: string | null | undefined, months: number, now: Date): boolean {
  if (!iso) return false;
  const d = parseISO(iso);
  if (Number.isNaN(d.getTime())) return false;
  return isBefore(d, subMonths(now, months));
}

function snoozed(section: WriteUpSection, now: Date): boolean {
  const until = section.nudgeSnoozedUntil;
  if (!until) return false;
  const d = parseISO(until);
  return !Number.isNaN(d.getTime()) && isBefore(now, d);
}

/** Which question, if any, this write-up should be asking right now. */
export function nudgeFor(section: WriteUpSection, now: Date = new Date()): Nudge | null {
  if (snoozed(section, now)) return null;
  if (section.status === "closed") {
    // Rows closed before closed_at existed fall back to their last update.
    return olderThan(section.closedAt || section.lastTouchedAt, ARCHIVE_AFTER_MONTHS, now) ? "archive" : null;
  }
  if (section.status === "open") {
    return olderThan(section.createdAt, CLOSE_AFTER_MONTHS, now) ? "close" : null;
  }
  return null;
}

/** Submitted and still in play, but nobody has said who could do the work. */
export function needsCrew(section: WriteUpSection): boolean {
  if (section.status !== "in_review" && section.status !== "open") return false;
  return !section.rows.some((r) => r.suggestedCrews.length > 0);
}

/** When a "not yet" answer should stop holding the question back. */
export function snoozeUntil(now: Date = new Date()): string {
  return addMonths(now, SNOOZE_MONTHS).toISOString();
}
