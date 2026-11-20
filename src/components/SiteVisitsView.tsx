"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Footprints, Loader2, Search, X } from "lucide-react";
import BottomNav from "./BottomNav";
import { SiteVisitPopup } from "./SiteVisitBox";
import { useData } from "./DataProvider";
import { useAuth } from "@/hooks/useAuth";
import { searchOrders } from "@/lib/search";
import { formatDateShort } from "@/lib/calendar-utils";
import { localToday } from "@/lib/job-complete-core";
import {
  SITE_VISITS_CHANGED,
  fetchSiteVisitsSince,
  siteVisitJobOf,
  visitBy,
  type SiteVisit,
  type SiteVisitJob,
} from "@/lib/site-visits";
import type { WorkOrder } from "@/lib/types";

/** How far back the list reaches. Older visits are still on each job's tile. */
const MONTHS_SHOWN = 6;

function monthsAgoStart(n: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return localToday(d);
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** One appointment per job number, the latest one. */
function latestPerJob(orders: WorkOrder[]): WorkOrder[] {
  const byJob = new Map<string, WorkOrder>();
  for (const o of orders) {
    if (!o.orderNumber) continue;
    const prev = byJob.get(o.orderNumber);
    if (!prev || (o.scheduledStart || "") > (prev.scheduledStart || "")) byJob.set(o.orderNumber, o);
  }
  return Array.from(byJob.values());
}

/**
 * The measure tech's part of the Submissions tab (migration 078): find any job
 * and log a Job Site Visit on it, and see the visits already logged — yours,
 * or everyone's — by month. The same visits show on each job's tile.
 */
export default function SiteVisitsView() {
  const { user } = useAuth();
  const me = (user?.email || "").toLowerCase();
  const { orders, measureOrders } = useData();
  const [query, setQuery] = useState("");
  const [who, setWho] = useState<"mine" | "all">("mine");
  const [visits, setVisits] = useState<SiteVisit[] | null>(null);
  const [open, setOpen] = useState<{ job: SiteVisitJob; startNew: boolean } | null>(null);

  const load = useCallback(() => {
    fetchSiteVisitsSince(monthsAgoStart(MONTHS_SHOWN - 1)).then(setVisits);
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(SITE_VISITS_CHANGED, load);
    return () => window.removeEventListener(SITE_VISITS_CHANGED, load);
  }, [load]);

  const trimmed = query.trim();
  const searchResults = useMemo(() => {
    if (trimmed.length < 2) return [];
    return latestPerJob(searchOrders([...orders, ...measureOrders], trimmed)).slice(0, 40);
  }, [orders, measureOrders, trimmed]);

  const shown = useMemo(
    () => (visits || []).filter((v) => who === "all" || v.created_by.toLowerCase() === me),
    [visits, who, me]
  );
  const byMonth = useMemo(() => {
    const groups = new Map<string, SiteVisit[]>();
    for (const v of shown) {
      const ym = v.visit_date.slice(0, 7);
      if (!groups.has(ym)) groups.set(ym, []);
      groups.get(ym)!.push(v);
    }
    return Array.from(groups.entries());
  }, [shown]);

  return (
    <div className="flex flex-col h-full">
      <header className="bg-background border-b border-border px-3 pt-3 pb-2 z-20 space-y-2">
        <div className="flex items-center gap-2">
          <Footprints className="w-5 h-5 text-orange-500" />
          <h1 className="text-lg font-semibold flex-1">Job Site Visits</h1>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a job to log a visit: name, job #, address"
            className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-border bg-surface text-base sm:text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-border"
              aria-label="Clear search"
            >
              <X className="w-4 h-4 text-muted" />
            </button>
          )}
        </div>
        {!trimmed && (
          <div className="flex gap-1.5">
            {(
              [
                ["mine", "My visits"],
                ["all", "Everyone"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setWho(key)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium border ${
                  who === key ? "bg-foreground text-background border-foreground" : "border-border text-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="flex-1 overflow-auto">
        {trimmed ? (
          trimmed.length < 2 ? (
            <p className="px-4 py-6 text-sm text-muted text-center">Keep typing…</p>
          ) : searchResults.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted text-center">No jobs match “{trimmed}”.</p>
          ) : (
            <ul className="divide-y divide-border">
              {searchResults.map((o) => (
                <li key={o.orderNumber}>
                  <button
                    onClick={() => setOpen({ job: siteVisitJobOf(o), startNew: true })}
                    className="w-full text-left px-4 py-3 active:bg-surface"
                  >
                    <p className="text-sm font-medium truncate">{o.customerName || o.accountName || "—"}</p>
                    <p className="text-xs text-muted truncate">
                      #{o.orderNumber} · {o.workOrderType}
                      {o.scheduledStart ? ` · ${formatDateShort(o.scheduledStart)}` : ""}
                      {o.address ? ` · ${o.address}` : ""}
                    </p>
                    <p className="mt-1 text-xs font-medium text-orange-700 dark:text-orange-400">Log a visit</p>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : visits === null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : shown.length === 0 ? (
          <div className="px-6 py-10 text-center space-y-1">
            <p className="font-medium">No visits logged yet</p>
            <p className="text-sm text-muted">
              Search for a job above, or tap “Log Job Site Visit” on a job’s tile in the calendar.
            </p>
          </div>
        ) : (
          byMonth.map(([ym, rows]) => (
            <section key={ym}>
              <h2 className="sticky top-0 bg-surface border-b border-border px-4 py-1.5 text-xs font-semibold text-muted">
                {monthLabel(ym)} · {rows.length} visit{rows.length === 1 ? "" : "s"}
              </h2>
              <ul className="divide-y divide-border">
                {rows.map((v) => (
                  <li key={v.id}>
                    <button
                      onClick={() => setOpen({ job: v, startNew: false })}
                      className="w-full text-left px-4 py-3 active:bg-surface"
                    >
                      <div className="flex items-baseline gap-2">
                        <p className="text-sm font-medium truncate flex-1">{v.job_name || `#${v.order_number}`}</p>
                        <span className="shrink-0 text-xs text-muted">{formatDateShort(v.visit_date)}</span>
                      </div>
                      <p className="text-xs text-muted truncate">
                        #{v.order_number}
                        {v.address ? ` · ${v.address}` : ""}
                        {who === "all" ? ` · ${v.created_by.toLowerCase() === me ? "You" : visitBy(v)}` : ""}
                      </p>
                      <p className="mt-1 text-sm line-clamp-2 whitespace-pre-wrap">{v.notes}</p>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      {open && <SiteVisitPopup job={open.job} startNew={open.startNew} onClose={() => setOpen(null)} />}
      <BottomNav />
    </div>
  );
}
