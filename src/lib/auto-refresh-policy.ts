// When may the app catch itself up without anyone tapping Refresh?
//
// Modelled on Task OS (its long-away-policy / resume-sync-policy), adapted for
// a calendar used both at office desks and in the field with no signal.
//
// Two separate jobs, with separate rules:
//
//  1. QUIET PULL — re-fetch the calendar data in place. The page never reloads,
//     and a failed fetch already leaves the saved copy on screen
//     (DataProvider.refresh keeps the cache when the network lets it down).
//     This is what keeps an office window from going stale.
//
//  2. RELOAD — only when a NEWER VERSION of the app has been deployed, and
//     only at a moment nothing can be lost: nothing open, nobody typing, on a
//     view-only screen, and either straight after coming back (before they
//     touch anything) or after nobody has touched the screen for a while.
//
// Both need a GOOD connection, proven by a real round trip to our own server
// (connection-check.ts), not the phone's "online" flag — that reads true with
// one bar in a dead zone. No good connection ⇒ nothing happens at all, and the
// screen stays exactly as it is. That is the field guarantee.
//
// Pure on purpose: every rule here is a thing that must never go wrong, and
// keeping them out of the component means they read as one list.

/** Pull when the last successful load is at least this old (heartbeat). */
export const PULL_STALE_AFTER_MS = 60 * 60_000;
/** Never start two automatic pulls closer together than this, success or not. */
export const PULL_MIN_GAP_MS = 3 * 60_000;
/** Don't swap data in under someone who touched the screen in the last few seconds. */
export const PULL_IDLE_MS = 15_000;
/**
 * The heartbeat only runs if someone has used this screen recently. Stops an
 * office PC left open overnight pulling the whole calendar every hour for
 * nobody. (Import-hour pulls and coming-back pulls don't need this.)
 */
export const HEARTBEAT_NEEDS_ACTIVITY_WITHIN_MS = 2 * 60 * 60_000;

/** Away (hidden or asleep) at least this long ⇒ coming back counts as a "resume". */
export const RESUME_AWAY_MS = 30 * 60_000;
/**
 * After a resume, how long a reload may still happen. Past this the person is
 * reading the screen and a reload would yank it from under them.
 */
export const RESUME_GRACE_MS = 15_000;
/** Nobody has touched the screen this long ⇒ a reload can't interrupt anyone. */
export const RELOAD_IDLE_MS = 10 * 60_000;

/**
 * Screens a reload may happen on: view-only, and they restore themselves after
 * a reload (the calendar keeps its day/view; search keeps its box text).
 * Everything else — time off, More for More, admin, work orders, install docs —
 * can hold half-filled forms outside a pop-up, so a newer version waits until
 * the person is back on one of these.
 */
const RELOAD_SAFE_PATHS = new Set(["/", "/search"]);

export function isReloadSafePath(pathname: string): boolean {
  return RELOAD_SAFE_PATHS.has(pathname.replace(/\/+$/, "") || "/");
}

/** The parts of "now" both decisions read. */
export type Moment = {
  /** The page is on screen. */
  visible: boolean;
  /** A pop-up is open or a text field has focus. */
  busy: boolean;
  /** ms since the last tap / key / scroll on this page. */
  sinceInteractMs: number;
};

export type PullInput = Moment & {
  /** ms since the last successful data load (Infinity if none). */
  sinceLastLoadMs: number;
  /** ms since the last automatic pull was started (Infinity if none). */
  sinceLastAutoPullMs: number;
  /** An hourly rForce import has landed since the last load. */
  newImportBlock: boolean;
  /** A linked material job changed since the last load. */
  linkedJobsStale: boolean;
  /** Just came back after RESUME_AWAY_MS or more. */
  resumed: boolean;
  /** A load is already running (auto or the Refresh button). */
  loading: boolean;
};

export type PullDecision =
  /** Nothing is due. */
  | "none"
  /** Due, but not now (hidden, busy, just touched, too soon) — ask again later. */
  | "wait"
  /** Due and nothing in the way — check the connection, then pull. */
  | "pull";

export function decideQuietPull(i: PullInput): PullDecision {
  const heartbeatDue =
    i.sinceLastLoadMs >= PULL_STALE_AFTER_MS &&
    (i.resumed || i.sinceInteractMs <= HEARTBEAT_NEEDS_ACTIVITY_WITHIN_MS);
  const due = i.newImportBlock || i.linkedJobsStale || heartbeatDue;
  if (!due) return "none";

  // Never in the background, never on top of a load already running.
  if (!i.visible || i.loading) return "wait";
  // A pop-up or a typed field: re-drawing the calendar under it could swap the
  // job it's showing. Wait for them to close it.
  if (i.busy) return "wait";
  // Mid-scroll or mid-tap: let them finish. (Straight after a resume, before
  // any touch, sinceInteractMs is large, so this doesn't hold that one up.)
  if (i.sinceInteractMs < PULL_IDLE_MS) return "wait";
  // A failing or slow server must not be hammered every tick.
  if (i.sinceLastAutoPullMs < PULL_MIN_GAP_MS) return "wait";
  return "pull";
}

export type ReloadInput = Moment & {
  /** The server says a newer version of the app is deployed. */
  newVersion: boolean;
  pathname: string;
  /**
   * ms since the last resume (coming back after RESUME_AWAY_MS), or Infinity
   * if there hasn't been one.
   */
  sinceResumeMs: number;
  /** Tapped or typed since that resume. */
  touchedSinceResume: boolean;
};

export function decideReload(i: ReloadInput): boolean {
  if (!i.newVersion) return false;
  if (!i.visible || i.busy) return false;
  if (!isReloadSafePath(i.pathname)) return false;
  // Moment 1: they just came back and haven't touched anything yet — the
  // screen is about to change under them anyway.
  const freshResume = i.sinceResumeMs <= RESUME_GRACE_MS && !i.touchedSinceResume;
  // Moment 2: nobody has touched it for a good while (an office screen).
  const longIdle = i.sinceInteractMs >= RELOAD_IDLE_MS;
  return freshResume || longIdle;
}
