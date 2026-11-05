"use client";

// Payroll's Jobs view: every install that has happened, and whether a More for
// More is in for it.
//   - Status comes from any sheet on that job (a lead's, or one payroll typed in).
//   - "Paper" marks a job whose sheet came in on paper; "Enter it" types it in.
//   - Admin only, temporary: Exclude a job, or every job shown at once, to clear
//     out deals from before More for More moved into the app. Excluded jobs
//     also drop off the leads' lists.

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Loader2, Search, X, EyeOff, Eye, FileText, ChevronRight, Ban } from "lucide-react";
import { useData } from "@/components/DataProvider";
import { useAuth } from "@/hooks/useAuth";
import { isAdmin } from "@/lib/roles";
import { crewsForDate } from "@/lib/format-utils";
import { searchOrders } from "@/lib/search";
import type { WorkOrder } from "@/lib/types";
import {
  fetchJobFlags,
  setJobFlags,
  snapshotOf,
  type JobFlag,
  type JobSnapshot,
  type MoreForMore,
} from "@/lib/more-for-more";

type Filter = "missing" | "all" | "paper" | "in" | "excluded";

const STATUS_PILL: Record<string, [string, string]> = {
  draft: ["IN PROGRESS", "bg-slate-500/15 text-slate-600 dark:text-slate-300"],
  submitted: ["NEEDS OFFICE", "bg-blue-500/15 text-blue-600 dark:text-blue-400"],
  rejected: ["SENT BACK", "bg-danger text-white"],
  completed: ["COMPLETED", "bg-rba-green/15 text-rba-green"],
};

/** The sheet that best describes a job: completed beats waiting beats in progress. */
function bestSheet(list: MoreForMore[] | undefined): MoreForMore | null {
  if (!list?.length) return null;
  const rank: Record<string, number> = { completed: 0, submitted: 1, rejected: 2, draft: 3 };
  return [...list].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || b.updated_at.localeCompare(a.updated_at))[0];
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

export default function MoreForMoreJobs({
  sheets,
  onOpenSheet,
  onEnterPaper,
}: {
  sheets: MoreForMore[];
  onOpenSheet: (s: MoreForMore) => void;
  onEnterPaper: (job: JobSnapshot, order: WorkOrder) => void;
}) {
  const { roles } = useAuth();
  const admin = isAdmin(roles);
  const { orders, loading: dataLoading, loadingBackground } = useData();
  const [flags, setFlags] = useState<Map<string, JobFlag>>(new Map());
  const [flagsLoading, setFlagsLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("missing");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);

  useEffect(() => {
    let live = true;
    fetchJobFlags()
      .then((f) => live && setFlags(f))
      .finally(() => live && setFlagsLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const sheetsByJob = useMemo(() => {
    const m = new Map<string, MoreForMore[]>();
    for (const s of sheets) {
      if (!m.has(s.order_number)) m.set(s.order_number, []);
      m.get(s.order_number)!.push(s);
    }
    return m;
  }, [sheets]);

  // Installs that have happened (today counts), newest first.
  const jobs = useMemo(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const cutoff = end.toISOString().slice(0, 19);
    const pool = query.trim().length >= 2 ? searchOrders(orders, query.trim()) : orders;
    return latestPerJob(pool.filter((o) => o.workOrderType === "Install" && o.scheduledStart && o.scheduledStart <= cutoff))
      .sort((a, b) => (b.scheduledStart || "").localeCompare(a.scheduledStart || ""));
  }, [orders, query]);

  const rows = useMemo(
    () =>
      jobs
        .filter((o) => {
          const day = (o.scheduledStart || "").slice(0, 10);
          if (from && day < from) return false;
          if (to && day > to) return false;
          return true;
        })
        .map((o) => ({
          order: o,
          sheet: bestSheet(sheetsByJob.get(o.orderNumber)),
          flag: flags.get(o.orderNumber),
        })),
    [jobs, from, to, sheetsByJob, flags]
  );

  const counts = useMemo(() => {
    const live = rows.filter((r) => !r.flag?.excluded);
    return {
      missing: live.filter((r) => !r.sheet && !r.flag?.paper).length,
      all: live.length,
      paper: live.filter((r) => r.flag?.paper).length,
      in: live.filter((r) => r.sheet).length,
      excluded: rows.filter((r) => r.flag?.excluded).length,
    };
  }, [rows]);

  const shown = rows.filter((r) => {
    if (filter === "excluded") return !!r.flag?.excluded;
    if (r.flag?.excluded) return false;
    if (filter === "missing") return !r.sheet && !r.flag?.paper;
    if (filter === "paper") return !!r.flag?.paper;
    if (filter === "in") return !!r.sheet;
    return true;
  });

  async function update(orderNumbers: string[], patch: Partial<Pick<JobFlag, "paper" | "excluded">>, key: string) {
    setBusy(key);
    setError("");
    try {
      const saved = await setJobFlags(orderNumbers, patch, flags);
      setFlags((prev) => {
        const next = new Map(prev);
        for (const f of saved) next.set(f.order_number, f);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(null);
    }
  }

  // "Exclude all shown" skips jobs that already have a sheet: those are real.
  const excludable = shown.filter((r) => !r.sheet && !r.flag?.excluded).map((r) => r.order.orderNumber);
  const loading = flagsLoading || (dataLoading && orders.length === 0);

  return (
    <div>
      <div className="px-3 pt-2 pb-2 space-y-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search job name, job #, address, crew"
            className="w-full pl-9 pr-9 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-border"
              aria-label="Clear search"
            >
              <X className="w-4 h-4 text-muted" />
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <label className="flex-1 min-w-0 space-y-0.5">
            <span className="text-[11px] text-muted">Installed from</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" />
          </label>
          <label className="flex-1 min-w-0 space-y-0.5">
            <span className="text-[11px] text-muted">Installed to</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" />
          </label>
        </div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {(
            [
              ["missing", `Missing ${counts.missing}`],
              ["in", `Has sheet ${counts.in}`],
              ["paper", `On paper ${counts.paper}`],
              ["all", `All ${counts.all}`],
              ...(admin ? ([["excluded", `Excluded ${counts.excluded}`]] as const) : []),
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                setFilter(key);
                setConfirmAll(false);
              }}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium border ${
                filter === key ? "bg-foreground text-background border-foreground" : "border-border text-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Admin only, temporary: clear out old deals in one go. */}
        {admin && filter !== "excluded" && excludable.length > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs space-y-1.5">
            {confirmAll ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex-1 min-w-[160px]">
                  Exclude {excludable.length} job{excludable.length === 1 ? "" : "s"} shown that have no sheet? Leads stop
                  seeing them too. You can un-exclude from the Excluded list.
                </span>
                <button onClick={() => setConfirmAll(false)} className="px-2 py-1 text-muted">
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    await update(excludable, { excluded: true }, "all");
                    setConfirmAll(false);
                  }}
                  disabled={busy === "all"}
                  className="rounded-md bg-amber-600 px-2.5 py-1 font-semibold text-white"
                >
                  {busy === "all" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : `Exclude ${excludable.length}`}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="flex-1 text-amber-800 dark:text-amber-300">Admin: clear out old deals</span>
                <button
                  onClick={() => setConfirmAll(true)}
                  className="flex items-center gap-1 rounded-md border border-amber-600/50 px-2.5 py-1 font-semibold text-amber-800 dark:text-amber-300"
                >
                  <Ban className="w-3.5 h-3.5" /> Exclude all shown ({excludable.length})
                </button>
              </div>
            )}
          </div>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted" />
        </div>
      ) : shown.length === 0 ? (
        <p className="px-6 py-14 text-center text-sm text-muted">
          {filter === "missing" ? "Every install shown has a More for More, or is on paper." : "No jobs here."}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.slice(0, 300).map(({ order: o, sheet, flag }) => {
            const crew = crewsForDate(o).join(", ");
            const pill = sheet ? STATUS_PILL[sheet.status] : null;
            return (
              <li key={o.orderNumber} className={`px-4 py-2.5 ${flag?.excluded ? "opacity-60" : ""}`}>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => sheet && onOpenSheet(sheet)}
                    disabled={!sheet}
                    className="flex-1 min-w-0 text-left disabled:cursor-default"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-sm font-medium truncate">{o.customerName || o.accountName || "—"}</p>
                      {pill && (
                        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${pill[1]}`}>
                          {pill[0]}
                        </span>
                      )}
                      {sheet?.on_paper && (
                        <span className="shrink-0 rounded-full bg-surface border border-border px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                          TYPED IN
                        </span>
                      )}
                      {!sheet && !flag?.paper && !flag?.excluded && (
                        <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                          MISSING
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted truncate">
                      #{o.orderNumber}
                      {o.scheduledStart ? ` · ${format(new Date(o.scheduledStart), "MMM d, yyyy")}` : ""}
                      {crew ? ` · ${crew}` : ""}
                    </p>
                  </button>
                  {sheet && <ChevronRight className="w-4 h-4 text-muted shrink-0" />}
                </div>

                <div className="mt-1.5 flex items-center gap-3 text-xs">
                  {!flag?.excluded && (
                    <label className="flex items-center gap-1.5 text-muted">
                      <input
                        type="checkbox"
                        checked={!!flag?.paper}
                        disabled={busy === o.orderNumber}
                        onChange={(e) => update([o.orderNumber], { paper: e.target.checked }, o.orderNumber)}
                      />
                      Turned in on paper
                    </label>
                  )}
                  {flag?.paper && !sheet && (
                    <button
                      onClick={() => onEnterPaper(snapshotOf(o, crewsForDate(o)[0] || null), o)}
                      className="flex items-center gap-1 rounded-md bg-rba-green px-2 py-1 font-semibold text-white"
                    >
                      <FileText className="w-3.5 h-3.5" /> Enter it
                    </button>
                  )}
                  {busy === o.orderNumber && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted" />}
                  {admin && (
                    <button
                      onClick={() => update([o.orderNumber], { excluded: !flag?.excluded }, o.orderNumber)}
                      disabled={busy === o.orderNumber}
                      className="ml-auto flex items-center gap-1 text-muted hover:text-foreground"
                      title="Admin only: leave this job out of More for More"
                    >
                      {flag?.excluded ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      {flag?.excluded ? "Include" : "Exclude"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
          {shown.length > 300 && (
            <li className="px-4 py-3 text-xs text-muted text-center">
              Showing 300 of {shown.length}. Narrow it with the dates or search.
            </li>
          )}
        </ul>
      )}
      {loadingBackground && (
        <p className="px-4 py-2 text-[11px] text-muted text-center">Older jobs are still loading…</p>
      )}
    </div>
  );
}
