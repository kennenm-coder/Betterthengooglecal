"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { WorkOrder } from "@/lib/types";
import {
  saveOrdersLocal,
  loadOrdersLocal,
  getLastUpdated,
  loadCurrentAndFuture,
  loadUnscheduled,
  loadHistorical,
  mergeOrders,
  fetchMaterialJobs,
  enrichWithMaterials,
} from "@/lib/store";

const CALENDAR_VISIBLE_TYPES = new Set(["Install", "Service", "Job Site Visit"]);

interface DataContextType {
  orders: WorkOrder[];
  loading: boolean;
  loadingHistory: boolean;
  lastUpdated: string | null;
  refresh: () => Promise<void>;
  setOrdersLocal: (orders: WorkOrder[]) => void;
}

const DataContext = createContext<DataContextType>({
  orders: [],
  loading: true,
  loadingHistory: false,
  lastUpdated: null,
  refresh: async () => {},
  setOrdersLocal: () => {},
});

export function useData() {
  return useContext(DataContext);
}

export default function DataProvider({ children }: { children: ReactNode }) {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const hasHydrated = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const genRef = useRef(0);

  const refresh = useCallback(async () => {
    // Cancel any in-flight refresh
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const gen = ++genRef.current;

    const stale = () => gen !== genRef.current || ac.signal.aborted;

    try {
      // Phase 1: Current month + future
      const current = await loadCurrentAndFuture(ac.signal);
      if (stale()) return;

      const jobByPO = await fetchMaterialJobs();
      if (stale()) return;

      const enriched = enrichWithMaterials(current, jobByPO);
      setOrders(enriched);
      saveOrdersLocal(enriched);
      setLastUpdated(new Date().toISOString());
      setLoading(false);
      hasHydrated.current = true;

      // Phase 2: Unscheduled work orders
      try {
        const unscheduled = await loadUnscheduled(ac.signal);
        if (stale()) return;

        const enrichedUnsched = enrichWithMaterials(unscheduled, jobByPO);
        setOrders((prev) => mergeOrders(prev, enrichedUnsched));
      } catch {
        // Unscheduled load failed — keep current+future showing
      }

      // Phase 3: Historical backlog
      try {
        setLoadingHistory(true);
        const historicalBatch: WorkOrder[] = [];
        await loadHistorical((page) => {
          if (stale()) return;
          const enrichedPage = enrichWithMaterials(page, jobByPO);
          historicalBatch.push(...enrichedPage);
        }, ac.signal);

        if (!stale() && historicalBatch.length > 0) {
          setOrders((prev) => mergeOrders(prev, historicalBatch));
        }
      } catch {
        // Historical load failed — keep current+future+unscheduled showing
      } finally {
        if (!stale()) {
          setLoadingHistory(false);
          // Save complete dataset to localStorage once
          setOrders((prev) => {
            saveOrdersLocal(prev);
            return prev;
          });
        }
      }
    } catch {
      if (stale()) return;
      // Phase 1 failed — fall back to localStorage
      if (!hasHydrated.current) {
        const local = loadOrdersLocal();
        if (local.length > 0) {
          setOrders(local);
          setLastUpdated(getLastUpdated());
        }
      }
    } finally {
      if (!stale()) {
        setLoading(false);
        hasHydrated.current = true;
      }
    }
  }, []);

  const setOrdersLocalFn = useCallback((newOrders: WorkOrder[]) => {
    const visible = newOrders.filter((o) => CALENDAR_VISIBLE_TYPES.has(o.workOrderType));
    setOrders(visible);
    saveOrdersLocal(visible);
    setLastUpdated(new Date().toISOString());
  }, []);

  useEffect(() => {
    const cached = getLastUpdated();
    const cacheAge = cached ? Date.now() - new Date(cached).getTime() : Infinity;
    const FIVE_MINUTES = 5 * 60 * 1000;

    if (cacheAge < FIVE_MINUTES) {
      const local = loadOrdersLocal();
      if (local.length > 0) {
        setOrders(local);
        setLastUpdated(cached);
        setLoading(false);
        hasHydrated.current = true;
      }
    }

    refresh();

    return () => {
      abortRef.current?.abort();
    };
  }, [refresh]);

  return (
    <DataContext.Provider value={{ orders, loading, loadingHistory, lastUpdated, refresh, setOrdersLocal: setOrdersLocalFn }}>
      {children}
    </DataContext.Provider>
  );
}
