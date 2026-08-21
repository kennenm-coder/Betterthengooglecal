"use client";

import { useState, useEffect } from "react";
import { ImportLogEntry, ImportLogOrder, ImportLogFieldChange } from "@/lib/import-log";
import BottomNav from "@/components/BottomNav";
import {
  ScrollText,
  FileSpreadsheet,
  Package,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  Zap,
  Monitor,
  Plus,
  Pencil,
  ArrowRight,
} from "lucide-react";
import { format, parseISO, isToday, isYesterday } from "date-fns";

function formatRelativeDay(iso: string): string {
  const date = parseISO(iso);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEEE, MMM d");
}

/** Format a change value — dates become "MMM d, h:mm a"; everything else is
 *  shown as-is. Falls back to the raw string if a date can't be parsed. */
function formatChangeValue(value: string, isDate?: boolean): string {
  if (!isDate || value === "—") return value;
  try {
    return format(parseISO(value), "MMM d, h:mm a");
  } catch {
    return value;
  }
}

function groupByDay(
  entries: ImportLogEntry[]
): { key: string; label: string; entries: ImportLogEntry[] }[] {
  const map = new Map<string, { label: string; entries: ImportLogEntry[] }>();
  for (const entry of entries) {
    const dayKey = format(parseISO(entry.created_at), "yyyy-MM-dd");
    const label = formatRelativeDay(entry.created_at);
    if (!map.has(dayKey)) map.set(dayKey, { label, entries: [] });
    map.get(dayKey)!.entries.push(entry);
  }
  return Array.from(map.entries()).map(([key, val]) => ({
    key,
    label: val.label,
    entries: val.entries,
  }));
}

export default function LogPage() {
  const [entries, setEntries] = useState<ImportLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  const groups = groupByDay(entries);

  return (
    <div className="flex flex-col h-full">
      <header className="bg-background border-b border-border px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Import Changes</h1>
          <p className="text-xs text-muted mt-0.5">
            Last 3 days · auto-clears
          </p>
        </div>
        <button
          onClick={fetchLog}
          disabled={loading}
          className="p-2 rounded-lg hover:bg-surface text-muted hover:text-foreground transition-colors"
        >
          <RefreshCw
            className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
          />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted px-4">
            <ScrollText className="w-12 h-12 mb-3" />
            <p className="font-medium">No imports in the last 3 days</p>
            <p className="text-sm text-center mt-1">
              Import entries appear here after data is uploaded — manually or via
              Power Automate.
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-5">
            {groups.map((group) => (
              <section key={group.key}>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
                  {group.label}
                </h2>
                <div className="space-y-2">
                  {group.entries.map((entry) => (
                    <LogCard
                      key={entry.id}
                      entry={entry}
                      expanded={expandedId === entry.id}
                      onToggle={() =>
                        setExpandedId(
                          expandedId === entry.id ? null : entry.id
                        )
                      }
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}

function LogCard({
  entry,
  expanded,
  onToggle,
}: {
  entry: ImportLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isAccounts = entry.format === "accounts_csv";
  const isPowerAutomate = entry.source === "power_automate";

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-3 py-2.5 flex items-center gap-3 text-left"
      >
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
            isAccounts
              ? "bg-rba-green/15 text-rba-green"
              : "bg-primary/15 text-primary"
          }`}
        >
          {isAccounts ? (
            <Package className="w-4 h-4" />
          ) : (
            <FileSpreadsheet className="w-4 h-4" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium">
              {isAccounts ? "Account Import" : "Work Order Import"}
            </p>
            {isPowerAutomate ? (
              <Zap className="w-3 h-3 text-warning shrink-0" />
            ) : (
              <Monitor className="w-3 h-3 text-muted shrink-0" />
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>
              {format(parseISO(entry.created_at), "h:mm a")}
            </span>
            <span>·</span>
            <span className="flex items-center gap-0.5">
              <Plus className="w-2.5 h-2.5" />
              {entry.added_count} new
            </span>
            <span className="flex items-center gap-0.5">
              <Pencil className="w-2.5 h-2.5" />
              {entry.updated_count} updated
            </span>
          </div>
        </div>
        <div className="shrink-0 text-muted">
          {expanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </div>
      </button>

      {expanded && entry.orders && entry.orders.length > 0 && (
        <div className="border-t border-border px-3 py-2 space-y-2 max-h-80 overflow-y-auto">
          {(entry.orders as ImportLogOrder[]).map((o, i) => (
            <OrderRow key={i} order={o} />
          ))}
          {entry.total_count > entry.orders.length && (
            <p className="text-[10px] text-muted pt-1">
              +{entry.total_count - entry.orders.length} more
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function OrderRow({ order }: { order: ImportLogOrder }) {
  const changes = order.changes ?? [];
  const hasChanges = order.action === "updated" && changes.length > 0;

  return (
    <div>
      <div className="flex items-center gap-2 text-xs">
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            order.action === "added" ? "bg-success" : "bg-primary"
          }`}
        />
        <span className="font-medium truncate flex-1">
          {order.customerName || "—"}
        </span>
        <span className="text-muted shrink-0">
          {order.workOrderNumber || "—"}
        </span>
      </div>

      {hasChanges && (
        <div className="mt-1 ml-3.5 space-y-1 border-l border-border pl-2.5">
          {changes.map((c, i) => (
            <ChangeRow key={i} change={c} />
          ))}
        </div>
      )}
      {order.action === "updated" && !hasChanges && (
        <p className="mt-0.5 ml-3.5 text-[10px] text-muted italic">
          No tracked fields changed
        </p>
      )}
    </div>
  );
}

function ChangeRow({ change }: { change: ImportLogFieldChange }) {
  return (
    <div className="text-[11px] leading-snug">
      <span className="text-muted">{change.field}: </span>
      <span className="text-muted/80 line-through">
        {formatChangeValue(change.from, change.isDate)}
      </span>
      <ArrowRight className="inline w-2.5 h-2.5 mx-1 text-muted align-[-1px]" />
      <span className="text-foreground font-medium">
        {formatChangeValue(change.to, change.isDate)}
      </span>
    </div>
  );
}
