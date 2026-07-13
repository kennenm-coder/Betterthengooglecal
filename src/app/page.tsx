"use client";

import { useState, useMemo, useCallback } from "react";
import { useData } from "@/components/DataProvider";
import { useSwipe } from "@/hooks/useSwipe";
import DayView from "@/components/DayView";
import WeekView from "@/components/WeekView";
import OrderSheet from "@/components/OrderSheet";
import BottomNav from "@/components/BottomNav";
import FilterPanel, { Filters, EMPTY_FILTERS, applyFilters } from "@/components/FilterPanel";
import { WorkOrder, ViewMode } from "@/lib/types";
import { addDays, addWeeks, subDays, subWeeks, format, isToday } from "date-fns";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

export default function CalendarPage() {
  const { orders, loading } = useData();
  const [view, setView] = useState<ViewMode>("day");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedOrder, setSelectedOrder] = useState<WorkOrder | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const filteredOrders = useMemo(() => applyFilters(orders, filters), [orders, filters]);

  const goToday = () => setCurrentDate(new Date());
  const goPrev = useCallback(() =>
    setCurrentDate((d) => (view === "day" ? subDays(d, 1) : subWeeks(d, 1))), [view]);
  const goNext = useCallback(() =>
    setCurrentDate((d) => (view === "day" ? addDays(d, 1) : addWeeks(d, 1))), [view]);

  const swipeRef = useSwipe({ onSwipeLeft: goNext, onSwipeRight: goPrev });

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <header className="bg-background border-b border-border px-3 py-2 flex items-center gap-2 z-20">
        <button
          onClick={goToday}
          className={`text-sm px-3 py-1.5 rounded-md border border-border font-medium ${
            isToday(currentDate) ? "bg-primary text-white border-primary" : "hover:bg-surface"
          }`}
        >
          Today
        </button>

        <div className="flex items-center">
          <button onClick={goPrev} className="p-1.5 rounded-full hover:bg-surface">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button onClick={goNext} className="p-1.5 rounded-full hover:bg-surface">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <h1 className="text-sm sm:text-base font-semibold flex-1 truncate">
          {view === "day"
            ? format(currentDate, "MMM d")
            : format(currentDate, "MMM yyyy")}
        </h1>

        <FilterPanel orders={orders} filters={filters} onChange={setFilters} />

        <div className="flex bg-surface rounded-lg p-0.5">
          {(["day", "week"] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1 text-sm rounded-md capitalize transition-colors ${
                view === v ? "bg-background shadow-sm font-medium" : "text-muted"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </header>

      <div ref={swipeRef} className="flex-1 flex flex-col min-h-0">
        {view === "day" ? (
          <DayView
            orders={filteredOrders}
            date={currentDate}
            onSelectOrder={setSelectedOrder}
          />
        ) : (
          <WeekView
            orders={filteredOrders}
            date={currentDate}
            onSelectOrder={setSelectedOrder}
            onSelectDay={(d) => {
              setCurrentDate(d);
              setView("day");
            }}
          />
        )}
      </div>

      {selectedOrder && (
        <OrderSheet order={selectedOrder} onClose={() => setSelectedOrder(null)} />
      )}

      <BottomNav />
    </div>
  );
}
