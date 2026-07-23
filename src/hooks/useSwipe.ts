"use client";

import { useRef, useCallback, useEffect, useState } from "react";

interface SwipeHandlers {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}

const MIN_SWIPE_DISTANCE = 40;
const VELOCITY_THRESHOLD = 0.2;

export function useSwipe({ onSwipeLeft, onSwipeRight }: SwipeHandlers) {
  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const locked = useRef<"horizontal" | "vertical" | null>(null);
  const offsetRef = useRef(0);
  const ref = useRef<HTMLDivElement>(null);

  const onTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY, t: Date.now() };
    locked.current = null;
    const el = ref.current;
    if (el) {
      el.style.transition = "none";
      el.style.willChange = "transform";
    }
  }, []);

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (!touchStart.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchStart.current.x;
    const dy = touch.clientY - touchStart.current.y;

    if (!locked.current) {
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        locked.current = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      }
      return;
    }

    if (locked.current !== "horizontal") return;

    const resistance = 0.4;
    const dampened = dx * resistance;
    offsetRef.current = dampened;
    const el = ref.current;
    if (el) {
      el.style.transform = `translateX(${dampened}px)`;
      el.style.opacity = String(1 - Math.abs(dampened) / 800);
    }
  }, []);

  const onTouchEnd = useCallback(
    (e: TouchEvent) => {
      if (!touchStart.current) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - touchStart.current.x;
      const dt = (Date.now() - touchStart.current.t) / 1000;
      const velocity = Math.abs(dx) / dt / 1000;
      const direction = locked.current;
      touchStart.current = null;
      locked.current = null;

      const el = ref.current;
      if (!el) return;

      const shouldSwipe =
        direction === "horizontal" &&
        (Math.abs(dx) > MIN_SWIPE_DISTANCE || velocity > VELOCITY_THRESHOLD);

      if (shouldSwipe) {
        const exitX = dx < 0 ? -120 : 120;
        el.style.transition = "transform 0.12s ease-out, opacity 0.12s ease-out";
        el.style.transform = `translateX(${exitX}px)`;
        el.style.opacity = "0.3";
        setTimeout(() => {
          if (dx < 0) onSwipeLeft?.();
          else onSwipeRight?.();
          el.style.transition = "none";
          el.style.transform = `translateX(${dx < 0 ? 60 : -60}px)`;
          el.style.opacity = "0.3";
          requestAnimationFrame(() => {
            el.style.transition = "transform 0.15s ease-out, opacity 0.15s ease-out";
            el.style.transform = "translateX(0)";
            el.style.opacity = "1";
            el.style.willChange = "auto";
          });
        }, 120);
      } else {
        el.style.transition = "transform 0.2s ease-out, opacity 0.2s ease-out";
        el.style.transform = "translateX(0)";
        el.style.opacity = "1";
        el.style.willChange = "auto";
      }
      offsetRef.current = 0;
    },
    [onSwipeLeft, onSwipeRight]
  );

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
