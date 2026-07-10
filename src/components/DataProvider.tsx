"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { WorkOrder } from "@/lib/types";
import { saveOrders, loadOrders, getLastUpdated } from "@/lib/store";

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
      const res = await fetch("/api/orders");
      if (res.ok) {
        const data = await res.json();
        if (data.orders && data.orders.length > 0) {
          setOrders(data.orders);
          saveOrders(data.orders);
          setLastUpdated(data.uploadedAt);
          return;
        }
      }
    } catch {
      // Fall back to local
    }
    const local = loadOrders();
    setOrders(local);
    setLastUpdated(getLastUpdated());
  }, []);

  const setOrdersLocal = useCallback((newOrders: WorkOrder[]) => {
    setOrders(newOrders);
    saveOrders(newOrders);
    setLastUpdated(new Date().toISOString());
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  return (
    <DataContext.Provider value={{ orders, loading, lastUpdated, refresh, setOrdersLocal }}>
      {children}
    </DataContext.Provider>
  );
}
