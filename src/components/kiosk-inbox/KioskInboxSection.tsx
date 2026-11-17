"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileSignature, Link2 } from "lucide-react";
import type { TimeOffRequest } from "@/lib/types";
import {
  INBOX_DECIDED_EVENT,
  SECTION_ORDER,
  SECTION_ROLES,
  type InboxFocus,
  type InboxItem,
  type InboxKind,
} from "@/lib/kiosk-inbox";
import type { DecisionResult } from "./InboxItemCard";
import KindSection from "./KindSection";
import SupplySection from "./SupplySection";
import FocusCard from "./FocusCard";
import ShareLinksPanel from "./ShareLinksPanel";

/**
 * The kiosk submissions at the top of the Payroll Admin screen.
 *
 * One section per kind: time off, time cards, signed forms, supply requests and
 * Difference Maker nominations. Each person sees only the sections their roles
 * cover (admins see all of them), and inside a section only the rows they may
 * decide. Every section has its own history one tap away.
 *
 * `focus` is the item a notification email linked to. It is pinned to the top
 * and works in any status, so an old link still shows what happened.
 *
 * Time off approved here goes onto the calendar, so `onTimeOffDecided` lets the
 * Time Off log below update without a reload.
 */
export default function KioskInboxSection({
  roles,
  showLinks,
  focus,
  onTimeOffDecided,
}: {
  roles: string[];
  /** Whether this person may see and hand out the share links. */
  showLinks: boolean;
  focus: InboxFocus;
  onTimeOffDecided: (updated: TimeOffRequest) => void;
}) {
  const [pending, setPending] = useState<InboxItem[] | null>(null);
  const [kioskUrl, setKioskUrl] = useState<string | null>(null);
  const [viewMissing, setViewMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLinksPanel, setShowLinksPanel] = useState(false);
  // Bumped after any decision so every History refetches the page it is on.
  const [historyKey, setHistoryKey] = useState(0);

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

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  // A decision made from the header bell: refresh what is shown here.
  useEffect(() => {
    const onElsewhere = () => {
      loadPending();
      setHistoryKey((k) => k + 1);
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
    setHistoryKey((k) => k + 1);
    if (result.timeOffRequest) onTimeOffDecided(result.timeOffRequest);
  }

  const decidable = useMemo(() => (pending ?? []).filter((i) => i.can_decide), [pending]);

  const byKind = useMemo(() => {
    const map = new Map<InboxKind, InboxItem[]>();
    for (const item of decidable) map.set(item.kind, [...(map.get(item.kind) ?? []), item]);
    return map;
  }, [decidable]);

  // A section shows if the person holds one of its roles, or has something in
  // it to decide (which covers a form whose approvers were set by hand).
  const isAdmin = roles.includes("admin");
  const visible = SECTION_ORDER.filter((kind) => {
    if (isAdmin) return true;
    if (SECTION_ROLES[kind].some((r) => roles.includes(r))) return true;
    return kind !== "supply" && (byKind.get(kind)?.length ?? 0) > 0;
  });

  const waitingCount = decidable.length;
  const urgent = waitingCount > 0;

  return (
    <section className={`border-b-2 ${urgent ? "border-warning/40" : "border-border"}`}>
      <header
        className={`flex flex-wrap items-center gap-2 px-4 pt-3 pb-2 ${
          urgent ? "bg-warning/10" : "bg-surface/30"
        }`}
      >
        <FileSignature className={`h-4 w-4 shrink-0 ${urgent ? "text-warning" : "text-muted"}`} />
        <h2 className="text-sm font-semibold">Kiosk submissions</h2>
        {waitingCount > 0 && (
          <span className="rounded-full bg-warning/25 px-2 py-0.5 text-[11px] font-semibold text-warning">
            {waitingCount} waiting
          </span>
        )}
        {showLinks && (
          <button
            type="button"
            onClick={() => setShowLinksPanel((v) => !v)}
            className="ml-auto inline-flex items-center gap-1 rounded-md bg-background/70 px-2.5 py-1 text-xs font-medium text-muted hover:bg-background"
          >
            <Link2 className="h-3.5 w-3.5" />
            {showLinksPanel ? "Hide share links" : "Share links"}
          </button>
        )}
      </header>

      {error && (
        <p className="mx-4 mb-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
      )}

      {focus.sub && <FocusCard submissionId={focus.sub} onDecided={handleDecided} />}

      {visible.map((kind) =>
        kind === "supply" ? (
          <SupplySection key={kind} focusId={focus.supply} />
        ) : (
          <KindSection
            key={kind}
            kind={kind}
            items={byKind.get(kind) ?? []}
            loading={pending === null}
            historyKey={historyKey}
            kioskUrl={kioskUrl}
            note={
              kind === "time_off"
                ? "Time off is not on the calendar until it is approved."
                : undefined
            }
            onDecided={handleDecided}
          />
        )
      )}

      {viewMissing && (
        <p className="px-4 pb-3 text-[11px] text-muted">
          Showing time off only: the kiosk&apos;s inbox is not set up in the database yet.
        </p>
      )}

      {showLinks && showLinksPanel && (
        <div className="border-t border-border">
          <ShareLinksPanel />
        </div>
      )}
    </section>
  );
}
