"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, Mail, Search, X } from "lucide-react";
import { formatDateShort } from "@/lib/calendar-utils";
import {
  fetchAllSiteVisits,
  fetchSiteVisitReports,
  visitBy,
  type SiteVisit,
} from "@/lib/site-visits";

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Payroll Admin's Site Visits tab (migration 078/079): every Job Site Visit
 * the measure techs ever logged, read-only. Filter by month, by tech, or by
 * typing a job / address / note; download what's shown as a spreadsheet.
 * Each month says whether the monthly email went out for it.
 */
export default function SiteVisitsHistory() {
  const [visits, setVisits] = useState<SiteVisit[] | null>(null);
  const [reports, setReports] = useState<Map<string, { sentAt: string; count: number }>>(new Map());
  const [month, setMonth] = useState("all");
  const [tech, setTech] = useState("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchAllSiteVisits(), fetchSiteVisitReports()]).then(([v, r]) => {
      if (cancelled) return;
      setVisits(v);
      setReports(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const all = useMemo(() => visits || [], [visits]);
  const months = useMemo(() => Array.from(new Set(all.map((v) => v.visit_date.slice(0, 7)))), [all]);
  const techs = useMemo(() => {
    const byEmail = new Map<string, string>();
    for (const v of all) if (!byEmail.has(v.created_by)) byEmail.set(v.created_by, visitBy(v));
    return Array.from(byEmail.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      all.filter(
        (v) =>
          (month === "all" || v.visit_date.startsWith(month)) &&
          (tech === "all" || v.created_by === tech) &&
          (!q ||
            [v.job_name, v.order_number, v.work_order_number || "", v.address || "", v.notes, visitBy(v)]
              .join(" ")
              .toLowerCase()
              .includes(q))
      ),
    [all, month, tech, q]
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

  function exportCsv() {
    const rows = [
      ["Date", "Measure tech", "Job name", "Job #", "WO #", "Address", "Notes"],
      ...[...shown]
        .sort((a, b) => a.visit_date.localeCompare(b.visit_date))
        .map((v) => [v.visit_date, visitBy(v), v.job_name, v.order_number, v.work_order_number || "", v.address || "", v.notes]),
    ];
    const csv = rows.map((r) => r.map((c) => csvCell(String(c ?? ""))).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `job-site-visits${month === "all" ? "" : `-${month}`}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const selectClass =
    "min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary";

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-3xl mx-auto w-full">
        <div className="px-3 pt-3 pb-2 space-y-2 border-b border-border">
          <div className="flex gap-2">
            <select value={month} onChange={(e) => setMonth(e.target.value)} className={selectClass} aria-label="Month">
              <option value="all">All months</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
            <select value={tech} onChange={(e) => setTech(e.target.value)} className={selectClass} aria-label="Measure tech">
              <option value="all">Everyone</option>
              {techs.map(([email, name]) => (
                <option key={email} value={email}>
                  {name}
                </option>
              ))}
            </select>
            <button
              onClick={exportCsv}
              disabled={shown.length === 0}
              className="shrink-0 p-2 rounded-lg border border-border text-muted hover:bg-surface disabled:opacity-40"
              title="Download what's shown as a spreadsheet (CSV)"
              aria-label="Download CSV"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search job, address, job # or notes"
              className="w-full pl-9 pr-9 py-2 rounded-lg border border-border bg-surface text-base sm:text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary"
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
          {visits && (
            <p className="text-xs text-muted">
              {shown.length} visit{shown.length === 1 ? "" : "s"}
              {shown.length !== all.length ? ` of ${all.length}` : ""}
            </p>
          )}
        </div>

        {visits === null ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted" />
          </div>
        ) : all.length === 0 ? (
          <div className="px-6 py-14 text-center space-y-1">
            <p className="font-medium">No job site visits yet</p>
            <p className="text-sm text-muted">Measure techs log them from Submissions or a job&apos;s tile in Duck Force.</p>
          </div>
        ) : shown.length === 0 ? (
          <p className="px-4 py-10 text-sm text-muted text-center">Nothing matches those filters.</p>
        ) : (
          byMonth.map(([ym, rows]) => {
            const sent = reports.get(ym);
            return (
              <section key={ym}>
                <h2 className="sticky top-0 bg-surface border-b border-border px-4 py-1.5 text-xs font-semibold text-muted flex items-center gap-2">
                  <span className="flex-1">
                    {monthLabel(ym)} · {rows.length} visit{rows.length === 1 ? "" : "s"}
                  </span>
                  {sent && (
                    <span className="flex items-center gap-1 font-normal" title={`The monthly email listed ${sent.count}`}>
                      <Mail className="w-3 h-3" /> Emailed {formatDateShort(sent.sentAt)}
                    </span>
                  )}
                </h2>
                <ul className="divide-y divide-border">
                  {rows.map((v) => (
                    <li key={v.id} className="px-4 py-3">
                      <div className="flex items-baseline gap-2">
                        <p className="text-sm font-medium truncate flex-1">{v.job_name || `#${v.order_number}`}</p>
                        <span className="shrink-0 text-xs text-muted">{formatDateShort(v.visit_date)}</span>
                      </div>
                      <p className="text-xs text-muted truncate">
                        {visitBy(v)} · #{v.order_number}
                        {v.work_order_number ? ` · WO ${v.work_order_number}` : ""}
                        {v.address ? ` · ${v.address}` : ""}
                      </p>
                      <p className="mt-1 text-sm whitespace-pre-wrap">{v.notes}</p>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
