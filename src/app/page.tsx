"use client";

import { Suspense, useState, useMemo, useCallback, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useData } from "@/components/DataProvider";
import DayView from "@/components/DayView";
import WeekView from "@/components/WeekView";
import UnscheduledJobs from "@/components/UnscheduledJobs";
import OrderSheet from "@/components/OrderSheet";
import BottomNav from "@/components/BottomNav";
import FilterPanel, { Filters, EMPTY_FILTERS, applyFilters } from "@/components/FilterPanel";
import TimeOffBanner from "@/components/TimeOffBanner";
import StaleTabTag from "@/components/StaleTabBanner";
import { useStaleTab } from "@/hooks/useStaleTab";
import { useAuth } from "@/hooks/useAuth";
import { WorkOrder, ViewMode, TimeOffRequest } from "@/lib/types";
import { fetchTimeOffRequests } from "@/lib/time-off-store";
import { addDays, addWeeks, subDays, subWeeks, format, isToday, parseISO } from "date-fns";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Database, CalendarDays, Plus, UserCog } from "lucide-react";

export default function CalendarPageWrapper() {
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
      <CalendarPage />
    </Suspense>
  );
}

function CalendarPage() {
  const { orders, loading, loadingBackground, refresh, ensureDateLoaded, linkedJobsStale, resyncLinkedJobs } = useData();
  const [resyncingJobs, setResyncingJobs] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const { role } = useAuth();
  const canManageTimeOff = role === "admin" || role === "payroll-admin" || role === "field-manager";
  const { isStale, staleAfter, nextUpdate, isDesktop, dismiss, resetBlock } = useStaleTab();

  useEffect(() => {
    fetchTimeOffRequests().then(setTimeOffRequests);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      // Check for a new service worker and activate it
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update();
          const waiting = reg.waiting;
          if (waiting) {
            waiting.postMessage({ type: "SKIP_WAITING" });
            await new Promise<void>((resolve) => {
              const onStateChange = () => {
                if (waiting.state === "activated") {
                  waiting.removeEventListener("statechange", onStateChange);
                  resolve();
                }
              };
              waiting.addEventListener("statechange", onStateChange);
              setTimeout(resolve, 3000);
            });
            window.location.reload();
            return;
          }
        }
      }
      await refresh();
      fetchTimeOffRequests().then(setTimeOffRequests);
      resetBlock();
    } finally {
      setRefreshing(false);
    }
  };
  const [view, setView] = useState<ViewMode>("day");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedOrder, setSelectedOrder] = useState<WorkOrder | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  // Restore OrderSheet when returning from install instructions page.
  // The setState here is intentional — we sync URL state into React on mount.
  useEffect(() => {
    const orderId = searchParams.get("order");
    if (orderId && orders.length > 0) {
      const match = orders.find((o) => o.id === orderId);
      if (match) setSelectedOrder(match);
      window.history.replaceState(null, "", "/");
    }
  }, [searchParams, orders]);

  useEffect(() => {
    ensureDateLoaded(currentDate);
  }, [currentDate, ensureDateLoaded]);

  const filteredOrders = useMemo(() => applyFilters(orders, filters), [orders, filters]);

  const goToday = () => setCurrentDate(new Date());
  const goPrev = useCallback(() => {
    setCurrentDate((d) => (view === "day" ? subDays(d, 1) : subWeeks(d, 1)));
  }, [view]);
  const goNext = useCallback(() => {
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
    <div className="flex flex-col h-full overflow-hidden touch-manipulation">
      <header className="bg-background border-b border-border px-3 py-1.5 z-20 space-y-1.5">
        {/* Row 1: Navigation */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={goToday}
            className={`text-sm px-3 py-1.5 rounded-md border border-border font-medium shrink-0 ${
              isToday(currentDate) ? "bg-primary text-white border-primary" : "hover:bg-surface"
            }`}
          >
            Today
          </button>

          <button onClick={goPrev} className="p-1.5 rounded-full hover:bg-surface shrink-0">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button onClick={goNext} className="p-1.5 rounded-full hover:bg-surface shrink-0">
            <ChevronRight className="w-5 h-5" />
          </button>

          <h1 className="text-base font-semibold truncate">
            {view === "day"
              ? format(currentDate, "EEE, MMM d")
              : format(currentDate, "MMM yyyy")}
          </h1>

          {isDesktop && (
            <StaleTabTag
              isStale={isStale}
              staleAfter={staleAfter}
              nextUpdate={nextUpdate}
              onRefresh={handleRefresh}
            />
          )}

          <div className="flex-1" />

          {canManageTimeOff && (
            <button
              onClick={() => router.push("/time-off")}
              className="flex items-center gap-1 text-sm px-2.5 py-1.5 rounded-md bg-rba-green text-white font-medium shrink-0 active:scale-[0.97] transition-all"
              title="Add Time Off"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Time Off</span>
            </button>
          )}

          <Link
            href="/settings"
            className="p-1.5 rounded-md hover:bg-surface text-muted hover:text-foreground shrink-0"
            title="Settings"
          >
            <UserCog className="w-5 h-5" />
          </Link>
        </div>

        {/* Row 2: Actions */}
        <div className="flex items-center gap-1.5">
          <div className="flex bg-surface rounded-lg p-0.5">
            {(["day", "week"] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-sm rounded-md capitalize transition-colors ${
                  view === v ? "bg-background shadow-sm font-medium" : "text-muted"
                }`}
              >
                {v}
              </button>
            ))}
            <div className="relative px-2 py-1.5 rounded-md text-muted hover:bg-background/50 transition-colors cursor-pointer">
              <CalendarDays className="w-4.5 h-4.5" />
              <input
                type="date"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                value={format(currentDate, "yyyy-MM-dd")}
                onChange={(e) => {
                  if (e.target.value) {
                    setCurrentDate(parseISO(e.target.value));
                    if (view !== "day" && view !== "week") setView("day");
                  }
                }}
              />
            </div>
          </div>

          <div className="flex-1" />

          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2 rounded-full hover:bg-surface disabled:opacity-50 shrink-0"
            title="Refresh data"
          >
            <RefreshCw className={`w-4.5 h-4.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>

          <FilterPanel orders={orders} filters={filters} onChange={setFilters} />

          <button
            onClick={() => setView(view === "list" ? "day" : "list")}
            className={`p-2 rounded-full transition-colors shrink-0 ${
              view === "list" ? "bg-primary text-white" : "hover:bg-surface"
            }`}
            title="Jobs Not Scheduled"
          >
            <Database className="w-4.5 h-4.5" />
          </button>
        </div>
      </header>

      <TimeOffBanner requests={timeOffRequests} date={currentDate} />

      {linkedJobsStale && (
        <button
          onClick={async () => {
            setResyncingJobs(true);
            try {
              await resyncLinkedJobs();
            } finally {
              setResyncingJobs(false);
            }
          }}
          disabled={resyncingJobs}
          className="w-full bg-amber-500/15 text-amber-700 text-xs font-medium py-2 px-4 border-b border-amber-500/30 flex items-center justify-center gap-2 active:bg-amber-500/25 disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${resyncingJobs ? "animate-spin" : ""}`} />
          {resyncingJobs ? "Resyncing linked jobs…" : "Linked jobs changed — tap to resync"}
        </button>
      )}

      {loadingBackground && (
        <div className="bg-surface/80 text-muted text-xs text-center py-1 border-b border-border">
          Updating additional appointments…
        </div>
      )}

      <div className="flex-1 flex flex-col min-h-0">
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
            timeOffRequests={timeOffRequests}
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
