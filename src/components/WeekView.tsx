"use client";

import { WorkOrder, TimeOffRequest } from "@/lib/types";
import { getOrdersForWeek, typeColor, formatTime } from "@/lib/calendar-utils";
import { lastFirst, crewName, sortByStartTime, extractCity } from "@/lib/format-utils";
import { format, startOfWeek, addDays, isToday } from "date-fns";
import { useMemo } from "react";
import { useSwipe } from "@/hooks/useSwipe";
import WeekBarOverview from "./WeekBarOverview";

export default function WeekView({
  orders,
  date,
  timeOffRequests = [],
  onSelectOrder,
  onSelectDay,
  onSwipeLeft,
  onSwipeRight,
}: {
  orders: WorkOrder[];
  date: Date;
  timeOffRequests?: TimeOffRequest[];
  onSelectOrder: (order: WorkOrder) => void;
  onSelectDay: (date: Date) => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}) {
  const swipeRef = useSwipe({ onSwipeLeft, onSwipeRight });
  const weekStart = startOfWeek(date, { weekStartsOn: 0 });
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const ordersByDay = useMemo(() => {
    const byDay = getOrdersForWeek(orders, date);
    for (const [key, list] of byDay) {
      byDay.set(key, sortByStartTime(list));
    }
    return byDay;
  }, [orders, date]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="bg-background z-10 border-b border-border">
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const dayKey = format(day, "yyyy-MM-dd");
            const dayOrders = ordersByDay.get(dayKey) || [];
            const today = isToday(day);

            return (
              <button
                key={dayKey}
                onClick={() => onSelectDay(day)}
                className="flex flex-col items-center py-2 border-r border-border/50 last:border-r-0"
              >
                <span className="text-[10px] text-muted uppercase">
                  {format(day, "EEE")}
                </span>
                <span
                  className={`text-lg font-medium w-8 h-8 flex items-center justify-center rounded-full ${
                    today ? "bg-primary text-white" : ""
                  }`}
                >
                  {format(day, "d")}
                </span>
                {dayOrders.length > 0 && (
                  <span className="text-[10px] text-muted">{dayOrders.length}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <WeekBarOverview
        days={days}
        ordersByDay={ordersByDay}
        timeOffRequests={timeOffRequests}
        onSelectOrder={onSelectOrder}
        onSelectDay={onSelectDay}
      />

      <div ref={swipeRef} className="flex-1 overflow-y-auto overscroll-contain">
        <div className="divide-y divide-border">
        {days.map((day) => {
          const dayKey = format(day, "yyyy-MM-dd");
          const dayOrders = ordersByDay.get(dayKey) || [];
          if (dayOrders.length === 0) return null;

          return (
            <div key={dayKey} className="p-3">
              <h3 className="text-sm font-medium text-muted mb-2">
                {format(day, "EEEE, MMM d")}
              </h3>
              <div className="space-y-1.5">
                {dayOrders.map((order) => {
                  const crew = crewName(order);
                  const city = extractCity(order.address);
                  return (
                    <button
                      key={order.id}
                      onClick={() => onSelectOrder(order)}
                      className={`w-full text-left rounded-md px-3 py-2 text-white text-sm transition-all active:scale-[0.98] ${typeColor(
                        order.workOrderType
                      )}`}
                    >
                      <div className="font-medium truncate">
                        {lastFirst(order.customerName)} - {order.orderNumber}
                      </div>
                      <div className="text-xs opacity-90 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                        <span>{formatTime(order.scheduledStart)}</span>
                        {city && <span>&middot; {city}</span>}
                        {crew && <span>&middot; {crew}</span>}
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
