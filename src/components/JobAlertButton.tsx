"use client";

import { useEffect, useState } from "react";
import { AlarmClock, X } from "lucide-react";
import { useBackClose } from "@/hooks/useBackClose";
import { watchJobAlerts } from "@/lib/job-alerts-store";
import JobAlertBox from "./JobAlertBox";
import type { WorkOrder } from "@/lib/types";

/**
 * The Job Alert button in the job card's header row — where Log Action used to
 * be. Field managers and admins only (the caller gates it), on every job card
 * including Tech Measures. The number on it is how many notes the job has, so
 * a job with notes stands out without opening anything. Tapping it opens the
 * pop-up: everything already on the job, edit/delete your own, add a new one.
 * The same notes also show as a read-only field above Install Notes on the card
 * (JobAlertField).
 */
export default function JobAlertButton({ order }: { order: WorkOrder }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => watchJobAlerts(order.id, (rows) => setCount(rows.length)), [order.id]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative p-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
        title={count ? `Job Alert (${count} note${count === 1 ? "" : "s"})` : "Job Alert"}
        aria-label="Job Alert"
      >
        <AlarmClock className="w-5 h-5 text-amber-600" />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center">
            {count}
          </span>
        )}
      </button>
      {open && <JobAlertPopup order={order} onClose={() => setOpen(false)} />}
    </>
  );
}

function JobAlertPopup({ order, onClose }: { order: WorkOrder; onClose: () => void }) {
  // Android back closes the pop-up, not the app.
  useBackClose(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full sm:max-w-md max-h-[85vh] overflow-y-auto bg-background rounded-t-2xl sm:rounded-2xl shadow-xl p-4 space-y-3">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold">Job Alert</h2>
            <p className="text-xs text-muted truncate">
              {order.customerName || order.orderNumber}
              {order.address ? ` · ${order.address}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted hover:text-foreground" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <JobAlertBox order={order} />
      </div>
    </div>
  );
}
