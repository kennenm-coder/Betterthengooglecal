"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, Search, X } from "lucide-react";
import {
  HISTORY_STATUSES,
  HISTORY_STATUS_LABELS,
  KIND_LABELS,
  historyOrdersByDecision,
  type HistoryStatus,
  type InboxItem,
  type InboxKind,
} from "@/lib/kiosk-inbox";
import InboxItemCard, { KindChip, StatusPill, stampLabel } from "./InboxItemCard";

type KindFilter = "all" | InboxKind;

interface HistoryResponse {
  items: InboxItem[];
  total: number;
  page: number;
  pageSize: number;
  viewMissing: boolean;
  kioskUrl: string | null;
}

/** "2026-11-13" (a local calendar day) → the ISO instant that day starts. */
function dayStartIso(day: string, addDays = 0): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d + addDays).toISOString();
}

/**
 * Everything already decided, plus forms that only needed filing.
 *
 * Filtered and paged by the server, so it stays quick as the record grows.
 * The same role rule as the queue applies: a person sees the rows whose
 * approver roles they hold, and admins see all.
 *
 * Each row is a one-line summary (what, who, decided by whom and when, the
 * note); tapping it opens the full detail with the signed PDF.
 */
export default function HistoryPanel({ refreshKey }: { refreshKey: number }) {
  const [kind, setKind] = useState<KindFilter>("all");
  const [status, setStatus] = useState<HistoryStatus>("decided");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);

  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  // Search as they type, without a request per keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(search.trim());
      setPage(0);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ view: "history", status, page: String(page) });
    if (kind !== "all") params.set("kind", kind);
    if (from) params.set("from", dayStartIso(from));
    if (to) params.set("to", dayStartIso(to, 1)); // through the end of that day
    if (q) params.set("q", q);

    setLoading(true);
    fetch(`/api/kiosk-inbox?${params}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Could not load the history");
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, status, from, to, q, page, refreshKey]);

  /** Any filter change starts again at page one. */
  function filterChange<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setPage(0);
    };
  }

  const byDecision = historyOrdersByDecision(status);
  const hasFilters = kind !== "all" || status !== "decided" || from || to || search;
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 25;
  const firstRow = total === 0 ? 0 : page * pageSize + 1;
  const lastRow = Math.min(total, (page + 1) * pageSize);

  return (
    <div className="pb-3">
      {/* Filters */}
      <div className="space-y-2 px-4 pb-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(["all", "time_off", "time_card", "form", "recognition"] as KindFilter[]).map((k) => (
            <button
              key={k}
              onClick={() => filterChange(setKind)(k)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                kind === k
                  ? "bg-foreground text-background"
                  : "bg-background border border-border text-muted"
              }`}
            >
              {k === "all" ? "All kinds" : KIND_LABELS[k]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={status}
            onChange={(e) => filterChange(setStatus)(e.target.value as HistoryStatus)}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs"
          >
            {HISTORY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {HISTORY_STATUS_LABELS[s]}
              </option>
            ))}
          </select>

          <span className="text-xs text-muted">{byDecision ? "Decided" : "Submitted"}</span>
          <input
            type="date"
            value={from}
            onChange={(e) => filterChange(setFrom)(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs w-[130px]"
            aria-label="From"
          />
          <span className="text-xs text-muted">to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => filterChange(setTo)(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs w-[130px]"
            aria-label="To"
          />

          <div className="relative min-w-[10rem] flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or KSK- code"
              className="w-full rounded-md border border-border bg-background py-1 pl-7 pr-2 text-xs"
            />
          </div>

          {hasFilters && (
            <button
              onClick={() => {
                setKind("all");
                setStatus("decided");
                setFrom("");
                setTo("");
                setSearch("");
                setQ("");
                setPage(0);
              }}
              className="flex items-center gap-0.5 text-xs text-muted hover:text-foreground"
            >
              <X className="w-3 h-3" /> Clear
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="mx-4 mb-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
      )}

      {data?.viewMissing ? (
        <p className="px-4 text-xs text-muted">
          History appears once the kiosk&apos;s inbox is set up in the database.
          Decided time off is in the log below.
        </p>
      ) : !data && loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-muted" />
        </div>
      ) : data && data.items.length === 0 ? (
        <p className="px-4 text-xs text-muted">
          {hasFilters ? "Nothing matches these filters." : "Nothing decided yet."}
        </p>
      ) : (
        data && (
          <>
            <ul
              className={`mx-4 divide-y divide-border rounded-lg border border-border bg-background transition-opacity ${
                loading ? "opacity-60" : ""
              }`}
            >
              {data.items.map((item) => {
                const key = `${item.decision_table}:${item.item_id}`;
                const open = openKey === key;
                return (
                  <li key={key}>
                    <button
                      onClick={() => setOpenKey(open ? null : key)}
                      className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-surface/60"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <KindChip kind={item.kind} />
                          <StatusPill status={item.status} />
                          <span className="truncate text-sm font-medium">
                            {item.kind === "recognition" ? item.title : item.employee_name}
                          </span>
                          {item.kind !== "recognition" && (
                            <span className="truncate text-xs text-muted">{item.title}</span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-muted">
                          {item.status === "recorded" ? (
                            <>Filed {stampLabel(item.submitted_at)}</>
                          ) : (
                            <>
                              <span
                                className={
                                  item.status === "denied" ? "text-danger" : "text-rba-green"
                                }
                              >
                                {item.status === "denied" ? "Denied" : "Approved"}
                              </span>
                              {item.reviewed_by_name ? ` by ${item.reviewed_by_name}` : ""}
                              {item.reviewed_at ? `, ${stampLabel(item.reviewed_at)}` : ""}
                            </>
                          )}
                          {item.reference_code && (
                            <span className="ml-2 font-mono">{item.reference_code}</span>
                          )}
                        </p>
                        {item.review_note && !open && (
                          <p className="mt-0.5 truncate text-xs italic text-muted">
                            &ldquo;{item.review_note}&rdquo;
                          </p>
                        )}
                      </div>
                      <ChevronDown
                        className={`mt-1 h-4 w-4 shrink-0 text-muted transition-transform ${
                          open ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                    {open && (
                      <div className="border-t border-border bg-surface/30 px-3 py-3">
                        <InboxItemCard item={item} kioskUrl={data.kioskUrl} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="mt-2 flex items-center gap-2 px-4 text-xs text-muted">
              <span>
                {firstRow}–{lastRow} of {total}
              </span>
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0 || loading}
                  className="flex items-center gap-0.5 rounded-md border border-border bg-background px-2 py-1 disabled:opacity-40"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Newer
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={lastRow >= total || loading}
                  className="flex items-center gap-0.5 rounded-md border border-border bg-background px-2 py-1 disabled:opacity-40"
                >
                  Older <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
}
