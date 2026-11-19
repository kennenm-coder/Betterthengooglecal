// ─── Job Alert date rules (shared by the job card and the daily cron) ──────
//
// All dates are plain "YYYY-MM-DD" strings in the office's local calendar
// (Eastern). Work orders store scheduled_start as a local time with no zone
// ("2026-11-24T08:00:00"), so the appointment's date is just its first 10
// characters — no time-zone conversion anywhere, by design.

export const WORKDAYS_BEFORE = 5;
const OFFICE_TZ = "America/New_York";

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

/**
 * The reminder day: `count` workdays before the appointment, skipping Saturday
 * and Sunday (holidays are NOT skipped, by decision). Five workdays before a
 * Monday is the Monday before; before a Wednesday, the Wednesday before.
 */
export function workdaysBefore(date: string, count = WORKDAYS_BEFORE): string {
  const d = toUtc(date);
  let left = count;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (!isWeekend(d)) left -= 1;
  }
  return fromUtc(d);
}

/** The first weekday after `date` — when a late note's reminder goes out. */
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
 * Should the cron send this reminder this morning? Yes once the reminder day
 * has come (or passed — a note written inside the 5-day window goes the next
 * morning), as long as the appointment hasn't passed and this appointment
 * date hasn't already been reminded.
 */
export function isDue(appt: string | null, sentForDate: string | null, today: string): boolean {
  if (!appt || appt < today) return false;
  if (sentForDate === appt) return false;
  return today >= workdaysBefore(appt);
}

/** What the job card says about when the reminder goes out. */
export function reminderStatus(appt: string | null, sentAt: string | null, sentForDate: string | null, today = todayAtOffice()): string {
  if (!appt) return "No appointment date yet. It'll remind you 5 workdays before one is set.";
  if (sentForDate === appt && sentAt) return `Reminder sent ${shortDay(sentAt.slice(0, 10))}.`;
  if (appt < today) return "This appointment has passed.";
  const day = workdaysBefore(appt);
  if (day > today) return `Emails you ${shortDay(day)} morning (5 workdays before ${shortDay(appt)}).`;
  return `Less than 5 workdays away. Emails you ${shortDay(nextWeekday(today))} morning.`;
}
