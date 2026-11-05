"use client";

// The install lead's More for More tab: every install their crew has done,
// with whether a sheet is in for it yet, plus a search so they can put one in
// for any job — even one they were not scheduled on.

import { useEffect, useMemo, useState } from "react";
import { BadgeDollarSign, Search, X, Loader2, ShieldX, ChevronRight } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import MoreForMoreForm from "@/components/MoreForMoreForm";
import { useData } from "@/components/DataProvider";
import { useAuth } from "@/hooks/useAuth";
import { canFillMoreForMore } from "@/lib/roles";
import { crewsForDate, ownsOrder } from "@/lib/format-utils";
import { searchOrders } from "@/lib/search";
import { formatDateShort } from "@/lib/calendar-utils";
import type { WorkOrder } from "@/lib/types";
import {
  fetchMoreForMores,
  money,
  snapshotOf,
  type JobSnapshot,
  type MoreForMore,
} from "@/lib/more-for-more";

type Open = { job: JobSnapshot; order: WorkOrder | null; sheet: MoreForMore | null };

function StatusPill({ sheet }: { sheet: MoreForMore | null }) {
  if (!sheet) {
    return (
      <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
        NOT SUBMITTED
      </span>
    );
  }
  if (sheet.status === "completed") {
    return (
      <span className="shrink-0 rounded-full bg-rba-green/15 px-2 py-0.5 text-[10px] font-semibold text-rba-green">
        COMPLETED
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-400">
      WITH OFFICE
    </span>
  );
}

/** One row per job: a multi-day install arrives as several appointments. */
function latestPerJob(orders: WorkOrder[]): WorkOrder[] {
  const byJob = new Map<string, WorkOrder>();
  for (const o of orders) {
    if (!o.orderNumber) continue;
    const prev = byJob.get(o.orderNumber);
    if (!prev || (o.scheduledStart || "") > (prev.scheduledStart || "")) byJob.set(o.orderNumber, o);
  }
  return Array.from(byJob.values());
}

export default function MoreForMorePage() {
  const { roles, user, crewNames, loading: authLoading } = useAuth();
  const { orders, loading: dataLoading } = useData();
  const [sheets, setSheets] = useState<MoreForMore[]>([]);
  const [sheetsLoading, setSheetsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Open | null>(null);
  const [filter, setFilter] = useState<"all" | "todo" | "office" | "done">("all");

  const email = user?.email?.toLowerCase() || "";
  const allowed = canFillMoreForMore(roles);

  useEffect(() => {
    if (!email || !allowed) return;
    let live = true;
    fetchMoreForMores({ mineOnly: email })
      .then((s) => live && setSheets(s))
      .catch((e) => live && setLoadError(e instanceof Error ? e.message : "Could not load your sheets."))
      .finally(() => live && setSheetsLoading(false));
    return () => {
      live = false;
    };
  }, [email, allowed]);

  const sheetByJob = useMemo(() => new Map(sheets.map((s) => [s.order_number, s])), [sheets]);

  // Installs this crew has already been on (today counts), newest first.
  const myJobs = useMemo(() => {
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const cutoff = endOfToday.toISOString().slice(0, 19);
    const mine = orders.filter(
      (o) =>
        o.workOrderType === "Install" &&
        o.scheduledStart &&
        o.scheduledStart <= cutoff &&
        ownsOrder(o, crewNames)
    );
    return latestPerJob(mine).sort((a, b) => (b.scheduledStart || "").localeCompare(a.scheduledStart || ""));
  }, [orders, crewNames]);

  type Row = { key: string; job: JobSnapshot; order: WorkOrder | null; sheet: MoreForMore | null; date: string };

  // My jobs, plus any job I sent a sheet in for that isn't one of them
  // (found through search, or older than what's loaded).
  const rows: Row[] = useMemo(() => {
    const out: Row[] = myJobs.map((o) => {
      const mineLower = new Set(crewNames.map((n) => n.trim().toLowerCase()));
      const all = crewsForDate(o);
      const crew = all.find((n) => mineLower.has(n.trim().toLowerCase())) || all[0] || null;
      return {
        key: o.orderNumber,
        job: snapshotOf(o, crew),
        order: o,
        sheet: sheetByJob.get(o.orderNumber) || null,
        date: o.scheduledStart || "",
      };
    });
    const seen = new Set(out.map((r) => r.key));
    for (const s of sheets) {
      if (seen.has(s.order_number)) continue;
      out.push({
        key: s.order_number,
        job: {
          order_number: s.order_number,
          work_order_number: s.work_order_number,
          job_name: s.job_name,
          address: s.address,
          install_date: s.install_date,
          crew_name: s.crew_name,
        },
        order: orders.find((o) => o.orderNumber === s.order_number) || null,
        sheet: s,
        date: s.install_date || s.created_at,
      });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }, [myJobs, sheets, sheetByJob, orders, crewNames]);

  const counts = useMemo(
    () => ({
      todo: rows.filter((r) => !r.sheet).length,
      office: rows.filter((r) => r.sheet?.status === "submitted").length,
      done: rows.filter((r) => r.sheet?.status === "completed").length,
    }),
    [rows]
  );

  const shownRows = rows.filter((r) =>
    filter === "all"
      ? true
      : filter === "todo"
        ? !r.sheet
        : filter === "office"
          ? r.sheet?.status === "submitted"
          : r.sheet?.status === "completed"
  );

  const trimmed = query.trim();
  const searchResults = useMemo(() => {
    if (trimmed.length < 2) return [];
    return latestPerJob(searchOrders(orders, trimmed)).slice(0, 40);
  }, [orders, trimmed]);

  function openOrder(o: WorkOrder) {
    const crew = crewsForDate(o)[0] || null;
    setOpen({ job: snapshotOf(o, crew), order: o, sheet: sheetByJob.get(o.orderNumber) || null });
  }

  function onSaved(s: MoreForMore) {
    setSheets((prev) => [s, ...prev.filter((p) => p.id !== s.id)]);
  }

  if (authLoading) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div className="space-y-2">
            <ShieldX className="w-12 h-12 text-muted mx-auto" />
            <p className="font-medium">More for More is for install leads</p>
            <p className="text-sm text-muted">Ask an admin to add the Installer Lead role to your account.</p>
          </div>
        </div>
        <BottomNav />
      </div>
    );
  }

  const listLoading = sheetsLoading || (dataLoading && orders.length === 0);

  return (
    <div className="flex flex-col h-full">
      <header className="bg-background border-b border-border px-3 pt-3 pb-2 z-20 space-y-2">
        <div className="flex items-center gap-2">
          <BadgeDollarSign className="w-5 h-5 text-rba-green" />
          <h1 className="text-lg font-semibold flex-1">More for More</h1>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search any job: name, job #, WO#, address"
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
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
            {(
              [
                ["all", `All ${rows.length}`],
                ["todo", `Not submitted ${counts.todo}`],
                ["office", `With office ${counts.office}`],
                ["done", `Completed ${counts.done}`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium border ${
                  filter === key ? "bg-foreground text-background border-foreground" : "border-border text-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="flex-1 overflow-auto">
        {loadError && <p className="px-4 py-3 text-sm text-danger">{loadError}</p>}

        {trimmed ? (
          trimmed.length < 2 ? (
            <p className="px-4 py-6 text-sm text-muted text-center">Keep typing…</p>
          ) : searchResults.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted text-center">No jobs match “{trimmed}”.</p>
          ) : (
            <ul className="divide-y divide-border">
              {searchResults.map((o) => (
                <li key={o.orderNumber}>
                  <button onClick={() => openOrder(o)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{o.customerName || o.accountName || "—"}</p>
                      <p className="text-xs text-muted truncate">
                        #{o.orderNumber} · {o.workOrderType}
                        {o.scheduledStart ? ` · ${formatDateShort(o.scheduledStart)}` : ""}
                        {crewsForDate(o).length ? ` · ${crewsForDate(o).join(", ")}` : ""}
                      </p>
                    </div>
                    <StatusPill sheet={sheetByJob.get(o.orderNumber) || null} />
                    <ChevronRight className="w-4 h-4 text-muted shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : listLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted" />
          </div>
        ) : shownRows.length === 0 ? (
          <div className="px-6 py-14 text-center space-y-1">
            <BadgeDollarSign className="w-10 h-10 text-muted/40 mx-auto" />
            <p className="text-sm text-muted">
              {crewNames.length === 0
                ? "Your account isn't linked to a crew yet, so your jobs can't be listed. Ask an admin to set your scheduling resource. You can still search for a job above."
                : filter === "all"
                  ? "No installs on your crew yet. Search above to put one in for any job."
                  : "Nothing here."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {shownRows.map((r) => (
              <li key={r.key}>
                <button
                  onClick={() => setOpen({ job: r.job, order: r.order, sheet: r.sheet })}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{r.job.job_name || "—"}</p>
                    <p className="text-xs text-muted truncate">
                      #{r.job.order_number}
                      {r.job.install_date ? ` · ${formatDateShort(r.job.install_date)}` : ""}
                      {r.sheet ? ` · ${money(r.sheet.lead_total)}` : ""}
                    </p>
                  </div>
                  <StatusPill sheet={r.sheet} />
                  <ChevronRight className="w-4 h-4 text-muted shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <BottomNav />

      {open && (
        <MoreForMoreForm
          mode="lead"
          job={open.job}
          order={open.order}
          sheet={open.sheet}
          onClose={() => setOpen(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
