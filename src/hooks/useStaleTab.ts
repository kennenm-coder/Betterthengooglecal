"use client";

import { useState, useRef, useEffect, useCallback } from "react";

/** Refresh-block boundaries: 8am, 10am, 12pm, 2pm */
const BLOCK_HOURS = [8, 10, 12, 14] as const;

/** Returns a block index (0–4) for the given date's hour. */
function getRefreshBlock(date: Date): number {
  const hour = date.getHours();
  if (hour < 8) return 0;
  if (hour < 10) return 1;
  if (hour < 12) return 2;
  if (hour < 14) return 3;
  return 4;
}

/** Returns the human-readable boundary the tab crossed, e.g. "12:00 PM". */
function getBlockLabel(block: number): string {
  if (block <= 0 || block > BLOCK_HOURS.length) return "";
  const hour = BLOCK_HOURS[block - 1];
  const h = hour > 12 ? hour - 12 : hour;
  const ampm = hour >= 12 ? "PM" : "AM";
  return `${h}:00 ${ampm}`;
}

/** Returns the label for the next upcoming refresh, e.g. "2:00 PM", or "" if past the last one. */
function getNextUpdateLabel(date: Date): string {
  const hour = date.getHours();
  for (const bh of BLOCK_HOURS) {
    if (hour < bh) {
      const h = bh > 12 ? bh - 12 : bh;
      const ampm = bh >= 12 ? "PM" : "AM";
      return `${h}:00 ${ampm}`;
    }
  }
  return ""; // past 2pm, no more updates today
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
