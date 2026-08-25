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
import { subDays, parseISO, format } from "date-fns";
import { ChevronLeft, Link2, Check, Loader2, CalendarClock } from "lucide-react";

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
  const { user, role } = useAuth();
  const allowed = canEditLegacyLink(role);

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("All");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  // Only scheduling roles + admin may use this screen.
  useEffect(() => {
    if (role && !allowed) router.replace("/settings");
  }, [role, allowed, router]);

  // Jobs needing a legacy link: not linked to a material job, no legacy link
  // yet, and scheduled within the last week or later. Deduped by order number
  // (one order can span several appointments) and sorted soonest-first.
  const needsLink = useMemo(() => {
    const cutoff = subDays(new Date(), 7);
    const byOrder = new Map<string, WorkOrder>();
    for (const o of orders) {
      if (o.materialJob) continue;
      if (o.legacyInstallUrl) continue;
      if (!o.scheduledStart) continue;
      if (parseISO(o.scheduledStart) < cutoff) continue;
      if (typeFilter !== "All" && o.workOrderType !== typeFilter) continue;
      const existing = byOrder.get(o.orderNumber);
      if (!existing || (existing.scheduledStart && o.scheduledStart < existing.scheduledStart)) {
        byOrder.set(o.orderNumber, o);
      }
    }
    return Array.from(byOrder.values()).sort((a, b) =>
      (a.scheduledStart || "").localeCompare(b.scheduledStart || "")
    );
  }, [orders, typeFilter]);

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

      {/* Work order type filter */}
      <div className="px-4 py-2 border-b border-border flex flex-wrap gap-2">
        {TYPE_FILTERS.map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={`text-xs px-2.5 py-1 rounded-full font-medium border transition-colors ${
              typeFilter === t
                ? "bg-primary text-white border-primary"
                : "border-border text-muted hover:text-foreground"
            }`}
          >
            {t}
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
              className="rounded-lg border border-border bg-surface p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm truncate">{order.customerName}</span>
                <span className="text-xs text-muted whitespace-nowrap flex items-center gap-1">
                  <CalendarClock className="w-3.5 h-3.5" />
                  {order.scheduledStart ? format(parseISO(order.scheduledStart), "EEE MMM d") : "—"}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 mb-2">
                <span className="text-xs text-muted">{order.workOrderType}</span>
                <span className="text-xs text-muted">#{order.orderNumber}</span>
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
          ))
        )}
      </div>

      <BottomNav />
    </div>
  );
}
