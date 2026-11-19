// ─── Job Alert date rules (shared by the job card and the daily cron) ──────
//
// Two buzzes per appointment, to every field manager and admin (Kennen,
// 2026-11-19): 5 business days before, and the business day before. Weekends
// are skipped both ways — a Monday job buzzes the Monday before and the Friday
// before. Holidays are NOT skipped.
//
// All dates are plain "YYYY-MM-DD" strings in the office's local calendar
// (Eastern). Work orders store scheduled_start as a local time with no zone
// ("2026-11-24 08:00:00"), so the appointment's date is its first 10
// characters — no time-zone conversion anywhere, by design.

const OFFICE_TZ = "America/New_York";

export type JobAlertStage = "five" | "one";
export const STAGE_DAYS: Record<JobAlertStage, number> = { five: 5, one: 1 };

/** "2026-11-24T08:00:00" → "2026-11-24" (null when there's no appointment). */
export function appointmentDate(scheduledStart: string | null | undefined): string | null {
  return scheduledStart && /^\d{4}-\d{2}-\d{2}/.test(scheduledStart) ? scheduledStart.slice(0, 10) : null;
}

/** Today's date at the office, whatever time zone the server or phone is in. */
export function todayAtOffice(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: OFFICE_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function toUtc(d: string): Date {
  return new Date(`${d}T00:00:00Z`);
}
function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/** `count` business days before `date` (Saturday and Sunday skipped). */
export function workdaysBefore(date: string, count: number): string {
  const d = toUtc(date);
  let left = count;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (!isWeekend(d)) left -= 1;
  }
  return fromUtc(d);
}

/** The first weekday after `date` — the next morning the cron runs. */
export function nextWeekday(date: string): string {
  const d = toUtc(date);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (isWeekend(d));
  return fromUtc(d);
}

/** "Mon, Nov 24" */
export function shortDay(date: string): string {
  return toUtc(date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Which buzz (if any) is due this morning for a note. The day-before buzz
 * wins once its day comes — a note written late doesn't get both at once.
 * Nothing for a passed appointment, or a buzz already sent for this date.
 */
export function dueStage(
  appt: string | null,
  sent5For: string | null,
  sent1For: string | null,
  today: string
): JobAlertStage | null {
  if (!appt || appt < today) return null;
  if (today >= workdaysBefore(appt, 1)) return sent1For === appt ? null : "one";
  if (today >= workdaysBefore(appt, 5)) return sent5For === appt ? null : "five";
  return null;
}

/** What the job card says about the buzzes for this appointment. */
export function reminderStatus(
  appt: string | null,
  sent5For: string | null,
  sent1For: string | null,
  today = todayAtOffice()
): string {
  if (!appt) return "No appointment date yet. Field managers get buzzed once one is set.";
  if (appt < today) return "This appointment has passed.";
  const five = workdaysBefore(appt, 5);
  const one = workdaysBefore(appt, 1);
  if (sent1For === appt) return "Both buzzes have gone out to field managers.";
  const soon = shortDay(nextWeekday(today));
  if (today >= one) return `Day-before buzz goes to all field managers ${soon} morning.`;
  if (sent5For === appt) return `5-day buzz sent. Day-before buzz ${shortDay(one)} morning.`;
  if (today >= five) return `Buzzes all field managers ${soon} morning, and again ${shortDay(one)} (day before).`;
  return `Buzzes all field managers ${shortDay(five)} (5 business days before) and ${shortDay(one)} (day before).`;
}
