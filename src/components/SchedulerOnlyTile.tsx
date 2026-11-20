"use client";

import { CalendarClock } from "lucide-react";
import type { WorkOrder } from "@/lib/types";
import { typeColor, typeTileText, formatTime, multiDayProgress } from "@/lib/calendar-utils";
import { lastFirst, crewsForDate, extractCity } from "@/lib/format-utils";

/**
 * An appointment the scheduling app has booked that rForce does not have.
 *
 * It wears its job type's colour so it sits in the day like any other tile, but
 * with a dashed outline and a "Scheduling app only" badge so nobody mistakes it
 * for something rForce confirmed. Deliberately not a button: there is no work
 * order behind it, so there is nothing to open.
 */
export default function SchedulerOnlyTile({
  order,
  date,
  dayKey,
  compact = false,
}: {
  order: WorkOrder;
  date: Date;
  dayKey: string;
  compact?: boolean;
}) {
  const crews = crewsForDate(order, dayKey);
  const city = extractCity(order.address);
  const multiDay = multiDayProgress(order, date);
  const name = lastFirst(order.customerName);
  const ref = order.workOrderNumber || order.orderNumber;
  const small = compact ? "text-xs" : "text-sm";

  return (
    <div
      className={`w-full rounded-md px-3 py-2 ${compact ? "text-sm" : "text-base"} border-2 border-dashed border-white/70 ${typeColor(
        order.workOrderType
      )} ${typeTileText(order.workOrderType)}`}
      data-testid="scheduler-only-tile"
      title="In the scheduling app, but not in rForce"
    >
      <div className="font-medium truncate">
        {/* Phone: crew on top. Desktop keeps the job name on top. */}
        <span className="md:hidden">{crews.length > 0 ? crews.join(" + ") : "Unassigned"}</span>
        <span className="hidden md:inline">
          {name}
          {ref ? ` - ${ref}` : ""}
        </span>
      </div>
      <div className={`${small} opacity-90 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 break-words`}>
        <span className="px-1.5 py-0.5 rounded bg-black/40 font-bold inline-flex items-center gap-1">
          <CalendarClock className={compact ? "w-3 h-3" : "w-3.5 h-3.5"} />
          Scheduling app only
        </span>
        {multiDay && (
          <span className="px-1.5 py-0.5 rounded bg-black/25 font-bold">
            Day {multiDay.day} of {multiDay.total}
          </span>
        )}
        <span>{order.workOrderType}</span>
        <span>&middot; {formatTime(order.scheduledStart)}</span>
        {city && <span>&middot; {city}</span>}
        <span className="md:hidden">
          &middot; {name}
          {ref ? ` - ${ref}` : ""}
        </span>
        {crews.length > 0 && <span className="hidden md:inline">&middot; {crews.join(" + ")}</span>}
      </div>
    </div>
  );
}
