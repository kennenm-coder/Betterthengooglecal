"use client";

// The install lead's More for More tab: every install their crew has done,
// with whether a sheet is in for it yet, plus a search so they can put one in
// for any job — even one they were not scheduled on.

import { useEffect, useMemo, useState } from "react";
import { BadgeDollarSign, ClipboardCheck, Search, X, Loader2, ShieldX } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import MoreForMoreForm from "@/components/MoreForMoreForm";
import JobCompleteModal from "@/components/JobCompleteModal";
import JobCompleteTag from "@/components/JobCompleteTag";
import { useData } from "@/components/DataProvider";
import { useAuth } from "@/hooks/useAuth";
import { refreshMfmNotices } from "@/hooks/useMfmNotices";
import MoreForMoreSubmitter from "@/components/MoreForMoreSubmitter";
import { canFillMoreForMore, canSubmitJobComplete, isAdmin, isInstallerLead, isMfmSubmitter } from "@/lib/roles";
import { jobCompleteDue, jobCompleteNeeded, jobLastDays, localToday } from "@/lib/job-complete-core";
import type { JcTag } from "@/lib/job-complete";
import { crewsForDate, ownsOrder } from "@/lib/format-utils";
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

type Open = { job: JobSnapshot; order: WorkOrder | null; sheet: MoreForMore | null };

function StatusPill({
  sheet,
  paper,
  other,
}: {
  sheet: MoreForMore | null;
  paper?: boolean;
  /** Someone else's sheet on this job (056: one sheet per job). */
  other?: JobSheetStatus | null;
}) {
  if (!sheet && other) {
    return (
      <span
        className="shrink-0 max-w-[45%] truncate rounded-full bg-surface border border-border px-2 py-0.5 text-[10px] font-semibold text-muted"
        title={`Already submitted by ${other.name || "someone else"}`}
      >
        BY {(other.name || "SOMEONE ELSE").toUpperCase()}
      </span>
    );
  }
  if (!sheet && paper) {
    return (
      <span className="shrink-0 rounded-full bg-surface border border-border px-2 py-0.5 text-[10px] font-semibold text-muted">
        ON PAPER
      </span>
    );
  }
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
  if (sheet.status === "rejected") {
    return (
      <span className="shrink-0 rounded-full bg-danger px-2 py-0.5 text-[10px] font-semibold text-white">
        SENT BACK
      </span>
    );
  }
  if (sheet.status === "draft") {
    return (
      <span className="shrink-0 rounded-full bg-slate-500/15 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
        IN PROGRESS
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-400">
      WITH OFFICE
    </span>
  );
}

/** "To do" = no sheet yet (none on paper, none by anyone else), or one saved in progress. */
function isTodo(r: { sheet: MoreForMore | null; paper: boolean; other: JobSheetStatus | null }): boolean {
  return (!r.sheet && !r.paper && !r.other) || r.sheet?.status === "draft";
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

/**
 * The Submissions tab. An install lead sees their crew's jobs with BOTH things
 * they owe: the More for More sheet and the Job Complete report. A More for
 * More Submitter who isn't a lead gets the every-crew view (which approves on
 * submit). An admin is both at once, so they get a switch.
 */
export default function MoreForMorePage() {
  const { roles, loading } = useAuth();
  if (loading) return <LeadView />;
  if (isAdmin(roles)) return <AdminSwitch />;
  if (isMfmSubmitter(roles) && !isInstallerLead(roles)) return <MoreForMoreSubmitter />;
  return <LeadView />;
}

/** Admins can open both views: the submitter's, and the install lead's Submissions. */
function AdminSwitch() {
  const [view, setView] = useState<"submitter" | "lead">("submitter");
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border-b border-border text-xs">
        <span className="text-muted">View as</span>
        {(
          [
            ["submitter", "Submitter"],
            ["lead", "Install lead"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setView(k)}
            className={`rounded-full px-3 py-1 font-medium border ${
              view === k ? "bg-foreground text-background border-foreground" : "border-border text-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">{view === "lead" ? <LeadView /> : <MoreForMoreSubmitter />}</div>
    </div>
  );
}

/** One job's two submissions side by side: More for More, and Job Complete. */
function SubmissionRow({
  name,
  meta,
  sheet,
  paper,
  other,
  hasOrder,
  jcTag,
  jcLastDay,
  jcAllowed,
  onMfm,
  onJc,
}: {
  name: string;
  meta: string;
  sheet: MoreForMore | null;
  paper: boolean;
  other: JobSheetStatus | null;
  hasOrder: boolean;
  jcTag: JcTag | null;
  jcLastDay: string | null;
  /** The lead may file this job's Job Complete (their own job). */
  jcAllowed: boolean;
  onMfm: () => void;
  onJc: () => void;
}) {
  const due = jobCompleteDue(jcLastDay);
  const jcOpen = jcAllowed && hasOrder && (due || !!jcTag);
  return (
    <li className="px-4 py-3">
      <p className="text-sm font-medium truncate">{name || "—"}</p>
      <p className="text-xs text-muted truncate">{meta}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          onClick={onMfm}
          disabled={!!other}
          className="flex flex-col items-start gap-1 rounded-lg border border-border px-3 py-2 text-left active:bg-surface disabled:opacity-70"
        >
          <span className="flex items-center gap-1 text-xs font-semibold text-muted">
            <BadgeDollarSign className="w-3.5 h-3.5" /> More for More
          </span>
          <StatusPill sheet={sheet} paper={paper} other={other} />
        </button>
        {jcAllowed && hasOrder ? (
          <button
            onClick={onJc}
            disabled={!jcOpen}
            className="flex flex-col items-start gap-1 rounded-lg border border-border px-3 py-2 text-left active:bg-surface disabled:opacity-60"
          >
            <span className="flex items-center gap-1 text-xs font-semibold text-muted">
              <ClipboardCheck className="w-3.5 h-3.5" /> Job Complete
            </span>
            {jcTag ? (
              <JobCompleteTag tag={jcTag} compact />
            ) : due ? (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                NOT SUBMITTED
              </span>
            ) : (
              <span className="text-[10px] text-muted">
                {jcLastDay ? `Opens ${formatDateShort(jcLastDay)}` : "Opens on the last day"}
              </span>
            )}
          </button>
        ) : (
          <div />
        )}
      </div>
    </li>
  );
}

function LeadView() {
  const { roles, user, crewNames, loading: authLoading } = useAuth();
  const { orders, loading: dataLoading, completionFor } = useData();
  const [jcOpen, setJcOpen] = useState<WorkOrder | null>(null);
  const jcRole = canSubmitJobComplete(roles);
  // Each install's last scheduled day, once: a Job Complete opens on that day.
  const lastDays = useMemo(() => jobLastDays(orders), [orders]);
  const today = localToday();
  const [sheets, setSheets] = useState<MoreForMore[]>([]);
  const [sheetsLoading, setSheetsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Open | null>(null);
  const [filter, setFilter] = useState<"all" | "fix" | "mfm" | "jc" | "office" | "done">("all");
  // ?open=<sheet id> — a notice on the calendar links straight to a sheet.
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("open");
    if (id) setOpenId(id);
  }, []);

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

  // Jobs that already have a sheet from SOMEONE ELSE (another lead, the More
  // for More Submitter, or payroll). There is one sheet per job (056), so the
  // lead sees who has it instead of "Not submitted". No money comes back.
  const [statuses, setStatuses] = useState<Map<string, JobSheetStatus>>(new Map());
  useEffect(() => {
    if (!allowed) return;
    let live = true;
    // Best effort: without it the list just can't say who else has a job.
    fetchJobSheetStatuses()
      .then((m) => live && setStatuses(m))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [allowed, sheets]);
  const otherFor = (orderNumber: string): JobSheetStatus | null => {
    if (sheetByJob.has(orderNumber)) return null;
    const st = statuses.get(orderNumber);
    return st && !st.mine ? st : null;
  };

  // Payroll's marks: jobs whose sheet came in on paper, and (admin) jobs
  // excluded from More for More, which drop off this list.
  const [flags, setFlags] = useState<Map<string, JobFlag>>(new Map());
  useEffect(() => {
    if (!allowed) return;
    let live = true;
    fetchJobFlags().then((f) => live && setFlags(f));
    return () => {
      live = false;
    };
  }, [allowed]);

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

  type Row = {
    key: string;
    job: JobSnapshot;
    order: WorkOrder | null;
    sheet: MoreForMore | null;
    paper: boolean;
    other: JobSheetStatus | null;
    date: string;
  };

  // My jobs, plus any job I sent a sheet in for that isn't one of them
  // (found through search, or older than what's loaded). Excluded jobs are
  // left out unless I already have a sheet on them.
  const rows: Row[] = useMemo(() => {
    const mineLower = new Set(crewNames.map((n) => n.trim().toLowerCase()));
    const out: Row[] = myJobs
      .filter((o) => !flags.get(o.orderNumber)?.excluded || sheetByJob.has(o.orderNumber))
      .map((o) => {
        const all = crewsForDate(o);
        const crew = all.find((n) => mineLower.has(n.trim().toLowerCase())) || all[0] || null;
        return {
          key: o.orderNumber,
          job: snapshotOf(o, crew),
          order: o,
          sheet: sheetByJob.get(o.orderNumber) || null,
          paper: !!flags.get(o.orderNumber)?.paper,
          other: otherFor(o.orderNumber),
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
        paper: !!flags.get(s.order_number)?.paper,
        other: null,
        date: s.install_date || s.created_at,
      });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myJobs, sheets, sheetByJob, orders, crewNames, flags, statuses]);

  // Open the sheet a notice linked to, once the list has it.
  useEffect(() => {
    if (!openId) return;
    const row = rows.find((r) => r.sheet?.id === openId);
    if (!row) return;
    setOpen({ job: row.job, order: row.order, sheet: row.sheet });
    setOpenId(null);
    window.history.replaceState(null, "", "/more-for-more");
  }, [openId, rows]);

  // The Job Complete half of a job: what's filed, the job's last day, and
  // whether one is now owed (the last day has come, nothing filed, recent).
  const jcOf = (orderNumber: string) => {
    const tag = jcRole ? completionFor(orderNumber) : null;
    const lastDay = lastDays.get(orderNumber) || null;
    return { tag, lastDay, needed: jcRole && !tag && jobCompleteNeeded(lastDay, today) };
  };

  const counts = useMemo(
    () => ({
      fix: rows.filter((r) => r.sheet?.status === "rejected").length,
      mfm: rows.filter(isTodo).length,
      jc: rows.filter((r) => r.order && r.order.isMine !== false && jcOf(r.key).needed).length,
      office: rows.filter((r) => r.sheet?.status === "submitted").length,
      done: rows.filter((r) => r.sheet?.status === "completed").length,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, lastDays, completionFor, jcRole, today]
  );

  const shownRows = rows
    .filter((r) =>
      filter === "all"
        ? true
        : filter === "fix"
          ? r.sheet?.status === "rejected"
          : filter === "mfm"
            ? isTodo(r)
            : filter === "jc"
              ? !!r.order && r.order.isMine !== false && jcOf(r.key).needed
              : filter === "office"
                ? r.sheet?.status === "submitted"
                : r.sheet?.status === "completed"
    )
    // Sent-back sheets float to the top, then jobs owing a Job Complete:
    // they need doing first.
    .sort(
      (a, b) =>
        Number(b.sheet?.status === "rejected") - Number(a.sheet?.status === "rejected") ||
        Number(jcOf(b.key).needed) - Number(jcOf(a.key).needed)
    );

  const trimmed = query.trim();
  const searchResults = useMemo(() => {
    if (trimmed.length < 2) return [];
    return latestPerJob(searchOrders(orders, trimmed)).slice(0, 40);
  }, [orders, trimmed]);

  function openOrder(o: WorkOrder) {
    // Someone else already has this job's sheet: nothing to start here.
    if (otherFor(o.orderNumber)) return;
    const crew = crewsForDate(o)[0] || null;
    setOpen({ job: snapshotOf(o, crew), order: o, sheet: sheetByJob.get(o.orderNumber) || null });
  }

  function onSaved(s: MoreForMore) {
    setSheets((prev) => [s, ...prev.filter((p) => p.id !== s.id)]);
    // A resubmit clears a "sent back" notice and the tab's count.
    refreshMfmNotices();
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
            <p className="font-medium">Submissions are for install leads</p>
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
          <ClipboardCheck className="w-5 h-5 text-rba-green" />
          <h1 className="text-lg font-semibold flex-1">Submissions</h1>
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
                // Only shown when something has been sent back.
                ...(counts.fix ? ([["fix", `Sent back ${counts.fix}`]] as const) : []),
                ["mfm", `Need More for More ${counts.mfm}`],
                // Job Complete only exists for install leads.
                ...(jcRole ? ([["jc", `Need Job Complete ${counts.jc}`]] as const) : []),
                ["office", `With office ${counts.office}`],
                ["done", `Completed ${counts.done}`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium border ${
                  filter === key
                    ? "bg-foreground text-background border-foreground"
                    : key === "fix"
                      ? "border-danger text-danger"
                      : "border-border text-muted"
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
              {searchResults.map((o) => {
                const jc = jcOf(o.orderNumber);
                return (
                  <SubmissionRow
                    key={o.orderNumber}
                    name={o.customerName || o.accountName || "—"}
                    meta={`#${o.orderNumber} · ${o.workOrderType}${o.scheduledStart ? ` · ${formatDateShort(o.scheduledStart)}` : ""}${
                      crewsForDate(o).length ? ` · ${crewsForDate(o).join(", ")}` : ""
                    }`}
                    sheet={sheetByJob.get(o.orderNumber) || null}
                    paper={!!flags.get(o.orderNumber)?.paper}
                    other={otherFor(o.orderNumber)}
                    hasOrder
                    jcTag={jc.tag}
                    jcLastDay={jc.lastDay}
                    jcAllowed={jcRole && o.workOrderType === "Install" && o.isMine !== false}
                    onMfm={() => openOrder(o)}
                    onJc={() => setJcOpen(o)}
                  />
                );
              })}
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
            {shownRows.map((r) => {
              const jc = jcOf(r.key);
              return (
                <SubmissionRow
                  key={r.key}
                  name={r.job.job_name}
                  meta={`#${r.job.order_number}${r.job.install_date ? ` · ${formatDateShort(r.job.install_date)}` : ""}${
                    r.sheet ? ` · ${money(r.sheet.lead_total)}` : ""
                  }`}
                  sheet={r.sheet}
                  paper={r.paper}
                  other={r.other}
                  hasOrder={!!r.order}
                  jcTag={jc.tag}
                  jcLastDay={jc.lastDay}
                  jcAllowed={jcRole && !!r.order && r.order.isMine !== false}
                  onMfm={() => !r.other && setOpen({ job: r.job, order: r.order, sheet: r.sheet })}
                  onJc={() => r.order && setJcOpen(r.order)}
                />
              );
            })}
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

      {jcOpen && <JobCompleteModal order={jcOpen} onClose={() => setJcOpen(null)} />}
    </div>
  );
}
