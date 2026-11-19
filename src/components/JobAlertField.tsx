"use client";

import { useEffect, useState } from "react";
import { AlarmClock } from "lucide-react";
import { watchJobAlerts, type JobAlert } from "@/lib/job-alerts-store";
import type { WorkOrder } from "@/lib/types";

/**
 * The Job Alert field on a job card, right above Install Notes: every note on
 * the job with who wrote it, read-only. It only appears when the job has
 * notes. Adding, editing and deleting happen in the alarm-clock pop-up in the
 * card's header (JobAlertButton), and this field refreshes when that changes.
 * The caller gates it to field managers and admins.
 */
export default function JobAlertField({ order }: { order: WorkOrder }) {
  const [alerts, setAlerts] = useState<JobAlert[]>([]);

  useEffect(() => watchJobAlerts(order.id, setAlerts), [order.id]);

  if (alerts.length === 0) return null;
  return (
    <div className="mt-3 pt-3 border-t border-border">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
        <div className="flex items-center gap-1.5 mb-1 text-amber-700 dark:text-amber-400">
          <AlarmClock className="w-3.5 h-3.5" />
          <span className="text-xs font-semibold uppercase tracking-wide">Job Alert</span>
        </div>
        <div className="space-y-1">
          {alerts.map((a) => (
            <p key={a.id} className="text-sm text-foreground whitespace-pre-wrap">
              <span className="font-semibold">{a.createdByName}:</span> {a.note}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
