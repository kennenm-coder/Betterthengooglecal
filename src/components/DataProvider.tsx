"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { WorkOrder, MaterialJobData } from "@/lib/types";
import {
  saveBoundedCache,
  loadBoundedCache,
  getLastUpdated,
  loadInitialWindow,
  loadUnscheduled,
  loadFutureExtended,
  loadMonth,
  mergeOrders,
  fetchMaterialJobs,
  fetchJobsSignature,
  enrichWithMaterials,
  fetchLegacyLinks,
  deleteLegacyLink,
  yieldToMain,
} from "@/lib/store";
import { useAuth } from "@/hooks/useAuth";
import { canEditLegacyLink } from "@/lib/roles";

const CALENDAR_VISIBLE_TYPES = new Set(["Install", "Service", "Job Site Visit"]);

interface DataContextType {
  orders: WorkOrder[];
  /** All submitted material jobs, loaded once and shared across views. */
  materialJobs: MaterialJobData[];
  loading: boolean;
  loadingBackground: boolean;
  lastUpdated: string | null;
  refresh: () => Promise<void>;
  setOrdersLocal: (orders: WorkOrder[]) => void;
  ensureDateLoaded: (date: Date) => void;
  /** True when linked material jobs changed in the DB since we loaded them. */
  linkedJobsStale: boolean;
  /** Refetch material jobs and re-link them onto the loaded orders. */
  resyncLinkedJobs: () => Promise<void>;
  /** Reflect a legacy install-link change locally (url, or null to clear). */
  applyLegacyLink: (orderNumber: string, url: string | null) => void;
}

const DataContext = createContext<DataContextType>({
  orders: [],
  materialJobs: [],
  loading: true,
  loadingBackground: false,
  lastUpdated: null,
  refresh: async () => {},
  setOrdersLocal: () => {},
  ensureDateLoaded: () => {},
  linkedJobsStale: false,
  resyncLinkedJobs: async () => {},
  applyLegacyLink: () => {},
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
  const { roles } = useAuth();
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [materialJobs, setMaterialJobs] = useState<MaterialJobData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingBackground, setLoadingBackground] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [linkedJobsStale, setLinkedJobsStale] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const genRef = useRef(0);
  const loadedMonthsRef = useRef<Set<string>>(new Set());
  const monthLoadingRef = useRef<Set<string>>(new Set());
  const jobByPORef = useRef<Map<string, any>>(new Map());
  const jobsSigRef = useRef<string>("");
  const purgedLegacyRef = useRef<Set<string>>(new Set());

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

      // Fetch material jobs (don't block initial render).
      // The Map is also flattened into materialJobs state so Search and
      // UnscheduledJobs can consume it from context instead of re-fetching.
      try {
        // Fetch material jobs + legacy install links together. fetchLegacyLinks
        // populates the module cache that enrichWithMaterials reads by default.
        const [jobByPO] = await Promise.all([fetchMaterialJobs(), fetchLegacyLinks()]);
        if (stale()) return;
        jobByPORef.current = jobByPO;
        setMaterialJobs(Array.from(jobByPO.values()) as MaterialJobData[]);
        const enriched = enrichWithMaterials(initial, jobByPO);
        setOrders(enriched);
        saveBoundedCache(enriched);
        // Baseline fingerprint so we can detect later linked-job changes.
        setLinkedJobsStale(false);
        fetchJobsSignature()
          .then((sig) => {
            jobsSigRef.current = sig;
          })
          .catch(() => {});
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

      // Phase C removed — historical data (before -90 days) is now loaded
      // on demand via loadMonth() when the user navigates to an old date.
      // This avoids downloading the entire work_orders backlog on every visit.

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

  const resyncLinkedJobs = useCallback(async () => {
    const jobByPO = await fetchMaterialJobs();
    jobByPORef.current = jobByPO;
    setMaterialJobs(Array.from(jobByPO.values()) as MaterialJobData[]);
    setOrders((prev) => {
      const enriched = enrichWithMaterials(prev, jobByPO);
      saveBoundedCache(enriched);
      return enriched;
    });
    jobsSigRef.current = await fetchJobsSignature();
    setLinkedJobsStale(false);
  }, []);

  const applyLegacyLink = useCallback((orderNumber: string, url: string | null) => {
    setOrders((prev) => {
      const next = prev.map((o) =>
        o.orderNumber === orderNumber ? { ...o, legacyInstallUrl: url } : o
      );
      saveBoundedCache(next);
      return next;
    });
  }, []);

  // Auto-delete legacy links that a real material job now overrides (the real
  // install instructions win). Best-effort + RLS-gated: only authorized roles
  // can delete, so this runs once role resolves. The tile hides overridden
  // legacy links regardless, so this is pure housekeeping. Tracked per order so
  // it fires at most once each and never loops.
  useEffect(() => {
    if (!canEditLegacyLink(roles)) return;
    const overridden = orders.filter(
      (o) => o.materialJob && o.legacyInstallUrl && !purgedLegacyRef.current.has(o.orderNumber)
    );
    if (overridden.length === 0) return;
    for (const o of overridden) purgedLegacyRef.current.add(o.orderNumber);
    Promise.all(overridden.map((o) => deleteLegacyLink(o.orderNumber).catch(() => {}))).then(() => {
      setOrders((prev) =>
        prev.map((o) => (o.materialJob && o.legacyInstallUrl ? { ...o, legacyInstallUrl: null } : o))
      );
    });
  }, [orders, roles]);

  // Detect linked-job changes when the tab regains focus — only flag when the
  // fingerprint actually differs from what we loaded (no false alarms).
  // Debounced to at most once per minute so backgrounding/foregrounding the app
  // (constant in mobile field use) doesn't re-query the signature every time —
  // detecting an edited linked job within a minute is plenty, and it keeps
  // repeated focus events from adding up on egress.
  const lastSigCheckRef = useRef(0);
  useEffect(() => {
    const SIG_CHECK_MIN_INTERVAL_MS = 60 * 1000;
    const check = async () => {
      if (!jobsSigRef.current) return;
      if (Date.now() - lastSigCheckRef.current < SIG_CHECK_MIN_INTERVAL_MS) return;
      lastSigCheckRef.current = Date.now();
      try {
        const sig = await fetchJobsSignature();
        if (sig && sig !== jobsSigRef.current) setLinkedJobsStale(true);
      } catch {
        /* ignore — offline or transient */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
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
        materialJobs,
        loading,
        loadingBackground,
        lastUpdated,
        refresh,
        setOrdersLocal: setOrdersLocalFn,
        ensureDateLoaded,
        linkedJobsStale,
        resyncLinkedJobs,
        applyLegacyLink,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}
