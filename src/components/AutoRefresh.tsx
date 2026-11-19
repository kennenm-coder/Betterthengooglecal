"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useData } from "@/components/DataProvider";
import { useAuth } from "@/hooks/useAuth";
import { openPopupCount } from "@/hooks/useBackClose";
import { importBlockKey } from "@/hooks/useStaleTab";
import { checkConnection, newVersionKnown } from "@/lib/connection-check";
import {
  RESUME_AWAY_MS,
  decideQuietPull,
  decideReload,
  type Moment,
} from "@/lib/auto-refresh-policy";

/*
 * Keeps the app caught up on its own — but only when the connection is
 * proven good, and never under someone mid-task. The rules live in
 * src/lib/auto-refresh-policy.ts; this component just gathers the facts and
 * acts on the answer.
 *
 * What it does:
 *  - QUIET PULL: when an hourly import has landed, linked jobs changed, or the
 *    data is over an hour old, it re-fetches the calendar in place (the same
 *    thing the Refresh button does) and tells the calendar page so its time-off
 *    and special-day tiles and the "Next update" tag catch up too.
 *  - RELOAD: only when a newer version of the app has been deployed, and only
 *    at a safe moment (see decideReload).
 *
 * The field guarantee: with no signal or weak signal the connection check
 * fails, and NOTHING happens — no request goes out to Supabase, nothing
 * reloads, the screen stays as it is. It tries again a few minutes later.
 *
 * HOW "AWAY" IS MEASURED (from Task OS): `lastSeen` is the last moment the page
 * was both on screen AND running. A tick refreshes it while visible, and going
 * hidden stamps it. A phone that froze the app (iOS does this, and so does a
 * sleeping laptop) fires no event at all, but its timers stop — so the first
 * tick after waking finds a gap far bigger than its own interval.
 */

const TICK_MS = 10_000;
/** How often to ask the server whether a newer version is out. */
const VERSION_CHECK_MS = 15 * 60_000;

/** Fired after an automatic pull, so the calendar page can catch up its own bits. */
export const AUTO_REFRESHED_EVENT = "duck-data-refreshed";

function isBusy(): boolean {
  if (typeof document === "undefined") return true;
  // Every pop-up registers for the back button — tiles, write-ups, Job
  // Complete, More for More, the camera, filters, catalog…
  if (openPopupCount() > 0) return true;
  // Belt and braces for anything modal that doesn't.
  if (document.querySelector('[aria-modal="true"]')) return true;
  // Typing anywhere.
  const el = document.activeElement as HTMLElement | null;
  if (el) {
    if (el.isContentEditable) return true;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
  }
  return false;
}

export default function AutoRefresh() {
  const { refresh, refreshExtras, lastUpdated, linkedJobsStale, loading } = useData();
  const { user } = useAuth();
  const pathname = usePathname();

  // Latest values for the long-lived listeners below, without re-binding them.
  const live = useRef({ refresh, refreshExtras, lastUpdated, linkedJobsStale, loading, signedIn: !!user, pathname });
  useEffect(() => {
    live.current = { refresh, refreshExtras, lastUpdated, linkedJobsStale, loading, signedIn: !!user, pathname };
  });

  useEffect(() => {
    const visible = () => document.visibilityState === "visible";
    const mountedAt = Date.now();

    let lastSeen = mountedAt;
    let lastInteractAt = 0;
    let resumedAt = -Infinity;
    let touchedSinceResume = false;
    // The app's own load is running right now — don't pile a second on top.
    let lastAutoPullAt = mountedAt;
    let lastProbeFailed = false;
    let lastVersionCheckAt = mountedAt;
    let lastReloadTryAt = 0;
    let running = false;
    let reloading = false;

    const moment = (now: number): Moment => ({
      visible: visible(),
      busy: isBusy(),
      sinceInteractMs: lastInteractAt ? now - lastInteractAt : Infinity,
    });

    const reloadInputs = (now: number, newVersion: boolean) => ({
      ...moment(now),
      newVersion,
      pathname: live.current.pathname ?? "",
      sinceResumeMs: now - resumedAt,
      touchedSinceResume,
    });

    const reload = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };

    const tryReload = async () => {
      running = true;
      try {
        // Prove the connection right now — a reload with bad signal is the
        // one thing that could strand someone.
        const c = await checkConnection({ fresh: true });
        if (c.good && c.newVersion && decideReload(reloadInputs(Date.now(), true))) reload();
      } finally {
        running = false;
      }
    };

    const pull = async () => {
      running = true;
      lastAutoPullAt = Date.now();
      try {
        const c = await checkConnection();
        if (!c.good) {
          // Weak or no signal: do nothing at all. Try again after the gap.
          lastProbeFailed = true;
          return;
        }
        lastProbeFailed = false;
        // A newer version is out and this is a safe moment: a reload catches
        // up the data AND the app in one go.
        if (c.newVersion && decideReload(reloadInputs(Date.now(), true))) {
          reload();
          return;
        }
        // The check took a moment — make sure they didn't open something.
        if (isBusy() || !visible()) {
          lastAutoPullAt = 0;
          return;
        }
        live.current.refreshExtras();
        await live.current.refresh();
        window.dispatchEvent(new Event(AUTO_REFRESHED_EVENT));
      } catch {
        /* refresh() keeps the saved copy on failure; nothing more to do. */
      } finally {
        running = false;
      }
    };

    const evaluate = () => {
      if (reloading) return;
      const now = Date.now();

      // Notice a long absence (hidden OR frozen).
      if (visible()) {
        if (now - lastSeen >= RESUME_AWAY_MS) {
          resumedAt = now;
          touchedSinceResume = false;
        }
        lastSeen = now;
      }

      const l = live.current;
      if (!l.signedIn || running) return;

      const m = moment(now);

      // 1. A newer version already spotted: reload at the first safe moment.
      // At most one try a minute, so weak signal isn't probed every tick.
      if (newVersionKnown() && now - lastReloadTryAt >= 60_000 && decideReload(reloadInputs(now, true))) {
        lastReloadTryAt = now;
        void tryReload();
        return;
      }

      // 2. Quiet pull.
      const loadedAt = l.lastUpdated ? Date.parse(l.lastUpdated) : NaN;
      const nowKey = importBlockKey(new Date(now));
      // Only once today's first import has landed (block > 0) — otherwise the
      // date ticking over at midnight would look like a new import.
      const importToday = !nowKey.endsWith("#0");
      const decision = decideQuietPull({
        ...m,
        sinceLastLoadMs: Number.isFinite(loadedAt) ? now - loadedAt : Infinity,
        sinceLastAutoPullMs: now - lastAutoPullAt,
        newImportBlock:
          Number.isFinite(loadedAt) && importToday && importBlockKey(new Date(loadedAt)) !== nowKey,
        linkedJobsStale: l.linkedJobsStale,
        resumed: now - resumedAt < RESUME_AWAY_MS,
        loading: l.loading,
      });
      if (decision === "pull") {
        void pull();
        return;
      }

      // 3. Every so often (and on coming back), quietly ask whether a newer
      // version is out. Costs one tiny request; makes none when offline.
      const justResumed = resumedAt === now;
      if (m.visible && (justResumed || now - lastVersionCheckAt >= VERSION_CHECK_MS)) {
        lastVersionCheckAt = now;
        void checkConnection().then(() => {
          // If it found one, see straight away whether now is a safe moment.
          if (newVersionKnown()) evaluate();
        });
      }
    };

    const onHide = () => {
      lastSeen = Date.now();
    };
    const onVisibility = () => {
      if (visible()) evaluate();
      else onHide();
    };
    const onInteract = () => {
      lastInteractAt = Date.now();
      touchedSinceResume = true;
    };
    const onOnline = () => {
      // Signal came back: if the last try failed for lack of it, don't make
      // them wait out the full gap.
      if (lastProbeFailed) lastAutoPullAt = 0;
      evaluate();
    };

    const id = window.setInterval(evaluate, TICK_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("pageshow", evaluate);
    window.addEventListener("focus", evaluate);
    window.addEventListener("online", onOnline);
    const opts = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", onInteract, opts);
    window.addEventListener("keydown", onInteract, opts);
    window.addEventListener("wheel", onInteract, opts);
    window.addEventListener("touchstart", onInteract, opts);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("pageshow", evaluate);
      window.removeEventListener("focus", evaluate);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pointerdown", onInteract, opts);
      window.removeEventListener("keydown", onInteract, opts);
      window.removeEventListener("wheel", onInteract, opts);
      window.removeEventListener("touchstart", onInteract, opts);
    };
  }, []);

  return null;
}
