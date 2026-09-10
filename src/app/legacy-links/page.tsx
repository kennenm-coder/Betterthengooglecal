"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useData } from "@/components/DataProvider";
import { useAuth } from "@/hooks/useAuth";
import { canEditLegacyLink } from "@/lib/roles";
import { upsertLegacyLink } from "@/lib/store";
import { WorkOrder } from "@/lib/types";
import BottomNav from "@/components/BottomNav";
import { typeColor, typeColorText, openSalesforce } from "@/lib/calendar-utils";
import { crewName } from "@/lib/format-utils";
import { subDays, parseISO, format } from "date-fns";
import { ChevronLeft, Link2, Check, Loader2, CalendarClock, ExternalLink } from "lucide-react";

const TYPE_FILTERS = ["All", "Install", "Service", "Job Site Visit"] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export default function LegacyLinksPage() {
  const router = useRouter();
  const { orders, applyLegacyLink } = useData();
  const { user, role, roles } = useAuth();
  const allowed = canEditLegacyLink(roles);

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("All");
  // Crew (assigned to) filter — "" means everyone.
  const [crewFilter, setCrewFilter] = useState<string>("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  // Only scheduling roles + admin may use this screen.
  useEffect(() => {
    if (role && !allowed) router.replace("/settings");
  }, [role, allowed, router]);

  // Jobs needing a legacy link: not linked to a material job, no legacy link
  // yet, and scheduled within the last week or later. Deduped by order number
  // (one order can span several appointments) and sorted soonest-first. Not
  // yet type-filtered — that happens below so the chip totals stay accurate.
  const baseNeeds = useMemo(() => {
    const cutoff = subDays(new Date(), 7);
    const byOrder = new Map<string, WorkOrder>();
    for (const o of orders) {
      if (o.materialJob) continue;
      if (o.legacyInstallUrl) continue;
      if (!o.scheduledStart) continue;
      if (parseISO(o.scheduledStart) < cutoff) continue;
      const existing = byOrder.get(o.orderNumber);
      if (!existing || (existing.scheduledStart && o.scheduledStart < existing.scheduledStart)) {
        byOrder.set(o.orderNumber, o);
      }
    }
    return Array.from(byOrder.values()).sort((a, b) =>
      (a.scheduledStart || "").localeCompare(b.scheduledStart || "")
    );
  }, [orders]);

  // Crews present in the list (alphabetical) with per-crew totals, so the
  // schedulers can each work one crew at a time without overlapping.
  const crews = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of baseNeeds) {
      const name = crewName(o) || "Unassigned";
      m.set(name, (m.get(name) || 0) + 1);
    }
    return Array.from(m.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count }));
  }, [baseNeeds]);

  // If the selected crew empties out (all its links saved), fall back to everyone.
  useEffect(() => {
    if (crewFilter && !crews.some((c) => c.name === crewFilter)) setCrewFilter("");
  }, [crews, crewFilter]);

  const crewNeeds = useMemo(
    () =>
      crewFilter
        ? baseNeeds.filter((o) => (crewName(o) || "Unassigned") === crewFilter)
        : baseNeeds,
    [baseNeeds, crewFilter]
  );

  // Per-type totals for the filter chips (within the selected crew).
  const counts = useMemo(() => {
    const c: Record<TypeFilter, number> = {
      All: crewNeeds.length,
      Install: 0,
      Service: 0,
      "Job Site Visit": 0,
    };
    for (const o of crewNeeds) {
      if (o.workOrderType === "Install") c.Install += 1;
      else if (o.workOrderType === "Service") c.Service += 1;
      else if (o.workOrderType === "Job Site Visit") c["Job Site Visit"] += 1;
    }
    return c;
  }, [crewNeeds]);

  const needsLink = useMemo(
    () => (typeFilter === "All" ? crewNeeds : crewNeeds.filter((o) => o.workOrderType === typeFilter)),
    [crewNeeds, typeFilter]
  );

  async function save(order: WorkOrder) {
    const url = (inputs[order.id] || "").trim();
    setErrorId(null);
    if (!isValidHttpUrl(url)) {
      setErrorId(order.id);
      return;
    }
    setSavingId(order.id);
    const ok = await upsertLegacyLink(order.orderNumber, url, user?.email || undefined);
    setSavingId(null);
    if (!ok) {
      setErrorId(order.id);
      return;
    }
    // Reflect locally — the order gains a legacyInstallUrl and drops off the
    // list, advancing focus to the next tile.
    applyLegacyLink(order.orderNumber, url);
    setInputs((prev) => {
      const next = { ...prev };
      delete next[order.id];
      return next;
    });
  }

  if (!allowed) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center text-muted text-sm">
          Redirecting…
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <header className="bg-background border-b border-border px-4 py-3">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors mb-1"
        >
          <ChevronLeft className="w-4 h-4" />
          Settings
        </Link>
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-amber-600" />
          <h1 className="text-lg font-semibold">Legacy Links Needed</h1>
        </div>
        <p className="text-sm text-muted mt-0.5">
          Un-linked jobs scheduled since last week with no legacy install link
          {needsLink.length > 0 ? ` · ${needsLink.length} remaining` : ""}
        </p>
      </header>

      {/* Assigned-to filter — work one crew at a time */}
      <div className="px-4 py-2 border-b border-border">
        <select
          value={crewFilter}
          onChange={(e) => setCrewFilter(e.target.value)}
          className="w-full px-2.5 py-2 rounded-lg border border-border bg-background text-sm"
          aria-label="Filter by assigned crew"
        >
          <option value="">All crews · {baseNeeds.length}</option>
          {crews.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name} · {c.count}
            </option>
          ))}
        </select>
      </div>

      {/* Work order type filter */}
      <div className="px-4 py-2 border-b border-border flex flex-wrap gap-2">
        {TYPE_FILTERS.map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={`text-xs px-2.5 py-1 rounded-full font-medium border transition-colors flex items-center gap-1.5 ${
              typeFilter === t
                ? "bg-primary text-white border-primary"
                : "border-border text-muted hover:text-foreground"
            }`}
          >
            {t !== "All" && (
              <span className={`w-2 h-2 rounded-full ${typeColor(t)}`} />
            )}
            <span>{t}</span>
            <span
              className={`text-[10px] font-bold ${
                typeFilter === t ? "text-white/80" : "text-muted"
              }`}
            >
              {counts[t]}
            </span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        {needsLink.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center text-muted py-16 gap-2">
            <Check className="w-8 h-8 text-green-600" />
            <p className="text-sm">Nothing needs a legacy link right now.</p>
          </div>
        ) : (
          needsLink.map((order) => (
            <div
              key={order.id}
              className="rounded-lg border border-border bg-surface overflow-hidden flex items-stretch"
            >
              <div className={`w-1.5 shrink-0 ${typeColor(order.workOrderType)}`} />
              <div className="flex-1 min-w-0 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm truncate">{order.customerName}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted whitespace-nowrap flex items-center gap-1">
                    <CalendarClock className="w-3.5 h-3.5" />
                    {order.scheduledStart ? format(parseISO(order.scheduledStart), "EEE MMM d") : "—"}
                  </span>
                  <button
                    onClick={() => openSalesforce(order.workOrderNumber, order.orderNumber)}
                    className="p-1 rounded hover:bg-muted/10"
                    title="Open in Salesforce"
                  >
                    <ExternalLink className="w-4 h-4 text-muted" />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-0.5 mb-2">
                <span className={`text-xs font-semibold ${typeColorText(order.workOrderType)}`}>
                  {order.workOrderType}
                </span>
                <span className="text-xs text-muted">#{order.orderNumber}</span>
                {crewName(order) && (
                  <span className="text-xs text-muted truncate">· {crewName(order)}</span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://drive.google.com/..."
                  value={inputs[order.id] || ""}
                  onChange={(e) =>
                    setInputs((prev) => ({ ...prev, [order.id]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") save(order);
                  }}
                  className={`flex-1 min-w-0 px-2.5 py-2 rounded-lg border bg-background text-sm ${
                    errorId === order.id ? "border-danger" : "border-border"
                  }`}
                />
                <button
                  onClick={() => save(order)}
                  disabled={savingId === order.id}
                  className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50 flex items-center gap-1 shrink-0"
                >
                  {savingId === order.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </button>
              </div>
              {errorId === order.id && (
                <p className="text-xs text-danger mt-1">
                  Enter a valid URL starting with http:// or https://
                </p>
              )}
              </div>
            </div>
          ))
        )}
      </div>

      <BottomNav />
    </div>
  );
}
