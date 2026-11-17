"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { SECTION_TITLES, type InboxItem, type InboxKind } from "@/lib/kiosk-inbox";
import InboxItemCard, { type DecisionResult } from "./InboxItemCard";
import HistoryPanel from "./HistoryPanel";

/**
 * One kind of kiosk submission on the Payroll Admin page: what is waiting on
 * a decision, and (one tap away) everything already decided.
 *
 * A section with something waiting opens by itself and is tinted so it cannot
 * be missed; an empty one stays folded to a single line.
 */
export default function KindSection({
  kind,
  items,
  loading,
  historyKey,
  kioskUrl,
  note,
  onDecided,
}: {
  kind: InboxKind;
  /** Pending rows of this kind the viewer may decide. */
  items: InboxItem[];
  loading: boolean;
  historyKey: number;
  kioskUrl: string | null;
  /** A reminder shown above the waiting list, if there is one. */
  note?: ReactNode;
  onDecided: (item: InboxItem, result: DecisionResult) => void;
}) {
  // null = the person has not touched it, so it follows whether anything waits.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const waiting = items.length;
  const open = userOpen ?? waiting > 0;
  const urgent = waiting > 0;

  return (
    <section
      id={`section-${kind}`}
      className={`border-t border-border ${urgent ? "bg-warning/10" : ""}`}
    >
      <button
        type="button"
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
        )}
        <h3 className="text-sm font-semibold">{SECTION_TITLES[kind]}</h3>
        {!loading && (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              urgent ? "bg-warning/25 text-warning" : "bg-surface text-muted"
            }`}
          >
            {waiting ? `${waiting} waiting` : "Nothing waiting"}
          </span>
        )}
      </button>

      {open && (
        <div>
          {note && <p className="px-4 pb-1 text-xs text-muted">{note}</p>}

          {waiting > 0 && (
            <ul className="divide-y divide-warning/20">
              {items.map((item) => (
                <li key={`${item.decision_table}:${item.item_id}`} className="px-4 py-3">
                  <InboxItemCard item={item} kioskUrl={kioskUrl} onDecided={onDecided} />
                </li>
              ))}
            </ul>
          )}

          <div className="px-4 pb-3 pt-1">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-surface"
            >
              <History className="h-3.5 w-3.5" />
              {showHistory ? "Hide history" : "History"}
            </button>
          </div>

          {showHistory && <HistoryPanel refreshKey={historyKey} fixedKind={kind} />}
        </div>
      )}
    </section>
  );
}
