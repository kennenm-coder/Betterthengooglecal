"use client";

// The More for More Submitter's tab: every install that has happened, with how
// long ago it was installed and whether a sheet is in for it. They put in the
// ones that are missing; submitting approves the sheet on the spot.
//
// Oldest first, because the longer a job has waited the more it matters.
// A job that already has a sheet from anyone else is shown but not opened:
// there is one sheet per job, and the database refuses a second.

import { useEffect, useMemo, useState } from "react";
import { differenceInCalendarDays } from "date-fns";
import Link from "next/link";
import { BadgeDollarSign, Search, X, Loader2, ChevronRight, Inbox } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import MoreForMoreForm from "@/components/MoreForMoreForm";
import { useData } from "@/components/DataProvider";
import { useAuth } from "@/hooks/useAuth";
import { refreshMfmNotices } from "@/hooks/useMfmNotices";
import { crewsForDate } from "@/lib/format-utils";
import { searchOrders } from "@/lib/search";
import { formatDateShort } from "@/lib/calendar-utils";
import type { WorkOrder } from "@/lib/types";
import {
  fetchJobFlags,
  fetchJobSheetStatuses,
  fetchMoreForMores,
  money,
  snapshotOf,
  type JobFlag,
  type JobSheetStatus,
  type JobSnapshot,
  type MoreForMore,
} from "@/lib/more-for-more";

type Filter = "todo" | "mine" | "covered" | "all";

/**
 * Hard starting point (Kennen, 2026-11-17): only jobs whose LAST install day is
 * on or after this date belong on the submitter's list, so nobody has to back
 * date the old ones. A job that finished 11/16 counts.
 */
export const SUBMITTER_START_DATE = "2026-11-16";

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

/** Days since the install's last day, as "today", "1 day ago", "12 days ago". */
function ageLabel(days: number): string {
  if (days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** How loudly the age is drawn: quiet at first, amber after 3 days, red after 7. */
function ageClass(days: number): string {
  if (days >= 7) return "bg-danger/15 text-danger";
  if (days >= 3) return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  return "bg-surface border border-border text-muted";
}

const STATUS_LABEL: Record<string, [string, string]> = {
  draft: ["IN PROGRESS", "bg-slate-500/15 text-slate-600 dark:text-slate-300"],
  submitted: ["WITH OFFICE", "bg-blue-500/15 text-blue-600 dark:text-blue-400"],
  rejected: ["SENT BACK", "bg-danger text-white"],
  completed: ["APPROVED", "bg-rba-green/15 text-rba-green"],
};

export default function MoreForMoreSubmitter() {
  const { user } = useAuth();
  const { orders, loading: dataLoading, loadingBackground } = useData();
  const email = user?.email?.toLowerCase() || "";

  const [statuses, setStatuses] = useState<Map<string, JobSheetStatus>>(new Map());
  const [flags, setFlags] = useState<Map<string, JobFlag>>(new Map());
  // The sheets this login made, in full, so they can be reopened and fixed.
  const [mine, setMine] = useState<MoreForMore[]>([]);
  const [loadingSheets, setLoadingSheets] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [filter, setFilter] = useState<Filter>("todo");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [open, setOpen] = useState<{ job: JobSnapshot; order: WorkOrder | null; sheet: MoreForMore | null } | null>(null);
  // ?open=<sheet id> — a "sent back" notice on the calendar links straight here.
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("open");
    if (id) setOpenId(id);
  }, []);

  async function reload() {
    try {
      const [st, sheets] = await Promise.all([fetchJobSheetStatuses(), fetchMoreForMores({ mineOnly: email })]);
      setStatuses(st);
      setMine(sheets);
      setLoadError("");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load the list.");
    } finally {
      setLoadingSheets(false);
    }
  }

  useEffect(() => {
    if (!email) return;
    reload();
    fetchJobFlags().then(setFlags);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  const mineByJob = useMemo(() => new Map(mine.map((s) => [s.order_number, s])), [mine]);

  // Installs that have happened (today counts), oldest first.
  const rows = useMemo(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const cutoff = end.toISOString().slice(0, 19);
    const pool = query.trim().length >= 2 ? searchOrders(orders, query.trim()) : orders;
    const today = new Date();
    return latestPerJob(
      pool.filter((o) => o.workOrderType === "Install" && o.scheduledStart && o.scheduledStart <= cutoff)
    )
      // latestPerJob kept each job's last day, so this is "finished on or after".
      .filter((o) => (o.scheduledStart || "").slice(0, 10) >= SUBMITTER_START_DATE)
      .filter((o) => !from || (o.scheduledStart || "").slice(0, 10) >= from)
      .filter((o) => !flags.get(o.orderNumber)?.excluded || statuses.has(o.orderNumber))
      .map((o) => ({
        order: o,
        status: statuses.get(o.orderNumber) || null,
        sheet: mineByJob.get(o.orderNumber) || null,
        paper: !!flags.get(o.orderNumber)?.paper,
        days: Math.max(0, differenceInCalendarDays(today, new Date(o.scheduledStart as string))),
      }))
      .sort((a, b) => (a.order.scheduledStart || "").localeCompare(b.order.scheduledStart || ""));
  }, [orders, query, from, flags, statuses, mineByJob]);

  // Mine that I can still act on: not done, or approved but payroll hasn't opened it.
  const canEditMine = (s: MoreForMore | null) =>
    !!s && (s.status === "draft" || s.status === "rejected" || (s.status === "completed" && !!s.auto_approved));

  const isTodo = (r: (typeof rows)[number]) =>
    (!r.status && !r.paper) || (r.status?.mine && (r.status.status === "draft" || r.status.status === "rejected"));

  const counts = useMemo(
    () => ({
      todo: rows.filter(isTodo).length,
      mine: rows.filter((r) => r.status?.mine).length,
      covered: rows.filter((r) => r.status || r.paper).length,
      all: rows.length,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows]
  );

  const shown = rows.filter((r) =>
    filter === "todo" ? isTodo(r) : filter === "mine" ? r.status?.mine : filter === "covered" ? r.status || r.paper : true
  );

  // Open the sheet a notice linked to, once the list has it.
  useEffect(() => {
    if (!openId || loadingSheets) return;
    const sheet = mine.find((s) => s.id === openId);
    if (sheet) {
      setOpen({
        job: {
          order_number: sheet.order_number,
          work_order_number: sheet.work_order_number,
          job_name: sheet.job_name,
          address: sheet.address,
          install_date: sheet.install_date,
          crew_name: sheet.crew_name,
        },
        order: orders.find((o) => o.orderNumber === sheet.order_number) || null,
        sheet,
      });
    }
    setOpenId(null);
    window.history.replaceState(null, "", "/more-for-more");
  }, [openId, mine, loadingSheets, orders]);

  function openRow(r: (typeof rows)[number]) {
    // Someone else's sheet, or one on paper, is not mine to touch.
    if (r.paper && !r.status) return;
    if (r.status && !r.status.mine) return;
    if (r.sheet && !canEditMine(r.sheet)) return;
    const crew = crewsForDate(r.order)[0] || null;
    setOpen({ job: snapshotOf(r.order, crew), order: r.order, sheet: r.sheet });
  }

  function onSaved() {
    // Refetch so the job's status (and "mine") is exactly what the database says.
    reload();
    refreshMfmNotices();
  }

  const loading = loadingSheets || (dataLoading && orders.length === 0);

  return (
    <div className="flex flex-col h-full">
      <header className="bg-background border-b border-border px-3 pt-3 pb-2 z-20 space-y-2">
        <div className="flex items-center gap-2">
          <BadgeDollarSign className="w-5 h-5 text-rba-green" />
          <h1 className="text-lg font-semibold flex-1">More for More</h1>
          {/* The office side: finish leads' sheets, send back, downloads. */}
          <Link
            href="/time-off?tab=mfm"
            className="shrink-0 flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted hover:text-foreground hover:bg-surface"
            title="Finish leads' sheets, send them back, and download PDFs or Excel"
          >
            <Inbox className="w-4 h-4" />
            Office
          </Link>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, job #, WO#, address, crew"
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
        <div className="flex items-end gap-2">
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar flex-1 min-w-0">
            {(
              [
                ["todo", `To submit ${counts.todo}`],
                ["mine", `Mine ${counts.mine}`],
                ["covered", `Has sheet ${counts.covered}`],
                ["all", `All ${counts.all}`],
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
          <label className="shrink-0 space-y-0.5">
            <span className="block text-[10px] text-muted leading-none">Installed from</span>
            <input
              type="date"
              min={SUBMITTER_START_DATE}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-border bg-surface px-2 py-1 text-xs"
            />
          </label>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        {loadError && <p className="px-4 py-3 text-sm text-danger">{loadError}</p>}
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted" />
          </div>
        ) : shown.length === 0 ? (
          <div className="px-6 py-14 text-center space-y-1">
            <BadgeDollarSign className="w-10 h-10 text-muted/40 mx-auto" />
            <p className="text-sm text-muted">
              {filter === "todo" ? "Every install shown has a More for More, or is on paper." : "Nothing here."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {shown.slice(0, 300).map((r) => {
              const o = r.order;
              const crew = crewsForDate(o).join(", ");
              const pill = r.status ? STATUS_LABEL[r.status.status] : null;
              const tappable =
                !(r.paper && !r.status) && !(r.status && !r.status.mine) && !(r.sheet && !canEditMine(r.sheet));
              return (
                <li key={o.orderNumber}>
                  <button
                    onClick={() => openRow(r)}
                    disabled={!tappable}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface disabled:hover:bg-transparent disabled:cursor-default"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{o.customerName || o.accountName || "—"}</p>
                      <p className="text-xs text-muted truncate">
                        #{o.orderNumber}
                        {o.scheduledStart ? ` · ${formatDateShort(o.scheduledStart)}` : ""}
                        {crew ? ` · ${crew}` : ""}
                        {r.sheet ? ` · ${money(r.sheet.final_total ?? r.sheet.lead_total)}` : ""}
                      </p>
                      {r.status && !r.status.mine && r.status.name && (
                        <p className="text-[11px] text-muted truncate">Sheet is under {r.status.name}</p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${ageClass(r.days)}`}
                      title="Time since this job's last install day"
                    >
                      {ageLabel(r.days)}
                    </span>
                    {pill ? (
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${pill[1]}`}>{pill[0]}</span>
                    ) : r.paper ? (
                      <span className="shrink-0 rounded-full bg-surface border border-border px-2 py-0.5 text-[10px] font-semibold text-muted">
                        ON PAPER
                      </span>
                    ) : null}
                    {tappable && <ChevronRight className="w-4 h-4 text-muted shrink-0" />}
                  </button>
                </li>
              );
            })}
            {shown.length > 300 && (
              <li className="px-4 py-3 text-xs text-muted text-center">
                Showing the oldest 300 of {shown.length}. Narrow it with the date or search.
              </li>
            )}
          </ul>
        )}
        {loadingBackground && <p className="px-4 py-2 text-[11px] text-muted text-center">Older jobs are still loading…</p>}
      </div>

      <BottomNav />

      {open && (
        <MoreForMoreForm
          mode="submitter"
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
