"use client";

// Payroll's side of More for More, on the Time Off screen's second tab:
//   Needs office — sheets leads have submitted (or resubmitted) that payroll
//                  has not finished, oldest first.
//   In progress  — drafts and sheets sent back; waiting on the lead.
//   Completed    — finished sheets, filterable by SUBMITTED date (when the
//                  lead last sent it in), downloadable as one Excel workbook
//                  for the range, grouped by installer.
// Opening any sheet gives the full form in office mode.

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import Link from "next/link";
import {
  Loader2,
  Search,
  X,
  FileSpreadsheet,
  ChevronRight,
  Inbox,
  RotateCcw,
  BadgeDollarSign,
  Settings,
} from "lucide-react";
import MoreForMoreForm from "@/components/MoreForMoreForm";
import MoreForMoreJobs from "@/components/MoreForMoreJobs";
import type { WorkOrder } from "@/lib/types";
import { fetchMoreForMores, money, type JobSnapshot, type MoreForMore } from "@/lib/more-for-more";

function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : format(d, "MMM d, yyyy");
}

/** Local calendar day of a timestamp, for comparing against date inputs. */
function localDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : format(d, "yyyy-MM-dd");
}

function matches(s: MoreForMore, q: string): boolean {
  if (!q) return true;
  const hay = [s.job_name, s.order_number, s.work_order_number, s.address, s.crew_name, s.created_by_name, s.created_by, s.lead_data.leadName, ...s.lead_data.apprentices.map((a) => a.name)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

export default function MoreForMoreOffice() {
  const [sheets, setSheets] = useState<MoreForMore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<"needs" | "progress" | "done" | "jobs">("needs");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState<MoreForMore | null>(null);
  // Typing in a paper sheet for a job that has none yet.
  const [paperJob, setPaperJob] = useState<{ job: JobSnapshot; order: WorkOrder } | null>(null);
  const [exporting, setExporting] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setSheets(await fetchMoreForMores());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load More for Mores.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const needs = useMemo(
    () =>
      sheets
        .filter((s) => s.status === "submitted" && matches(s, query.trim()))
        .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at)),
    [sheets, query]
  );

  const done = useMemo(
    () =>
      sheets
        .filter((s) => {
          if (s.status !== "completed" || !matches(s, query.trim())) return false;
          const day = localDay(s.submitted_at);
          if (from && day < from) return false;
          if (to && day > to) return false;
          return true;
        })
        .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at)),
    [sheets, query, from, to]
  );

  // With the lead: saved in progress, or sent back for a fix. Newest first.
  const progress = useMemo(
    () =>
      sheets
        .filter((s) => (s.status === "draft" || s.status === "rejected") && matches(s, query.trim()))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [sheets, query]
  );

  const needsCount = sheets.filter((s) => s.status === "submitted").length;
  const progressCount = sheets.filter((s) => s.status === "draft" || s.status === "rejected").length;
  const list = view === "needs" ? needs : view === "progress" ? progress : done;

  async function exportRange() {
    setExporting(true);
    try {
      const { downloadRangeXlsx } = await import("@/lib/more-for-more-export");
      await downloadRangeXlsx(done, from, to);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the Excel file.");
    } finally {
      setExporting(false);
    }
  }

  function onSaved(s: MoreForMore) {
    // Updated in place, or added (a paper sheet just typed in).
    setSheets((prev) => (prev.some((p) => p.id === s.id) ? prev.map((p) => (p.id === s.id ? s : p)) : [s, ...prev]));
    setOpen((cur) => (cur && cur.id === s.id ? s : cur));
  }

  const viewBtn = (key: typeof view, label: string, title?: string) => (
    <button
      onClick={() => setView(key)}
      title={title}
      className={`rounded-lg px-2 py-2 text-sm font-medium border truncate ${
        view === key ? "border-rba-green bg-rba-green/10 text-rba-green" : "border-border text-muted"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-3xl mx-auto w-full">
        <div className="px-3 pt-3 space-y-2 sticky top-0 bg-background z-10 pb-2 border-b border-border">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {viewBtn("needs", `Needs office${needsCount ? ` (${needsCount})` : ""}`)}
            {viewBtn(
              "progress",
              `In progress${progressCount ? ` (${progressCount})` : ""}`,
              "Saved in progress by the lead, or sent back to them"
            )}
            {viewBtn("done", "Completed")}
            {viewBtn("jobs", "Jobs", "Every install, and whether its More for More is in")}
          </div>
          <div className="flex items-center gap-2">
            {view === "jobs" && <div className="flex-1" />}
            <div className={`relative flex-1 min-w-0 ${view === "jobs" ? "hidden" : ""}`}>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search job, job #, lead, apprentice"
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
            {/* Bonus rates and the people list the form suggests. */}
            <Link
              href="/more-for-more/settings"
              className="shrink-0 flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted hover:text-foreground hover:bg-surface"
              title="More for More settings: bonus rates and people"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden min-[400px]:inline">Settings</span>
            </Link>
          </div>
          {view === "done" && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex-1 min-w-[120px] space-y-0.5">
                <span className="text-[11px] text-muted">Submitted from</span>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
                />
              </label>
              <label className="flex-1 min-w-[120px] space-y-0.5">
                <span className="text-[11px] text-muted">Submitted to</span>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
                />
              </label>
              <button
                onClick={exportRange}
                disabled={exporting || done.length === 0}
                className="flex items-center gap-1.5 rounded-lg bg-rba-green px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                title="One workbook: a Summary tab plus each bonus sheet filled in"
              >
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                Excel ({done.length})
              </button>
            </div>
          )}
        </div>

        {error && <p className="px-4 py-3 text-sm text-danger">{error}</p>}

        {view === "jobs" ? (
          loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted" />
            </div>
          ) : (
            <MoreForMoreJobs
              sheets={sheets}
              onOpenSheet={setOpen}
              onEnterPaper={(job, order) => setPaperJob({ job, order })}
            />
          )
        ) : loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted" />
          </div>
        ) : list.length === 0 ? (
          <div className="px-6 py-14 text-center space-y-1">
            {view === "needs" ? (
              <>
                <Inbox className="w-10 h-10 text-muted/40 mx-auto" />
                <p className="text-sm text-muted">Nothing waiting on the office.</p>
              </>
            ) : view === "progress" ? (
              <>
                <Inbox className="w-10 h-10 text-muted/40 mx-auto" />
                <p className="text-sm text-muted">No sheets in progress or sent back.</p>
              </>
            ) : (
              <>
                <BadgeDollarSign className="w-10 h-10 text-muted/40 mx-auto" />
                <p className="text-sm text-muted">
                  {from || to || query ? "No completed sheets match." : "No completed sheets yet."}
                </p>
              </>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((s) => (
              <li key={s.id}>
                <button onClick={() => setOpen(s)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-sm font-medium truncate">{s.job_name || "—"}</p>
                      {s.status === "submitted" && s.submit_count > 1 && (
                        <span
                          className="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400"
                          title="The lead changed it after it was sent in. Your earlier answers are kept; check them again."
                        >
                          <RotateCcw className="w-2.5 h-2.5" /> RESUBMITTED
                        </span>
                      )}
                      {s.status === "rejected" && (
                        <span
                          className="shrink-0 rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-semibold text-white"
                          title={s.reject_reason || undefined}
                        >
                          SENT BACK
                        </span>
                      )}
                      {s.status === "draft" && (
                        <span className="shrink-0 rounded-full bg-slate-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                          IN PROGRESS
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted truncate">
                      #{s.order_number} · {s.lead_data.leadName || s.created_by_name || s.created_by}
                      {s.lead_data.apprentices.length ? ` + ${s.lead_data.apprentices.length}` : ""} · submitted {fmtDay(s.submitted_at)}
                      {s.status === "completed" && s.completed_at ? ` · done ${fmtDay(s.completed_at)}` : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold tabular-nums">
                      {money(s.status === "completed" ? s.final_total : s.lead_total)}
                    </p>
                    <p className="text-[10px] text-muted">
                      {s.status === "completed" ? "final pay" : s.status === "submitted" ? "submitted" : "so far"}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {open && (
        <MoreForMoreForm
          key={open.id + open.updated_at}
          mode="office"
          job={{
            order_number: open.order_number,
            work_order_number: open.work_order_number,
            job_name: open.job_name,
            address: open.address,
            install_date: open.install_date,
            crew_name: open.crew_name,
          }}
          sheet={open}
          onClose={() => setOpen(null)}
          onSaved={onSaved}
          onDeleted={(id) => setSheets((prev) => prev.filter((p) => p.id !== id))}
        />
      )}

      {paperJob && (
        <MoreForMoreForm
          mode="office"
          job={paperJob.job}
          order={paperJob.order}
          sheet={null}
          onClose={() => setPaperJob(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
