"use client";

import { WorkOrder } from "@/lib/types";
import { getOrdersForDay, getHourSlot, typeColor } from "@/lib/calendar-utils";
import { formatTime } from "@/lib/calendar-utils";
import { lastFirst, crewName, sortByNameAlpha } from "@/lib/format-utils";
import { format } from "date-fns";
import { useMemo } from "react";
import { useSwipe } from "@/hooks/useSwipe";

const HOURS = Array.from({ length: 13 }, (_, i) => i + 6); // 6AM - 6PM

export default function DayView({
  orders,
  date,
  onSelectOrder,
  onSwipeLeft,
  onSwipeRight,
}: {
  orders: WorkOrder[];
  date: Date;
  onSelectOrder: (order: WorkOrder) => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}) {
  const swipeRef = useSwipe({ onSwipeLeft, onSwipeRight });
  const dayOrders = useMemo(() => getOrdersForDay(orders, date), [orders, date]);

  const ordersByHour = useMemo(() => {
    const map = new Map<number, WorkOrder[]>();
    for (const h of HOURS) map.set(h, []);
    for (const o of dayOrders) {
      const h = getHourSlot(o);
      const closest = HOURS.reduce((prev, curr) =>
        Math.abs(curr - h) < Math.abs(prev - h) ? curr : prev
      );
      map.get(closest)?.push(o);
    }
    for (const [h, list] of map) {
      map.set(h, sortByNameAlpha(list));
    }
    return map;
  }, [dayOrders]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="bg-background z-10 px-4 py-2 border-b border-border">
        <h2 className="text-lg font-semibold">{format(date, "EEEE, MMMM d")}</h2>
        <p className="text-sm text-muted">
          {dayOrders.length} appointment{dayOrders.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div ref={swipeRef} className="flex-1 overflow-y-auto overscroll-contain">
        <div className="relative">
        {HOURS.map((hour) => {
          const hourOrders = ordersByHour.get(hour) || [];
          return (
            <div key={hour} className="flex border-b border-border/50 min-h-[60px]">
              <div className="w-16 shrink-0 text-xs text-muted py-2 text-right pr-3 pt-1">
                {format(new Date(2000, 0, 1, hour), "h a")}
              </div>
              <div className="flex-1 border-l border-border/50 py-1 px-2 space-y-1">
                {hourOrders.map((order) => {
                  const crew = crewName(order);
                  return (
                    <button
                      key={order.id}
                      onClick={() => onSelectOrder(order)}
                      className={`w-full text-left rounded-md px-2.5 py-1.5 text-white text-sm transition-all active:scale-[0.98] ${typeColor(
                        order.workOrderType
                      )}`}
                    >
                      <div className="font-medium truncate">
                        {lastFirst(order.customerName)} - {order.orderNumber}
                      </div>
                      <div className="text-xs opacity-90 flex items-center gap-2">
                        <span>{formatTime(order.scheduledStart)}</span>
                        {crew && <span>{crew}</span>}
                        {order.materialJob && (
                          <span className="px-1.5 py-0.5 rounded bg-white/20 text-[10px] font-semibold">
                            Linked
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}
