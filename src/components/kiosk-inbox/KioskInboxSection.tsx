"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, FileSignature, Inbox, Link2, Loader2, RefreshCw } from "lucide-react";
import type { TimeOffRequest } from "@/lib/types";
import {
  INBOX_DECIDED_EVENT,
  KIND_LABELS,
  type InboxItem,
  type InboxKind,
} from "@/lib/kiosk-inbox";
import InboxItemCard, { type DecisionResult } from "./InboxItemCard";
import ShareLinksPanel from "./ShareLinksPanel";

type Tab = "waiting" | "records" | "links";
type KindFilter = "all" | InboxKind;

/**
 * The approvals inbox at the top of the Time Off (payroll) screen.
 *
 * Every kiosk submission lands here: time off, time card adjustments, forms
 * that need a decision, and Difference Maker nominations. Each person sees
 * only the rows their roles can decide (admins see everything). Records holds
 * what has been decided and the forms that only needed filing.
 *
 * Time off approved here goes onto the calendar, so `onTimeOffDecided` lets
 * the Time Off log below update without a reload.
 */
export default function KioskInboxSection({
  showLinks,
  onTimeOffDecided,
}: {
  /** Whether this person may see and hand out the share links. */
  showLinks: boolean;
  onTimeOffDecided: (updated: TimeOffRequest) => void;
}) {
  const [tab, setTab] = useState<Tab>("waiting");
  const [pending, setPending] = useState<InboxItem[] | null>(null);
  const [records, setRecords] = useState<InboxItem[] | null>(null);
  const [kioskUrl, setKioskUrl] = useState<string | null>(null);
  const [viewMissing, setViewMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");

  const loadPending = useCallback(async () => {
    try {
      const res = await fetch("/api/kiosk-inbox");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not load the inbox");
      setPending(json.items ?? []);
      setKioskUrl(json.kioskUrl ?? null);
      setViewMissing(Boolean(json.viewMissing));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPending((p) => p ?? []);
    }
  }, []);

  const loadRecords = useCallback(async () => {
    setLoadingRecords(true);
    try {
      const res = await fetch("/api/kiosk-inbox?view=records");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not load the records");
      setRecords(json.items ?? []);
      setKioskUrl(json.kioskUrl ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRecords((r) => r ?? []);
    } finally {
      setLoadingRecords(false);
    }
  }, []);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  useEffect(() => {
    if (tab === "records" && records === null) loadRecords();
  }, [tab, records, loadRecords]);

  // A decision made from the header bell: refresh what is shown here.
  useEffect(() => {
    const onElsewhere = () => {
      loadPending();
      setRecords(null);
    };
    window.addEventListener(INBOX_DECIDED_EVENT, onElsewhere);
    window.addEventListener("time-off-decided", onElsewhere);
    return () => {
      window.removeEventListener(INBOX_DECIDED_EVENT, onElsewhere);
      window.removeEventListener("time-off-decided", onElsewhere);
    };
  }, [loadPending]);

  function handleDecided(item: InboxItem, result: DecisionResult) {
    setPending((prev) =>
      (prev ?? []).filter(
        (i) => !(i.decision_table === item.decision_table && i.item_id === item.item_id)
      )
    );
    // Records reload next time they are opened, so the new decision shows.
    setRecords(null);
    if (result.timeOffRequest) onTimeOffDecided(result.timeOffRequest);
  }

  const decidable = useMemo(() => (pending ?? []).filter((i) => i.can_decide), [pending]);

  const filteredRecords = useMemo(
    () =>
      (records ?? []).filter((r) => kindFilter === "all" || r.kind === kindFilter),
    [records, kindFilter]
  );

  const waitingCount = decidable.length;
  const urgent = tab === "waiting" && waitingCount > 0;

  const tabs: { key: Tab; label: string; icon: typeof Inbox }[] = [
    { key: "waiting", label: waitingCount ? `Waiting (${waitingCount})` : "Waiting", icon: Inbox },
    { key: "records", label: "Records", icon: Archive },
  ];
  if (showLinks) tabs.push({ key: "links", label: "Share links", icon: Link2 });

  return (
    <section
      className={`border-b-2 ${
        urgent ? "border-warning/40 bg-warning/10" : "border-border bg-surface/30"
      }`}
    >
      <header className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-2">
        <FileSignature className={`w-4 h-4 shrink-0 ${urgent ? "text-warning" : "text-muted"}`} />
        <h2 className="text-sm font-semibold">Kiosk approvals</h2>
        <div className="ml-auto flex items-center gap-1 rounded-lg bg-background/70 p-0.5">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                tab === key ? "bg-background shadow-sm text-foreground" : "text-muted"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <p className="mx-4 mb-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {tab === "waiting" && (
        <>
          {pending === null ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted" />
            </div>
          ) : decidable.length === 0 ? (
            <p className="px-4 pb-3 text-xs text-muted">Nothing is waiting on you.</p>
          ) : (
            <>
              <p className="px-4 pb-1 text-xs text-muted">
                Time off is not on the calendar until it is approved.
              </p>
              <ul className="divide-y divide-warning/20">
                {decidable.map((item) => (
                  <li key={`${item.decision_table}:${item.item_id}`} className="px-4 py-3">
                    <InboxItemCard item={item} kioskUrl={kioskUrl} onDecided={handleDecided} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {viewMissing && (
            <p className="px-4 pb-3 text-[11px] text-muted">
              Showing time off only: the kiosk&apos;s inbox is not set up in the
              database yet.
            </p>
          )}
        </>
      )}

      {tab === "records" && (
        <div className="pb-2">
          <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2">
            {(["all", "time_off", "time_card", "form", "recognition"] as KindFilter[]).map((k) => (
              <button
                key={k}
                onClick={() => setKindFilter(k)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  kindFilter === k
                    ? "bg-foreground text-background"
                    : "bg-background border border-border text-muted"
                }`}
              >
                {k === "all" ? "All" : KIND_LABELS[k]}
              </button>
            ))}
            <button
              onClick={loadRecords}
              disabled={loadingRecords}
              className="ml-auto p-1.5 rounded-full hover:bg-surface text-muted disabled:opacity-50"
              title="Reload"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingRecords ? "animate-spin" : ""}`} />
            </button>
          </div>

          {records === null || (loadingRecords && records.length === 0) ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted" />
            </div>
          ) : viewMissing ? (
            <p className="px-4 pb-2 text-xs text-muted">
              Records appear once the kiosk&apos;s inbox is set up in the database.
              Decided time off is in the log below.
            </p>
          ) : filteredRecords.length === 0 ? (
            <p className="px-4 pb-2 text-xs text-muted">Nothing on record yet.</p>
          ) : (
            <ul className="mx-4 divide-y divide-border rounded-lg border border-border bg-background">
              {filteredRecords.map((item) => (
                <li key={`${item.decision_table}:${item.item_id}`} className="px-3 py-2.5">
                  <InboxItemCard item={item} kioskUrl={kioskUrl} />
                </li>
              ))}
            </ul>
          )}
          {records && records.length >= 300 && (
            <p className="px-4 pt-2 text-[11px] text-muted">Showing the latest 300.</p>
          )}
        </div>
      )}

      {tab === "links" && showLinks && <ShareLinksPanel />}
    </section>
  );
}
