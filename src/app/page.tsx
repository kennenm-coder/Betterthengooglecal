"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useData } from "@/components/DataProvider";
import DayView from "@/components/DayView";
import WeekView from "@/components/WeekView";
import UnscheduledJobs from "@/components/UnscheduledJobs";
import OrderSheet from "@/components/OrderSheet";
import BottomNav from "@/components/BottomNav";
import FilterPanel, { Filters, EMPTY_FILTERS, applyFilters } from "@/components/FilterPanel";
import { WorkOrder, ViewMode } from "@/lib/types";
import { addDays, addWeeks, subDays, subWeeks, format, isToday } from "date-fns";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Database } from "lucide-react";

export default function CalendarPage() {
  const { orders, loading, refresh } = useData();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) await reg.update();
      }
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };
  const [view, setView] = useState<ViewMode>("day");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedOrder, setSelectedOrder] = useState<WorkOrder | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  // Restore OrderSheet when returning from install instructions page
  useEffect(() => {
    const orderId = searchParams.get("order");
    if (orderId && orders.length > 0) {
      const match = orders.find((o) => o.id === orderId);
      if (match) setSelectedOrder(match);
      window.history.replaceState(null, "", "/");
    }
  }, [searchParams, orders]);

  const filteredOrders = useMemo(() => applyFilters(orders, filters), [orders, filters]);

  const [slideDir, setSlideDir] = useState<"next" | "prev" | null>(null);
  const slideKey = useRef(0);

  const goToday = () => { setSlideDir(null); setCurrentDate(new Date()); };
  const goPrev = useCallback(() => {
    slideKey.current++;
    setSlideDir("prev");
    setCurrentDate((d) => (view === "day" ? subDays(d, 1) : subWeeks(d, 1)));
  }, [view]);
  const goNext = useCallback(() => {
    slideKey.current++;
    setSlideDir("next");
    setCurrentDate((d) => (view === "day" ? addDays(d, 1) : addWeeks(d, 1)));
  }, [view]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
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

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-1.5 rounded-full hover:bg-surface disabled:opacity-50"
          title="Refresh data"
        >
          <RefreshCw className={`w-4.5 h-4.5 ${refreshing ? "animate-spin" : ""}`} />
        </button>

        <FilterPanel orders={orders} filters={filters} onChange={setFilters} />

        <button
          onClick={() => setView(view === "list" ? "day" : "list")}
          className={`p-1.5 rounded-full transition-colors ${
            view === "list" ? "bg-primary text-white" : "hover:bg-surface"
          }`}
          title="Jobs Not Scheduled"
        >
          <Database className="w-4.5 h-4.5" />
        </button>

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

      <div
        key={slideKey.current}
        className={`flex-1 flex flex-col min-h-0 ${
          slideDir === "next" ? "slide-next" : slideDir === "prev" ? "slide-prev" : ""
        }`}
        onAnimationEnd={() => setSlideDir(null)}
      >
        {view === "list" ? (
          <UnscheduledJobs
            orders={orders}
            onSelectOrder={setSelectedOrder}
          />
        ) : view === "day" ? (
          <DayView
            orders={filteredOrders}
            date={currentDate}
            onSelectOrder={setSelectedOrder}
            onSwipeLeft={goNext}
            onSwipeRight={goPrev}
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
            onSwipeLeft={goNext}
            onSwipeRight={goPrev}
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
