// ─── Notification schedule: quiet hours and days off ────────────────────────
//
// Each person can say, per day of the week, when their phone should NOT be
// buzzed (migration 070). Used by notify() on the server to hold back buzzes,
// and by the schedule editor (Settings, and the Chat tab's menu) to draw and
// describe it. No server or browser-only imports, so both sides can use it.
//
// A day is one of:
//   on     buzz any time
//   quiet  no buzzes from `from` to `to`. If `to` is earlier than `from` it
//          runs overnight into the next morning (9pm-7am).
//   off    no buzzes at all that day
//
// Quiet time only stops the BUZZ. Whatever normally lands in the bell still
// does, so nothing is lost.

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type DayMode = "on" | "quiet" | "off";

export interface DaySetting {
  mode: DayMode;
  /** "HH:MM", 24-hour. */
  from: string;
  /** "HH:MM", 24-hour. Earlier than `from` = runs past midnight. */
  to: string;
}

export type Schedule = Record<DayKey, DaySetting>;

export const DAY_KEYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const DAY_LABELS: Record<DayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export const OFFICE_TIMEZONE = "America/New_York";

const DEFAULT_DAY: DaySetting = { mode: "on", from: "21:00", to: "07:00" };

export function defaultSchedule(): Schedule {
  return Object.fromEntries(DAY_KEYS.map((d) => [d, { ...DEFAULT_DAY }])) as Schedule;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Anything stored or sent becomes a complete, valid schedule. */
export function normalizeSchedule(raw: unknown): Schedule {
  const out = defaultSchedule();
  if (!raw || typeof raw !== "object") return out;
  for (const d of DAY_KEYS) {
    const v = (raw as Record<string, unknown>)[d];
    if (!v || typeof v !== "object") continue;
    const { mode, from, to } = v as Record<string, unknown>;
    out[d] = {
      mode: mode === "quiet" || mode === "off" ? mode : "on",
      from: typeof from === "string" && TIME_RE.test(from) ? from : DEFAULT_DAY.from,
      to: typeof to === "string" && TIME_RE.test(to) ? to : DEFAULT_DAY.to,
    };
  }
  return out;
}

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Weekday and minutes-past-midnight for `at`, in the person's time zone. */
function localNow(at: Date, timezone: string): { day: DayKey; mins: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: isValidTimezone(timezone) ? timezone : OFFICE_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = get("weekday").toLowerCase().slice(0, 3) as DayKey;
  const hour = Number(get("hour")) % 24; // some engines say "24" for midnight
  return { day: DAY_KEYS.includes(day) ? day : "mon", mins: hour * 60 + Number(get("minute")) };
}

/** Is this person in quiet time (or a day off) at `at`? */
export function isQuietAt(schedule: Schedule, timezone: string, at: Date = new Date()): boolean {
  const { day, mins } = localNow(at, timezone);
  const today = schedule[day];
  if (today.mode === "off") return true;

  if (today.mode === "quiet") {
    const from = minutes(today.from);
    const to = minutes(today.to);
    if (from === to) return true; // "all day" written as a quiet window
    if (from < to ? mins >= from && mins < to : mins >= from) return true;
  }

  // Yesterday's overnight window may still be running this morning.
  const yesterday = schedule[DAY_KEYS[(DAY_KEYS.indexOf(day) + 6) % 7]];
  if (yesterday.mode === "quiet") {
    const from = minutes(yesterday.from);
    const to = minutes(yesterday.to);
    if (to < from && mins < to) return true;
  }
  return false;
}

/** "9pm" / "7:30am" */
export function niceTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${suffix}` : `${h12}${suffix}`;
}

/** One line for the menu button, e.g. "Quiet 9pm-7am weekdays · Sun off". */
export function describeSchedule(schedule: Schedule): string {
  if (DAY_KEYS.every((d) => schedule[d].mode === "on")) return "Buzzes any time";
  const off = DAY_KEYS.filter((d) => schedule[d].mode === "off");
  const quiet = DAY_KEYS.filter((d) => schedule[d].mode === "quiet");
  const bits: string[] = [];
  if (quiet.length) {
    const windows = new Set(quiet.map((d) => `${schedule[d].from}-${schedule[d].to}`));
    const first = schedule[quiet[0]];
    bits.push(
      windows.size === 1
        ? `Quiet ${niceTime(first.from)}–${niceTime(first.to)}${quiet.length === 7 ? "" : ` (${quiet.length} days)`}`
        : `Quiet hours on ${quiet.length} days`
    );
  }
  if (off.length) {
    bits.push(
      off.length <= 2
        ? `${off.map((d) => DAY_LABELS[d].slice(0, 3)).join(" & ")} off`
        : `${off.length} days off`
    );
  }
  return bits.join(" · ");
}
