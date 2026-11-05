"use client";

// The strip at the top of the calendar that tells a lead what payroll did
// with their More for More sheets:
//   red   — sent back, with payroll's reason. Stays until they resubmit.
//           Tapping opens that sheet.
//   green — completed ("the office approved it"). Stays until dismissed.

import Link from "next/link";
import { AlertTriangle, CheckCircle2, X, ChevronRight } from "lucide-react";
import { useMfmNotices } from "@/hooks/useMfmNotices";

const MAX_SHOWN = 3;

export default function MoreForMoreNotices() {
  const { notices, dismiss } = useMfmNotices();
  if (notices.length === 0) return null;

  // Sent-back ones first: they need doing.
  const ordered = [...notices].sort((a, b) =>
    a.status === b.status ? 0 : a.status === "rejected" ? -1 : 1
  );
  const shown = ordered.slice(0, MAX_SHOWN);
  const more = ordered.length - shown.length;

  return (
    <div className="divide-y divide-white/15">
      {shown.map((s) =>
        s.status === "rejected" ? (
          <Link
            key={s.id}
            href={`/more-for-more?open=${s.id}`}
            className="flex items-start gap-2 bg-danger text-white px-3 py-2"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 text-xs">
              <p className="font-semibold truncate">
                More for More sent back · {s.job_name || `#${s.order_number}`}
              </p>
              {s.reject_reason && <p className="opacity-90 line-clamp-2">{s.reject_reason}</p>}
            </div>
            <span className="shrink-0 self-center flex items-center text-xs font-semibold">
              Fix <ChevronRight className="w-3.5 h-3.5" />
            </span>
          </Link>
        ) : (
          <div key={s.id} className="flex items-center gap-2 bg-rba-green text-white px-3 py-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <p className="flex-1 min-w-0 text-xs">
              <span className="font-semibold">{s.job_name || `Job #${s.order_number}`}</span>
              <span className="opacity-90"> · #{s.order_number} · the office approved your More for More.</span>
            </p>
            <button
              onClick={() => dismiss(s.id)}
              className="p-1 -m-1 rounded-full hover:bg-white/20 shrink-0"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )
      )}
      {more > 0 && (
        <Link href="/more-for-more" className="block bg-surface px-3 py-1.5 text-xs text-muted">
          +{more} more More for More update{more === 1 ? "" : "s"}
        </Link>
      )}
    </div>
  );
}
