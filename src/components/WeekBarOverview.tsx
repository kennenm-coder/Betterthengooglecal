"use client";

import { WorkOrder, TimeOffRequest } from "@/lib/types";
import { typeColor, typeTileText } from "@/lib/calendar-utils";
import { lastFirst, crewName } from "@/lib/format-utils";
import { getTimeOffForDate } from "@/lib/time-off-store";
import { format } from "date-fns";
import { useState, useMemo } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

type BarItem =
  | { kind: "order"; order: WorkOrder }
  | { kind: "timeOff"; request: TimeOffRequest };

const MAX_VISIBLE = 3;

export default function WeekBarOverview({
  days,
  ordersByDay,
  timeOffRequests,
  onSelectOrder,
  onSelectDay,
}: {
  days: Date[];
  ordersByDay: Map<string, WorkOrder[]>;
  timeOffRequests: TimeOffRequest[];
  onSelectOrder: (order: WorkOrder) => void;
  onSelectDay: (date: Date) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const barsByDay = useMemo(() => {
    const map = new Map<string, BarItem[]>();
    for (const day of days) {
      const key = format(day, "yyyy-MM-dd");
      const items: BarItem[] = [];

      const dayOrders = ordersByDay.get(key) || [];
      for (const order of dayOrders) {
        items.push({ kind: "order", order });
      }

      const dayTimeOff = getTimeOffForDate(timeOffRequests, key);
      for (const request of dayTimeOff) {
        items.push({ kind: "timeOff", request });
      }

      map.set(key, items);
    }
    return map;
  }, [days, ordersByDay, timeOffRequests]);

  const hasOverflow = useMemo(
    () => Array.from(barsByDay.values()).some((bars) => bars.length > MAX_VISIBLE),
    [barsByDay]
  );

  const totalBars = useMemo(
    () => Array.from(barsByDay.values()).reduce((sum, bars) => sum + bars.length, 0),
    [barsByDay]
  );

  if (totalBars === 0) return null;

  return (
    <div className="hidden lg:block border-b border-border bg-background">
      <div
        className={`grid grid-cols-7 ${
          expanded ? "max-h-[200px] overflow-y-auto" : ""
        }`}
      >
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const bars = barsByDay.get(key) || [];
          const visible = expanded ? bars : bars.slice(0, MAX_VISIBLE);
          const overflow = expanded ? 0 : bars.length - MAX_VISIBLE;

          return (
            <div
              key={key}
              className="border-r border-border/50 last:border-r-0 px-1 py-1 space-y-0.5 min-h-[28px]"
            >
              {visible.map((bar) => {
                if (bar.kind === "order") {
                  const name = lastFirst(bar.order.customerName).split(",")[0];
                  const crew = crewName(bar.order);
                  return (
                    <button
                      key={bar.order.id}
                      onClick={() => onSelectOrder(bar.order)}
                      className={`w-full text-left text-[10px] leading-tight px-1.5 py-0.5 rounded truncate hover:opacity-90 transition-opacity ${typeColor(
                        bar.order.workOrderType
                      )} ${typeTileText(bar.order.workOrderType)}`}
                      title={`${lastFirst(bar.order.customerName)} - ${crew || bar.order.orderNumber}`}
                    >
                      {name}
                      {crew ? ` - ${crew}` : ""}
                    </button>
                  );
                }
                return (
                  <div
                    key={bar.request.id}
                    className="w-full text-left text-white text-[10px] leading-tight px-1.5 py-0.5 rounded truncate bg-rba-green"
                    title={`${bar.request.employee_name} - Off`}
                  >
                    {bar.request.employee_name} OFF
                  </div>
                );
              })}
              {overflow > 0 && (
                <button
                  onClick={() => onSelectDay(day)}
                  className="w-full text-[10px] text-muted hover:text-foreground transition-colors text-center"
                >
                  +{overflow} more
                </button>
              )}
            </div>
          );
        })}
      </div>
      {hasOverflow && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="w-full flex items-center justify-center gap-1 py-0.5 text-[10px] text-muted hover:text-foreground transition-colors"
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3 h-3" /> Collapse
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" /> Show all
            </>
          )}
        </button>
      )}
    </div>
  );
}
