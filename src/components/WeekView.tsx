"use client";

import { WorkOrder } from "@/lib/types";
import { getOrdersForWeek, typeColor, formatTime } from "@/lib/calendar-utils";
import { lastFirst, crewName, sortByNameAlpha } from "@/lib/format-utils";
import { format, startOfWeek, addDays, isToday } from "date-fns";
import { useMemo } from "react";
import { useSwipe } from "@/hooks/useSwipe";

export default function WeekView({
  orders,
  date,
  onSelectOrder,
  onSelectDay,
  onSwipeLeft,
  onSwipeRight,
}: {
  orders: WorkOrder[];
  date: Date;
  onSelectOrder: (order: WorkOrder) => void;
  onSelectDay: (date: Date) => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}) {
  const swipeRef = useSwipe({ onSwipeLeft, onSwipeRight });
  const weekStart = startOfWeek(date, { weekStartsOn: 0 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const ordersByDay = useMemo(() => {
    const byDay = getOrdersForWeek(orders, date);
    for (const [key, list] of byDay) {
      byDay.set(key, sortByNameAlpha(list));
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
                  return (
                    <button
                      key={order.id}
                      onClick={() => onSelectOrder(order)}
                      className={`w-full text-left rounded-md px-3 py-2 text-white text-sm transition-all active:scale-[0.98] ${typeColor(
                        order.workOrderType
                      )}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium truncate">
                          {lastFirst(order.customerName)} - {order.orderNumber}
                        </span>
                        <span className="text-xs opacity-90 whitespace-nowrap ml-2">
                          {formatTime(order.scheduledStart)}
                        </span>
                      </div>
                      <div className="text-xs opacity-80 mt-0.5">
                        {order.workOrderType}
                        {crew && <> &middot; {crew}</>}
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
