"use client";

import { useState, useRef, useEffect, useCallback } from "react";

/**
 * Refresh-block boundaries — the hours the rForce import lands. Power Automate
 * runs hourly, 8am–5pm. This list is the single source of truth: every boundary
 * and label below derives from it, so a cadence change is a one-line edit here.
 */
const BLOCK_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17] as const;

/**
 * Minutes past the hour before new data counts as "available". The import needs
 * a moment to parse and upsert, so flipping the banner exactly on the hour can
 * send someone to refresh into a half-written import — and at ten imports a day
 * that's ten chances to catch one mid-flight. Raise it if imports get slower;
 * set it to 0 to flip exactly on the hour.
 */
const BLOCK_LAG_MINUTES = 5;

/** Minutes since midnight. */
function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Returns how many refresh boundaries the given time has passed (0–BLOCK_HOURS.length). */
function getRefreshBlock(date: Date): number {
  const now = minutesOfDay(date);
  let block = 0;
  for (const bh of BLOCK_HOURS) {
    if (now >= bh * 60 + BLOCK_LAG_MINUTES) block++;
  }
  return block;
}

/** Formats a 24-hour hour for display, e.g. 13 → "1:00 PM". */
function formatHour(hour: number): string {
  const h = hour > 12 ? hour - 12 : hour;
  const ampm = hour >= 12 ? "PM" : "AM";
  return `${h}:00 ${ampm}`;
}

/** Returns the human-readable boundary the tab crossed, e.g. "12:00 PM". */
function getBlockLabel(block: number): string {
  if (block <= 0 || block > BLOCK_HOURS.length) return "";
  return formatHour(BLOCK_HOURS[block - 1]);
}

/**
 * Returns the label for the next upcoming refresh, e.g. "2:00 PM", or "" once the
 * day's last import has passed. This advances on the hour rather than at the
 * lagged boundary, so the chip never reads "Next update 8:00 AM" at 8:02.
 */
function getNextUpdateLabel(date: Date): string {
  const now = minutesOfDay(date);
  for (const bh of BLOCK_HOURS) {
    if (now < bh * 60) return formatHour(bh);
  }
  return ""; // past the day's last import
}

export interface StaleTabState {
  isStale: boolean;
  /** The block boundary label the tab fell behind, e.g. "12:00 PM" */
  staleAfter: string;
  /** Label for the next scheduled refresh, e.g. "2:00 PM" */
  nextUpdate: string;
  /** Whether the feature is active (desktop only) */
  isDesktop: boolean;
  /** Dismiss the banner until the next block boundary */
  dismiss: () => void;
  /** Reset the stored block to "now" — call after a successful refresh */
  resetBlock: () => void;
}

const NOOP = () => {};
const IDLE: StaleTabState = {
  isStale: false,
  staleAfter: "",
  nextUpdate: "",
  isDesktop: false,
  dismiss: NOOP,
  resetBlock: NOOP,
};

const CHECK_INTERVAL_MS = 60_000; // 1 minute

export function useStaleTab(): StaleTabState {
  const [isStale, setIsStale] = useState(false);
  const [staleAfter, setStaleAfter] = useState("");
  const [nextUpdate, setNextUpdate] = useState("");
  const initialBlock = useRef<number>(-1);
  const dismissedAtBlock = useRef<number>(-1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const desktopRef = useRef(false);
  const [isDesktopState, setIsDesktopState] = useState(false);

  const check = useCallback(() => {
    const now = new Date();
    const block = getRefreshBlock(now);

    // Update the "next update at" label every tick
    setNextUpdate(getNextUpdateLabel(now));

    if (
      block !== initialBlock.current &&
      block !== dismissedAtBlock.current
    ) {
      setIsStale(true);
      setStaleAfter(getBlockLabel(block));
    }
  }, []);

  const dismiss = useCallback(() => {
    const now = getRefreshBlock(new Date());
    dismissedAtBlock.current = now;
    setIsStale(false);
  }, []);

  const resetBlock = useCallback(() => {
    const now = new Date();
    initialBlock.current = getRefreshBlock(now);
    dismissedAtBlock.current = -1;
    setIsStale(false);
    setStaleAfter("");
    setNextUpdate(getNextUpdateLabel(now));
  }, []);

  useEffect(() => {
    // SSR guard
    if (typeof window === "undefined") return;

    // Desktop-only: coarse pointer = touch device, skip
    if (!window.matchMedia("(pointer: fine)").matches) return;
    desktopRef.current = true;
    setIsDesktopState(true);

    // Stamp the block at mount time
    const now = new Date();
    initialBlock.current = getRefreshBlock(now);
    setNextUpdate(getNextUpdateLabel(now));

    // Start the polling interval
    intervalRef.current = setInterval(check, CHECK_INTERVAL_MS);

    // Instant check when the tab regains focus
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        check();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [check]);

  // On non-desktop or SSR, never report stale
  if (typeof window === "undefined") return IDLE;

  return { isStale, staleAfter, nextUpdate, isDesktop: isDesktopState, dismiss, resetBlock };
}
