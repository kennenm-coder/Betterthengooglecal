"use client";

import { useState } from "react";
import {
  Calendar,
  Check,
  Clock,
  Download,
  FileSignature,
  Loader2,
  X,
} from "lucide-react";
import type { TimeOffRequest } from "@/lib/types";
import { formatTimeDisplay, updateTimeOffStatus } from "@/lib/time-off-store";

/**
 * The approval queue: time-off requests signed at the office kiosk, waiting on
 * a payroll decision.
 *
 * These rows are NOT on the calendar yet. Approving is what puts them there,
 * so this section is deliberately the first thing on the Time Off screen and
 * styled to be unmissable.
 */
export default function PendingTimeOffSection({
  requests,
  reviewerName,
  onDecided,
  formatDateDisplay,
}: {
  /** Pending requests only — the parent filters. */
  requests: TimeOffRequest[];
  /** Who is approving, recorded on the row. */
  reviewerName: string;
  onDecided: (updated: TimeOffRequest) => void;
  formatDateDisplay: (dateStr: string) => string;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (requests.length === 0) return null;

  async function decide(r: TimeOffRequest, status: "approved" | "denied") {
    setBusyId(r.id);
    setError(null);
    const updated = await updateTimeOffStatus(r.id, status, reviewerName);
    if (updated) {
      onDecided(updated);
    } else {
      setError(
        "That request could not be updated. Someone may have just decided it — reload to see where it stands."
      );
    }
    setBusyId(null);
  }

  return (
    <section className="border-b-2 border-warning/40 bg-warning/10">
      <header className="flex items-center gap-2 px-4 pt-3 pb-1">
        <FileSignature className="w-4 h-4 text-warning shrink-0" />
        <h2 className="text-sm font-semibold">
          {requests.length} request{requests.length === 1 ? "" : "s"} waiting on
          you
        </h2>
        <span className="text-xs text-muted ml-auto">
          Not on the calendar until approved
        </span>
      </header>

      {error && (
        <p className="mx-4 mb-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      <ul className="divide-y divide-warning/20">
        {requests.map((r) => {
          const busy = busyId === r.id;
          return (
            <li key={r.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm">{r.employee_name}</span>
                    {r.department && (
                      <span className="text-xs text-muted">{r.department}</span>
                    )}
                    {r.request_type && (
                      <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-medium">
                        {r.request_type}
                      </span>
                    )}
                  </div>

                  <div className="mt-1 flex items-center gap-1.5 text-xs">
                    <Calendar className="w-3 h-3 text-muted shrink-0" />
                    <span>{formatDateDisplay(r.start_date)}</span>
                    {r.end_date && r.end_date !== r.start_date && (
                      <>
                        <span className="text-muted">&rarr;</span>
                        <span>{formatDateDisplay(r.end_date)}</span>
                      </>
                    )}
                  </div>

                  {(r.start_time || r.end_time) && (
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                      <Clock className="w-3 h-3 shrink-0" />
                      <span>
                        {[
                          r.start_time &&
                            `leaves ${formatTimeDisplay(r.start_time)}`,
                          r.end_time && `back ${formatTimeDisplay(r.end_time)}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                  )}

                  {r.reason && (
                    <p className="mt-1.5 text-xs text-muted italic">
                      &ldquo;{r.reason}&rdquo;
                    </p>
                  )}

                  {r.reference_code && (
                    <p className="mt-1.5 font-mono text-[11px] text-muted">
                      {r.reference_code}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {r.signed_pdf_path && (
                    <a
                      href={`/api/time-off/${r.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open the signed request"
                      className="flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-2 text-xs font-medium hover:bg-surface"
                    >
                      <Download className="w-3.5 h-3.5" /> PDF
                    </a>
                  )}
                  <button
                    onClick={() => decide(r, "denied")}
                    disabled={busy}
                    className="flex items-center gap-1 rounded-lg border border-danger/40 bg-background px-2.5 py-2 text-xs font-medium text-danger disabled:opacity-50 active:scale-[0.97]"
                  >
                    <X className="w-3.5 h-3.5" /> Deny
                  </button>
                  <button
                    onClick={() => decide(r, "approved")}
                    disabled={busy}
                    className="flex items-center gap-1 rounded-lg bg-rba-green px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 active:scale-[0.97]"
                  >
                    {busy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    Approve
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
