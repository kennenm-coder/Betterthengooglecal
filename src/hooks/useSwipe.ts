"use client";

import { useRef, useCallback, useEffect } from "react";

interface SwipeHandlers {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}

const MIN_SWIPE_DISTANCE = 30;
const MAX_SWIPE_TIME = 800;

export function useSwipe({ onSwipeLeft, onSwipeRight }: SwipeHandlers) {
  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const locked = useRef<"horizontal" | "vertical" | null>(null);

  const onTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY, t: Date.now() };
    locked.current = null;
  }, []);

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (!touchStart.current) return;
    if (locked.current) return;

    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchStart.current.x);
    const dy = Math.abs(touch.clientY - touchStart.current.y);

    if (dx > 10 || dy > 10) {
      locked.current = dx > dy ? "horizontal" : "vertical";
    }
  }, []);

  const onTouchEnd = useCallback(
    (e: TouchEvent) => {
      if (!touchStart.current) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - touchStart.current.x;
      const dt = Date.now() - touchStart.current.t;
      const direction = locked.current;
      touchStart.current = null;
      locked.current = null;

      if (dt > MAX_SWIPE_TIME) return;
      if (Math.abs(dx) < MIN_SWIPE_DISTANCE) return;
      if (direction !== "horizontal") return;

      if (dx < 0) onSwipeLeft?.();
      else onSwipeRight?.();
    },
    [onSwipeLeft, onSwipeRight]
  );

  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [onTouchStart, onTouchMove, onTouchEnd]);

  return ref;
}
