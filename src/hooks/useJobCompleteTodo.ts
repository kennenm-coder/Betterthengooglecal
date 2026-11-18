"use client";

// The installs this lead's crew still owes a Job Complete for: the job has
// reached its last scheduled day, nothing has been filed, and it is recent
// enough to chase (JOB_COMPLETE_START). One list serves the bottom-bar badge
// and the Submissions page. Empty for everyone who isn't an install lead, and
// for admins (they have no crew), so nothing changes for anyone else.

import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useData } from "@/components/DataProvider";
import { canSubmitJobComplete } from "@/lib/roles";
import { ownsOrder } from "@/lib/format-utils";
import { jobCompleteNeeded, jobLastDays, localToday } from "@/lib/job-complete-core";
import type { WorkOrder } from "@/lib/types";

export function useJobCompleteTodo(): WorkOrder[] {
  const { roles, crewNames } = useAuth();
  const { orders, completionFor } = useData();
  const allowed = canSubmitJobComplete(roles) && crewNames.length > 0;
  // Read every render (cheap) so a phone left open overnight moves on to the
  // new day the next time anything redraws.
  const today = localToday();

  return useMemo(() => {
    if (!allowed) return [];
    const lastDays = jobLastDays(orders);
    const seen = new Set<string>();
    const out: WorkOrder[] = [];
    for (const o of orders) {
      if (o.workOrderType !== "Install" || !o.orderNumber || seen.has(o.orderNumber)) continue;
      if (!ownsOrder(o, crewNames)) continue;
      seen.add(o.orderNumber);
      if (completionFor(o.orderNumber)) continue;
      if (jobCompleteNeeded(lastDays.get(o.orderNumber) || null, today)) out.push(o);
    }
    return out;
  }, [allowed, orders, crewNames, completionFor, today]);
}
