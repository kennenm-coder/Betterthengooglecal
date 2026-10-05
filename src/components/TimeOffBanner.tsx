"use client";

import { TimeOffRequest } from "@/lib/types";
import { getTimeOffForDate, formatTimeDisplay } from "@/lib/time-off-store";
import { format } from "date-fns";
import { useMemo } from "react";
import { Palmtree } from "lucide-react";

export default function TimeOffBanner({
  requests,
  date,
}: {
  requests: TimeOffRequest[];
  date: Date;
}) {
  const dateStr = format(date, "yyyy-MM-dd");
  const offToday = useMemo(
    () => getTimeOffForDate(requests, dateStr),
    [requests, dateStr]
  );

  if (offToday.length === 0) return null;

  // Times only mean something on the day they fall on: the leave time on the
  // first day of the request, the return time on the last.
  function timeLabel(r: TimeOffRequest): string {
    const lastDay = r.end_date || r.start_date;
    const parts: string[] = [];
    if (r.start_time && dateStr === r.start_date) {
      parts.push(`out ${formatTimeDisplay(r.start_time)}`);
    }
    if (r.end_time && dateStr === lastDay) {
      parts.push(`back ${formatTimeDisplay(r.end_time)}`);
    }
    return parts.join(" · ");
  }

  return (
    <div className="bg-rba-green text-white px-3 py-1.5 flex items-center gap-2 overflow-x-auto">
      <Palmtree className="w-4 h-4 shrink-0 opacity-80" />
      <span className="text-xs font-medium shrink-0">Off:</span>
      <div className="flex gap-1.5 text-xs">
        {offToday.map((r) => {
          const times = timeLabel(r);
          return (
            <span
              key={r.id}
              className="bg-white/20 rounded-full px-2 py-0.5 whitespace-nowrap"
            >
              {r.employee_name}
              {times && <span className="opacity-80"> ({times})</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
