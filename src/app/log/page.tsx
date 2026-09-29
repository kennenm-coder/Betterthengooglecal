"use client";

import { useState, useEffect, useMemo } from "react";
import { ImportLogEntry, ImportLogOrder } from "@/lib/import-log";
import {
  JobChange,
  ChangeLine,
  ChangeFilter,
  mergeJobChanges,
  buildChangeLines,
  matchesFilter,
  matchesQuery,
  FILTER_LABELS,
  FILTER_ORDER,
} from "@/lib/import-changes";
import { WorkOrder } from "@/lib/types";
import { useData } from "@/components/DataProvider";
import { searchWorkOrders } from "@/lib/store";
import { lastFirst } from "@/lib/format-utils";
import BottomNav from "@/components/BottomNav";
import OrderSheet from "@/components/OrderSheet";
import {
  ScrollText,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  Zap,
  Monitor,
  Plus,
  Pencil,
  ArrowRight,
  Search,
  X,
} from "lucide-react";
import { format, parseISO, isToday, isYesterday } from "date-fns";

type ViewMode = "jobs" | "uploads";

/** Dot colour per change kind, so scanning the list separates a schedule move
 *  from a crew swap without reading the words. */
const KIND_DOT: Record<string, string> = {
  schedule: "bg-primary",
  crew: "bg-rba-green",
  status: "bg-warning",
  address: "bg-jsv",
};

function formatRelativeDay(iso: string): string {
  const date = parseISO(iso);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEEE, MMM d");
}

/** Group anything carrying an ISO timestamp into day sections, newest first. */
function groupByDay<T>(
  items: T[],
  at: (item: T) => string
): { key: string; label: string; items: T[] }[] {
  const map = new Map<string, { label: string; items: T[] }>();
  for (const item of items) {
    const iso = at(item);
    const dayKey = format(parseISO(iso), "yyyy-MM-dd");
    if (!map.has(dayKey)) map.set(dayKey, { label: formatRelativeDay(iso), items: [] });
    map.get(dayKey)!.items.push(item);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, val]) => ({ key, label: val.label, items: val.items }));
}

export default function LogPage() {
  const { orders } = useData();
  const [entries, setEntries] = useState<ImportLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("jobs");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<ChangeFilter[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Opening a job uses the data already in memory; jobs outside the loaded date
  // window are fetched on demand.
  const [selectedOrder, setSelectedOrder] = useState<WorkOrder | null>(null);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [notFoundKeys, setNotFoundKeys] = useState<string[]>([]);

  async function fetchLog() {
    setLoading(true);
    try {
      const res = await fetch("/api/import-logs");
      if (res.ok) {
        const data = await res.json();
        setEntries(data);
      }
    } catch {
      // Silently fail — user can retry
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLog();
  }, []);

  const jobs = useMemo(() => mergeJobChanges(entries), [entries]);

  const searched = useMemo(() => jobs.filter((j) => matchesQuery(j, query)), [jobs, query]);

  // Chip counts reflect what the current search left behind, so a chip never
  // promises results the search has already ruled out.
  const counts = useMemo(() => {
    const c = {} as Record<ChangeFilter, number>;
    for (const f of FILTER_ORDER) c[f] = searched.filter((j) => matchesFilter(j, f)).length;
    return c;
  }, [searched]);

  const visible = useMemo(
    () =>
      filters.length === 0
        ? searched
        : searched.filter((j) => filters.some((f) => matchesFilter(j, f))),
    [searched, filters]
  );

  const jobGroups = useMemo(() => groupByDay(visible, (j) => j.lastAt), [visible]);
  const uploadGroups = useMemo(() => groupByDay(entries, (e) => e.created_at), [entries]);

  function toggleFilter(f: ChangeFilter) {
    setFilters((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  }

  async function openJob(job: JobChange) {
    if (!job.workOrderNumber) return;
    const local = orders.find((o) => o.workOrderNumber === job.workOrderNumber);
    if (local) {
      setSelectedOrder(local);
      return;
    }
    setOpeningKey(job.key);
    const found = await searchWorkOrders(job.workOrderNumber, 5);
    const exact =
      found.find((o) => o.workOrderNumber === job.workOrderNumber) ?? found[0] ?? null;
    setOpeningKey(null);
    if (exact) setSelectedOrder(exact);
    else setNotFoundKeys((prev) => [...prev, job.key]);
  }

  return (
    <div className="flex flex-col h-full">
      <header className="bg-background border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Changes</h1>
            <p className="text-xs text-muted mt-0.5">
              {jobs.length > 0
                ? `${jobs.length} job${jobs.length === 1 ? "" : "s"} changed · last 7 days`
                : "Last 7 days · auto-clears"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-border overflow-hidden text-xs">
              <button
                onClick={() => setView("jobs")}
                className={`px-2.5 py-1.5 ${
                  view === "jobs" ? "bg-primary text-white" : "text-muted"
                }`}
              >
                Jobs
              </button>
              <button
                onClick={() => setView("uploads")}
                className={`px-2.5 py-1.5 ${
                  view === "uploads" ? "bg-primary text-white" : "text-muted"
                }`}
              >
                Uploads
              </button>
            </div>
            <button
              onClick={fetchLog}
              disabled={loading}
              className="p-2 rounded-lg hover:bg-surface text-muted hover:text-foreground transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {view === "jobs" && jobs.length > 0 && (
          <>
            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name or WO#..."
                className="w-full pl-9 pr-9 py-2 rounded-lg border border-border bg-surface text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-border"
                >
                  <X className="w-3.5 h-3.5 text-muted" />
                </button>
              )}
            </div>
            <div className="flex gap-1.5 mt-2 overflow-x-auto pb-0.5">
              {FILTER_ORDER.filter((f) => counts[f] > 0).map((f) => {
                const on = filters.includes(f);
                return (
                  <button
                    key={f}
                    onClick={() => toggleFilter(f)}
                    className={`shrink-0 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                      on
                        ? "bg-primary text-white border-primary"
                        : "bg-surface text-muted border-border"
                    }`}
                  >
                    {FILTER_LABELS[f]} {counts[f]}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted px-4">
            <ScrollText className="w-12 h-12 mb-3" />
            <p className="font-medium">Nothing has changed</p>
            <p className="text-sm text-center mt-1">
              Jobs show up here when an upload moves them, changes the crew, or brings
              them in new. Uploads that change nothing are not listed, and neither are
              jobs that were never on the schedule.
            </p>
          </div>
        ) : view === "jobs" ? (
          visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted px-4">
              <Search className="w-10 h-10 mb-3" />
              <p className="font-medium">No matching jobs</p>
            </div>
          ) : (
            <div className="p-4 space-y-5">
              {jobGroups.map((group) => (
                <section key={group.key}>
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
                    {group.label}
                  </h2>
                  <div className="space-y-2">
                    {group.items.map((job) => (
                      <JobRow
                        key={job.key}
                        job={job}
                        opening={openingKey === job.key}
                        notFound={notFoundKeys.includes(job.key)}
                        onOpen={() => openJob(job)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )
        ) : (
          <div className="p-4 space-y-5">
            {uploadGroups.map((group) => (
              <section key={group.key}>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
                  {group.label}
                </h2>
                <div className="space-y-2">
                  {group.items.map((entry) => (
                    <UploadCard
                      key={entry.id}
                      entry={entry}
                      expanded={expandedId === entry.id}
                      onToggle={() =>
                        setExpandedId(expandedId === entry.id ? null : entry.id)
                      }
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {selectedOrder && (
        <OrderSheet order={selectedOrder} onClose={() => setSelectedOrder(null)} />
      )}

      <BottomNav />
    </div>
  );
}

function JobRow({
  job,
  opening,
  notFound,
  onOpen,
}: {
  job: JobChange;
  opening: boolean;
  notFound: boolean;
  onOpen: () => void;
}) {
  const lines = buildChangeLines(job);

  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-lg border border-border bg-surface px-3 py-2.5 active:scale-[0.99] transition-transform"
    >
      <div className="flex items-center gap-2">
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            job.action === "added" ? "bg-success" : "bg-primary"
          }`}
        />
        <span className="text-sm font-medium truncate flex-1">
          {lastFirst(job.customerName) || job.workOrderNumber || "—"}
        </span>
        {job.touches > 1 && (
          <span
            title={`Touched by ${job.touches} uploads`}
            className="text-[10px] px-1.5 py-0.5 rounded-full bg-border/60 text-muted shrink-0"
          >
            {job.touches}&times;
          </span>
        )}
        <span className="text-xs text-muted shrink-0">
          {format(parseISO(job.lastAt), "h:mm a")}
        </span>
      </div>

      <div className="mt-1 ml-3.5 space-y-0.5">
        {lines.map((line, i) => (
          <ChangeLineRow key={i} line={line} />
        ))}
      </div>

      <div className="mt-1 ml-3.5 flex items-center gap-2 text-[10px] text-muted">
        <span>{job.workOrderNumber || "no WO#"}</span>
        {opening && <Loader2 className="w-3 h-3 animate-spin" />}
        {notFound && (
          <span className="text-warning">Couldn&apos;t open — job is no longer in the data</span>
        )}
      </div>
    </button>
  );
}

function ChangeLineRow({ line }: { line: ChangeLine }) {
  return (
    <div className="text-[11px] leading-snug flex items-start gap-1.5">
      <span
        className={`mt-[5px] w-1 h-1 rounded-full shrink-0 ${KIND_DOT[line.kind] || "bg-muted"}`}
      />
      <span>
        <span className="text-muted">{line.label} </span>
        {line.from !== undefined && (
          <>
            <span className="text-muted/80 line-through">{line.from}</span>
            <ArrowRight className="inline w-2.5 h-2.5 mx-1 text-muted align-[-1px]" />
          </>
        )}
        <span className="text-foreground font-medium">{line.to}</span>
      </span>
    </div>
  );
}

/** The by-upload view — kept for auditing what a particular upload did. */
function UploadCard({
  entry,
  expanded,
  onToggle,
}: {
  entry: ImportLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isPowerAutomate = entry.source === "power_automate";
  const omitted = Math.max(0, entry.total_count - (entry.orders?.length ?? 0));

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-3 py-2.5 flex items-center gap-3 text-left"
      >
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-primary/15 text-primary">
          {isPowerAutomate ? <Zap className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
            {format(parseISO(entry.created_at), "h:mm a")} upload
          </p>
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="flex items-center gap-0.5">
              <Plus className="w-2.5 h-2.5" />
              {entry.added_count} new
            </span>
            <span className="flex items-center gap-0.5">
              <Pencil className="w-2.5 h-2.5" />
              {entry.updated_count} changed
            </span>
            <span>·</span>
            <span>{isPowerAutomate ? "automatic" : "manual"}</span>
          </div>
        </div>
        <div className="shrink-0 text-muted">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {expanded && entry.orders && entry.orders.length > 0 && (
        <div className="border-t border-border px-3 py-2 space-y-2 max-h-80 overflow-y-auto">
          {(entry.orders as ImportLogOrder[]).map((o, i) => (
            <UploadOrderRow key={i} order={o} at={entry.created_at} />
          ))}
          {omitted > 0 && (
            <p className="text-[10px] text-muted pt-1">+{omitted} more not stored</p>
          )}
        </div>
      )}
    </div>
  );
}

function UploadOrderRow({ order, at }: { order: ImportLogOrder; at: string }) {
  // Reuse the job renderer for one upload's view of one order.
  const lines = buildChangeLines({
    key: order.workOrderNumber || order.customerName,
    workOrderNumber: order.workOrderNumber,
    customerName: order.customerName,
    action: order.action,
    changes: order.changes ?? [],
    kinds: [],
    scheduledStart: order.scheduledStart,
    lastAt: at,
    touches: 1,
  });

  return (
    <div>
      <div className="flex items-center gap-2 text-xs">
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            order.action === "added" ? "bg-success" : "bg-primary"
          }`}
        />
        <span className="font-medium truncate flex-1">
          {lastFirst(order.customerName) || "—"}
        </span>
        <span className="text-muted shrink-0">{order.workOrderNumber || "—"}</span>
      </div>
      {lines.length > 0 && (
        <div className="mt-1 ml-3.5 space-y-0.5 border-l border-border pl-2.5">
          {lines.map((line, i) => (
            <ChangeLineRow key={i} line={line} />
          ))}
        </div>
      )}
    </div>
  );
}
