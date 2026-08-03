"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { WorkOrder } from "@/lib/types";
import {
  saveBoundedCache,
  loadBoundedCache,
  getLastUpdated,
  loadInitialWindow,
  loadUnscheduled,
  loadFutureExtended,
  loadHistorical,
  loadMonth,
  mergeOrders,
  fetchMaterialJobs,
  enrichWithMaterials,
  yieldToMain,
} from "@/lib/store";

const CALENDAR_VISIBLE_TYPES = new Set(["Install", "Service", "Job Site Visit"]);

interface DataContextType {
  orders: WorkOrder[];
  loading: boolean;
  loadingBackground: boolean;
  lastUpdated: string | null;
  refresh: () => Promise<void>;
  setOrdersLocal: (orders: WorkOrder[]) => void;
  ensureDateLoaded: (date: Date) => void;
}

const DataContext = createContext<DataContextType>({
  orders: [],
  loading: true,
  loadingBackground: false,
  lastUpdated: null,
  refresh: async () => {},
  setOrdersLocal: () => {},
  ensureDateLoaded: () => {},
});

export function useData() {
  return useContext(DataContext);
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function getMonthsInRange(start: string, end: string): Set<string> {
  const months = new Set<string>();
  const s = new Date(start);
  const e = new Date(end);
  const cur = new Date(s.getFullYear(), s.getMonth(), 1);
  while (cur <= e) {
    months.add(monthKey(cur.getFullYear(), cur.getMonth() + 1));
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

export default function DataProvider({ children }: { children: ReactNode }) {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingBackground, setLoadingBackground] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const genRef = useRef(0);
  const loadedMonthsRef = useRef<Set<string>>(new Set());
  const monthLoadingRef = useRef<Set<string>>(new Set());
  const jobByPORef = useRef<Map<string, any>>(new Map());

  const refresh = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const gen = ++genRef.current;
    const stale = () => gen !== genRef.current || ac.signal.aborted;

    try {
      // Phase 1: Load ±90-day window
      const initial = await loadInitialWindow(ac.signal);
      if (stale()) return;

      setOrders(initial);
      setLoading(false);
      setLastUpdated(new Date().toISOString());

      // Mark initial months as loaded
      const today = new Date();
      const start = new Date(today);
      start.setDate(start.getDate() - 90);
      const end = new Date(today);
      end.setDate(end.getDate() + 90);
      const initialMonths = getMonthsInRange(start.toISOString(), end.toISOString());
      loadedMonthsRef.current = initialMonths;

      // Save bounded cache immediately
      saveBoundedCache(initial);

      // Fetch material jobs (don't block initial render)
      try {
        const jobByPO = await fetchMaterialJobs();
        if (stale()) return;
        jobByPORef.current = jobByPO;
        const enriched = enrichWithMaterials(initial, jobByPO);
        setOrders(enriched);
        saveBoundedCache(enriched);
      } catch {
        // Material enrichment failed — calendar still works without it
      }

      // Background phases
      setLoadingBackground(true);

      // Phase A: Unscheduled
      try {
        await yieldToMain();
        if (stale()) return;
        const unscheduled = await loadUnscheduled(ac.signal);
        if (stale()) return;
        const enrichedUnsched = jobByPORef.current.size > 0
          ? enrichWithMaterials(unscheduled, jobByPORef.current)
          : unscheduled;
        setOrders((prev) => mergeOrders(prev, enrichedUnsched));
        // Update cache with unscheduled included
        setOrders((prev) => {
          saveBoundedCache(prev);
          return prev;
        });
      } catch {
        // Keep showing what we have
      }

      // Phase B: Future beyond +90 days
      try {
        await loadFutureExtended((page) => {
          if (stale()) return;
          const enrichedPage = jobByPORef.current.size > 0
            ? enrichWithMaterials(page, jobByPORef.current)
            : page;
          setOrders((prev) => mergeOrders(prev, enrichedPage));
          // Mark months as loaded
          for (const o of page) {
            if (o.scheduledStart) {
              const d = new Date(o.scheduledStart);
              loadedMonthsRef.current.add(monthKey(d.getFullYear(), d.getMonth() + 1));
            }
          }
        }, ac.signal);
      } catch {
        // Keep showing what we have
      }

      // Phase C: Historical
      try {
        await loadHistorical((page) => {
          if (stale()) return;
          const enrichedPage = jobByPORef.current.size > 0
            ? enrichWithMaterials(page, jobByPORef.current)
            : page;
          setOrders((prev) => mergeOrders(prev, enrichedPage));
          for (const o of page) {
            if (o.scheduledStart) {
              const d = new Date(o.scheduledStart);
              loadedMonthsRef.current.add(monthKey(d.getFullYear(), d.getMonth() + 1));
            }
          }
        }, ac.signal);
      } catch {
        // Keep showing what we have
      }

      if (!stale()) {
        setLoadingBackground(false);
      }
    } catch (err) {
      if (stale()) return;
      // Phase 1 failed — use cache
      const cached = loadBoundedCache();
      if (cached.length > 0) {
        setOrders(cached);
        setLastUpdated(getLastUpdated());
      }
    } finally {
      if (!stale()) {
        setLoading(false);
      }
    }
  }, []);

  const ensureDateLoaded = useCallback((date: Date) => {
    const key = monthKey(date.getFullYear(), date.getMonth() + 1);
    if (loadedMonthsRef.current.has(key)) return;
    if (monthLoadingRef.current.has(key)) return;

    monthLoadingRef.current.add(key);
    const ac = abortRef.current;

    loadMonth(date.getFullYear(), date.getMonth() + 1, ac?.signal)
      .then((monthOrders) => {
        if (ac?.signal.aborted) return;
        const enriched = jobByPORef.current.size > 0
          ? enrichWithMaterials(monthOrders, jobByPORef.current)
          : monthOrders;
        setOrders((prev) => mergeOrders(prev, enriched));
        loadedMonthsRef.current.add(key);
      })
      .catch(() => {
        // Failed to load month — will retry on next navigation
      })
      .finally(() => {
        monthLoadingRef.current.delete(key);
      });
  }, []);

  const setOrdersLocalFn = useCallback((newOrders: WorkOrder[]) => {
    const visible = newOrders.filter((o) => CALENDAR_VISIBLE_TYPES.has(o.workOrderType));
    setOrders(visible);
    saveBoundedCache(visible);
    setLastUpdated(new Date().toISOString());
  }, []);

  useEffect(() => {
    // Hydrate from cache immediately
    const cached = loadBoundedCache();
    const cachedTs = getLastUpdated();
    if (cached.length > 0) {
      setOrders(cached);
      setLastUpdated(cachedTs);
      setLoading(false);
    }

    refresh();

    return () => {
      abortRef.current?.abort();
    };
  }, [refresh]);

  return (
    <DataContext.Provider
      value={{
        orders,
        loading,
        loadingBackground,
        lastUpdated,
        refresh,
        setOrdersLocal: setOrdersLocalFn,
        ensureDateLoaded,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}
