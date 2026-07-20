"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { WorkOrder } from "@/lib/types";
import {
  saveOrdersLocal,
  loadOrdersLocal,
  getLastUpdated,
  loadOrdersFromSupabase,
  fetchMaterialJobs,
  enrichWithMaterials,
} from "@/lib/store";

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

  const refresh = useCallback(async () => {
    try {
      // Primary: load from Supabase work_orders table
      const supaOrders = await loadOrdersFromSupabase();

      if (supaOrders.length > 0) {
        // Fetch material jobs and enrich
        const jobByPO = await fetchMaterialJobs();
        const enriched = enrichWithMaterials(supaOrders, jobByPO);

        setOrders(enriched);
        saveOrdersLocal(enriched);
        setLastUpdated(new Date().toISOString());
        return;
      }
    } catch {
      // Supabase unreachable — fall through to fallbacks
    }

    // Fallback: try API route
    try {
      const res = await fetch("/api/orders");
      if (res.ok) {
        const data = await res.json();
        if (data.orders && data.orders.length > 0) {
          setOrders(data.orders);
          saveOrdersLocal(data.orders);
          setLastUpdated(data.uploadedAt);
          return;
        }
      }
    } catch {
      // Fall back to local
    }

    // Final fallback: localStorage
    const local = loadOrdersLocal();
    setOrders(local);
    setLastUpdated(getLastUpdated());
  }, []);

  const setOrdersLocalFn = useCallback((newOrders: WorkOrder[]) => {
    setOrders(newOrders);
    saveOrdersLocal(newOrders);
    setLastUpdated(new Date().toISOString());
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  return (
    <DataContext.Provider value={{ orders, loading, lastUpdated, refresh, setOrdersLocal: setOrdersLocalFn }}>
      {children}
    </DataContext.Provider>
  );
}
