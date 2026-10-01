"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { addDays, format, startOfWeek } from "date-fns";
import { ChevronDown, ChevronRight, UserCheck } from "lucide-react";
import { TimeOffRequest } from "@/lib/types";
import { getTimeOffForDate } from "@/lib/time-off-store";
import { fetchFreeInstallLeads, FloatersByDay } from "@/lib/floaters-store";

/**
 * "Floaters" — install leads with no job on the day, for field managers.
 *
 * Collapsed it is a single line that never wraps: as many names as fit, then a
 * "+N more" chip. Tapping anywhere expands it into a day-by-day list for the
 * week, so a manager can see who is free tomorrow as easily as today.
 *
 * The week is fetched in one call, so expanding costs nothing.
 */

const GAP_PX = 6;

/** Stable empty map so `byDay` keeps its identity between renders. */
const EMPTY: FloatersByDay = {};

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export default function FloatersBanner({
  date,
  timeOffRequests,
}: {
  date: Date;
  timeOffRequests: TimeOffRequest[];
}) {
  const weekStart = startOfWeek(date, { weekStartsOn: 0 });
  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const weekEndStr = format(addDays(weekStart, 6), "yyyy-MM-dd");
  const dayStr = format(date, "yyyy-MM-dd");

  // Cached against the week it was fetched for, so moving to another week shows
  // nothing rather than last week's names while the new lookup is in flight.
  const [cache, setCache] = useState<{ week: string; data: FloatersByDay } | null>(
    null
  );
  const [expanded, setExpanded] = useState(false);
  const loaded = cache?.week === weekStartStr;
  const byDay = loaded ? cache.data : EMPTY;

  useEffect(() => {
    let cancelled = false;
    fetchFreeInstallLeads(weekStartStr, weekEndStr).then((result) => {
      if (!cancelled) setCache({ week: weekStartStr, data: result });
    });
    return () => {
      cancelled = true;
    };
  }, [weekStartStr, weekEndStr]);

  /**
   * Someone on PTO isn't floating, they're off — and their name is already on
   * the line directly above this one. Matched on name, which is the only thing
   * the two systems share.
   */
  const freeOn = useCallback(
    (iso: string): string[] => {
      const names = byDay[iso] ?? [];
      const off = getTimeOffForDate(timeOffRequests, iso);
      if (off.length === 0) return names;
      return names.filter(
        (n) => !off.some((r) => sameName(r.employee_name || "", n))
      );
    },
    [byDay, timeOffRequests]
  );

  const today = freeOn(dayStr);

  // ── Fit as many chips as the row allows, then "+N more" ──
  const trackRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(today.length);

  const fit = useCallback(() => {
    const track = trackRef.current;
    const measure = measureRef.current;
    if (!track || !measure) return;

    const available = track.clientWidth;
    if (available <= 0) return;
    const chips = Array.from(
      measure.querySelectorAll<HTMLElement>("[data-chip]")
    );
    const moreEl = measure.querySelector<HTMLElement>("[data-more]");
    const moreWidth = moreEl ? moreEl.offsetWidth + GAP_PX : 0;

    let used = 0;
    let count = 0;
    for (let i = 0; i < chips.length; i++) {
      const width = chips[i].offsetWidth + (i > 0 ? GAP_PX : 0);
      // Room for the "+N more" chip is only needed if names will be left over.
      const reserve = i < chips.length - 1 ? moreWidth : 0;
      if (used + width + reserve > available) break;
      used += width;
      count += 1;
    }
    // Always show at least one name — a bare "+12 more" says nothing.
    const next = Math.max(1, Math.min(count, chips.length));
    setVisibleCount((prev) => (prev === next ? prev : next));
  }, []);

  // Re-fit after every render rather than through a ResizeObserver. The row has
  // to re-fit whenever the surrounding layout changes, not only when the window
  // does, and the state guard above makes a no-op pass free.
  useLayoutEffect(fit);

  useEffect(() => {
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
    };
  }, [fit]);

  // Nothing to say until the lookup lands, and nothing to show if everyone is
  // booked — an empty bar would just eat a row of screen.
  if (!loaded || today.length === 0) return null;

  const shown = today.slice(0, visibleCount);
  const hidden = today.length - shown.length;

  return (
    <div className="bg-surface border-b border-border relative">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full px-3 py-1.5 flex items-center gap-2 text-left active:bg-border/40 transition-colors"
      >
        <UserCheck className="w-4 h-4 shrink-0 text-primary" />
        <span className="text-xs font-medium shrink-0 text-primary">Floaters:</span>

        <div ref={trackRef} className="flex-1 min-w-0 overflow-hidden">
          {expanded ? (
            // The full list is right below; repeating a clipped row of chips up
            // here just looks broken against the edge.
            <span className="text-xs text-muted">
              {today.length} free today
            </span>
          ) : (
            <div className="flex gap-1.5 flex-nowrap">
              {shown.map((name) => (
                <span
                  key={name}
                  className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs whitespace-nowrap"
                >
                  {name}
                </span>
              ))}
              {hidden > 0 && (
                <span className="bg-primary/20 text-primary rounded-full px-2 py-0.5 text-xs whitespace-nowrap font-medium">
                  +{hidden} more
                </span>
              )}
            </div>
          )}
        </div>

        {expanded ? (
          <ChevronDown className="w-4 h-4 shrink-0 text-muted" />
        ) : (
          <ChevronRight className="w-4 h-4 shrink-0 text-muted" />
        )}
      </button>

      {/* Off-screen copy at natural width — the clamped row above can't be
          measured for widths it is already hiding. */}
      <div
        ref={measureRef}
        aria-hidden
        className="absolute -left-[9999px] top-0 flex gap-1.5 flex-nowrap pointer-events-none"
      >
        {today.map((name) => (
          <span
            key={name}
            data-chip
            className="rounded-full px-2 py-0.5 text-xs whitespace-nowrap"
          >
            {name}
          </span>
        ))}
        <span data-more className="rounded-full px-2 py-0.5 text-xs whitespace-nowrap font-medium">
          +{today.length} more
        </span>
      </div>

      {expanded && (
        <div className="px-3 pb-2 pt-0.5 space-y-1.5 border-t border-border/60">
          {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d) => {
            const iso = format(d, "yyyy-MM-dd");
            const names = freeOn(iso);
            const isCurrent = iso === dayStr;
            return (
              <div key={iso} className="flex gap-2 text-xs">
                <span
                  className={`shrink-0 w-16 pt-0.5 ${
                    isCurrent ? "text-primary font-semibold" : "text-muted"
                  }`}
                >
                  {format(d, "EEE M/d")}
                </span>
                <div className="flex flex-wrap gap-1.5 min-w-0">
                  {names.length === 0 ? (
                    <span className="text-muted italic">everyone booked</span>
                  ) : (
                    names.map((name) => (
                      <span
                        key={name}
                        className="bg-primary/10 text-primary rounded-full px-2 py-0.5 whitespace-nowrap"
                      >
                        {name}
                      </span>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
