"use client";

/**
 * One service job and the parts it is waiting on, shown inside an expanded
 * write-up tile.
 *
 * This was a standalone Parts tab for a day. It became confusing because it
 * asked somebody to hold two lists in their head — the write-up describing the
 * problem over here, the parts for it over there — so the card moved to where
 * the problem is already written down. The tab is gone; this is what survived
 * of it.
 *
 * The customer name is deliberately not repeated: the write-up tile above it
 * already says whose house this is. What the card adds is the service order
 * number, whether a visit is booked, and where the parts are.
 */

import { ExternalLink, MapPin, Package } from "lucide-react";
import { openSalesforce } from "@/lib/calendar-utils";
import { formatDateShort } from "@/lib/calendar-utils";
import { describeParts } from "@/lib/purchase-orders";
import { needsScheduling, type ServicePartsRow } from "@/lib/service-parts";

const STAGE_CHIP: Record<string, string> = {
  received: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  partial: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  ordered: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/30",
  waiting: "bg-surface text-muted border-border",
};

export default function ServicePartsCard({
  row,
  /** True when the write-up tile sits at a different address than this job. */
  showAddress = false,
}: {
  row: ServicePartsRow;
  showAddress?: boolean;
}) {
  const parts = describeParts(row.rollup);
  if (!parts) return null;

  // "On the dock" is what a job tile says. Here it says what rForce actually
  // told us, which is narrower and true: received on the order, not sighted on
  // our floor.
  const label = parts.stage === "received" ? "Received in rForce" : parts.label;
  const unscheduled = needsScheduling(row);

  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-start gap-2">
        <Package className="w-4 h-4 mt-0.5 text-muted shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">Service #{row.orderNumber}</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                STAGE_CHIP[parts.stage] ?? STAGE_CHIP.waiting
              }`}
              title={parts.detail}
            >
              {label}
            </span>
            {unscheduled && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                not scheduled
              </span>
            )}
          </div>
          <p className="text-xs text-muted mt-0.5">
            {row.status || "—"}
            {row.scheduledStart ? ` · visit ${formatDateShort(row.scheduledStart)}` : ""}
          </p>
          {showAddress && row.address && (
            <p className="text-xs text-muted mt-0.5 flex items-start gap-1">
              <MapPin className="w-3 h-3 mt-0.5 shrink-0" />
              <span className="break-words">{row.address}</span>
            </p>
          )}
          {row.serviceDescription && (
            <p className="text-xs text-foreground mt-1 break-words">{row.serviceDescription}</p>
          )}
          <p className="text-[11px] text-muted mt-1">{parts.detail}</p>
        </div>
        <button
          onClick={() => openSalesforce(row.orderNumber)}
          className="shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border text-[11px] text-muted"
          title={`Open ${row.orderNumber} in rForce`}
        >
          <ExternalLink className="w-3.5 h-3.5" />
          rForce
        </button>
      </div>
    </div>
  );
}
