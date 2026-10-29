"use client";

import { useEffect, useMemo, useState } from "react";
import BottomNav from "@/components/BottomNav";
import { useAuth } from "@/hooks/useAuth";
import { isInstaller } from "@/lib/roles";
import { openSalesforce } from "@/lib/calendar-utils";
import { formatDateShort } from "@/lib/calendar-utils";
import {
  fetchServiceParts,
  sortGroup,
  needsScheduling,
  PARTS_GROUPS,
  type PartsGroupKey,
  type ServicePartsRow,
} from "@/lib/service-parts";
import {
  Loader2,
  Package,
  ExternalLink,
  CalendarX,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  MapPin,
} from "lucide-react";

const CHIP: Record<PartsGroupKey, string> = {
  received: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  partial: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  ordered: "bg-sky-500/10 text-sky-700 border-sky-500/30",
  waiting: "bg-surface text-muted border-border",
};

export default function ServicePartsPage() {
  const { roles, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<ServicePartsRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Every group open but "On the way", which is the long one nobody is
  // chasing — it is there to look up, not to work through.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ ordered: true });

  const blocked = isInstaller(roles);

  async function load() {
    setRefreshing(true);
    try {
      setRows(await fetchServiceParts());
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (authLoading || blocked) return;
    load();
    // Loading once on mount is the intent.
  }, [authLoading, blocked]);

  const grouped = useMemo(() => {
    const map = new Map<PartsGroupKey, ServicePartsRow[]>();
    for (const group of PARTS_GROUPS) map.set(group.key, []);
    for (const row of rows ?? []) map.get(row.parts.stage as PartsGroupKey)?.push(row);
    for (const [key, list] of map) map.set(key, sortGroup(list, key));
    return map;
  }, [rows]);

  const unscheduled = useMemo(
    () => (rows ?? []).filter(needsScheduling).length,
    [rows]
  );

  if (!authLoading && blocked) {
    return (
      <div className="flex flex-col min-h-dvh bg-background">
        <main className="flex-1 p-4">
          <p className="text-muted">This page isn&rsquo;t available for your account.</p>
        </main>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-dvh bg-background">
      <header className="sticky top-0 z-30 bg-background border-b border-border px-4 py-3 flex items-center gap-3">
        <Package className="w-5 h-5 text-primary shrink-0" />
        <div className="min-w-0">
          <h1 className="font-semibold leading-tight">Service Parts</h1>
          <p className="text-xs text-muted leading-tight">
            Open service jobs that have purchase orders in rForce
          </p>
        </div>
        <button
          onClick={load}
          disabled={refreshing}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-muted"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      <main className="flex-1 p-4 space-y-4">
        {rows === null && (
          <div className="flex items-center gap-2 text-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading parts…
          </div>
        )}

        {rows !== null && rows.length === 0 && (
          <p className="text-muted">
            No open service job has purchase orders in rForce yet. If that seems wrong, the
            daily PO report may not have run.
          </p>
        )}

        {/* The number worth acting on, said once, at the top. A part that
            landed with no visit booked is the failure this screen exists to
            catch. */}
        {unscheduled > 0 && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-start gap-2">
            <CalendarX className="w-4 h-4 mt-0.5 text-emerald-700 shrink-0" />
            <p className="text-sm text-emerald-800">
              <strong>{unscheduled}</strong> service job{unscheduled === 1 ? " has" : "s have"} parts
              on the dock with no visit scheduled.
            </p>
          </div>
        )}

        {rows !== null &&
          PARTS_GROUPS.map((group) => {
            const list = grouped.get(group.key) ?? [];
            if (list.length === 0) return null;
            const open = !collapsed[group.key];
            return (
              <section key={group.key}>
                <button
                  onClick={() =>
                    setCollapsed((c) => ({ ...c, [group.key]: !c[group.key] }))
                  }
                  className="w-full flex items-center gap-2 py-2 text-left"
                >
                  {open ? (
                    <ChevronDown className="w-4 h-4 text-muted shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted shrink-0" />
                  )}
                  <span className="font-semibold">{group.title}</span>
                  <span className="text-muted text-sm">({list.length})</span>
                </button>
                {open && (
                  <>
                    <p className="text-xs text-muted mb-2 pl-6">{group.blurb}</p>
                    <div className="space-y-2">
                      {list.map((row) => (
                        <article
                          key={row.orderNumber}
                          className="rounded-lg border border-border bg-surface p-3"
                        >
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium break-words">
                                  {row.customerName || "(no name)"}
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded-full text-xs font-medium border ${CHIP[group.key]}`}
                                  title={row.parts.detail}
                                >
                                  {row.parts.label}
                                </span>
                                {needsScheduling(row) && (
                                  <span className="px-2 py-0.5 rounded-full text-xs font-medium border border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
                                    not scheduled
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-muted mt-0.5">
                                {row.orderNumber}
                                {row.status ? ` · ${row.status}` : ""}
                                {row.scheduledStart
                                  ? ` · visit ${formatDateShort(row.scheduledStart)}`
                                  : ""}
                              </p>
                              {row.address && (
                                <p className="text-sm text-muted mt-0.5 flex items-start gap-1">
                                  <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                  <span className="break-words">{row.address}</span>
                                </p>
                              )}
                              {row.serviceDescription && (
                                <p className="text-sm text-foreground mt-1 break-words">
                                  {row.serviceDescription}
                                </p>
                              )}
                              <p className="text-xs text-muted mt-1">{row.parts.detail}</p>
                            </div>
                            <button
                              onClick={() => openSalesforce(row.orderNumber)}
                              className="shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border text-xs text-muted"
                              title={`Open ${row.orderNumber} in rForce`}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              rForce
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </section>
            );
          })}
      </main>
      <BottomNav />
    </div>
  );
}
