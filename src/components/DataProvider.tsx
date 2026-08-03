"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { WorkOrder } from "@/lib/types";
import {
  saveOrdersLocal,
  loadOrdersLocal,
  getLastUpdated,
  loadOrdersFromSupabase,
  fetchMaterialJobs,
  enrichWithMaterials,
} from "@/lib/store";

const CALENDAR_VISIBLE_TYPES = new Set(["Install", "Service", "Job Site Visit"]);

interface DataContextType {
  orders: WorkOrder[];
  loading: boolean;
  lastUpdated: string | null;
  refresh: () => Promise<void>;
  setOrdersLocal: (orders: WorkOrder[]) => void;
}

const DataContext = createContext<DataContextType>({
  orders: [],
  loading: true,
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
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const hasHydrated = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const supaOrders = await loadOrdersFromSupabase();

      // Supabase succeeded (even if empty) — this is the source of truth
      const visible = supaOrders.filter((o) => CALENDAR_VISIBLE_TYPES.has(o.workOrderType));
      const jobByPO = await fetchMaterialJobs();
      const enriched = enrichWithMaterials(visible, jobByPO);

      setOrders(enriched);
      saveOrdersLocal(enriched);
      setLastUpdated(new Date().toISOString());
    } catch {
      // Supabase truly unreachable — only then use localStorage as read-only fallback
      // Do NOT fall through to /api/orders (it may serve a stale SW-cached response)
      if (!hasHydrated.current) {
        const local = loadOrdersLocal();
        if (local.length > 0) {
          setOrders(local);
          setLastUpdated(getLastUpdated());
        }
      }
      // If we already have data loaded, keep showing it rather than overwriting with stale data
    }
  }, []);

  const setOrdersLocalFn = useCallback((newOrders: WorkOrder[]) => {
    setOrders(newOrders);
    saveOrdersLocal(newOrders);
    setLastUpdated(new Date().toISOString());
  }, []);

  useEffect(() => {
    // Only show cached data if it's less than 5 minutes old — stale cache
    // flashes wrong appointment times on mobile before Supabase replaces it
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

    refresh().finally(() => {
      hasHydrated.current = true;
      setLoading(false);
    });
  }, [refresh]);

  return (
    <DataContext.Provider value={{ orders, loading, lastUpdated, refresh, setOrdersLocal: setOrdersLocalFn }}>
      {children}
    </DataContext.Provider>
  );
}
