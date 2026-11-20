"use client";

import { useEffect, useState } from "react";
import { Footprints } from "lucide-react";
import { SiteVisitPopup } from "./SiteVisitBox";
import { siteVisitJobOf, watchSiteVisits } from "@/lib/site-visits";
import type { WorkOrder } from "@/lib/types";

/**
 * "Log Job Site Visit" on a job tile (measure techs + admins; the caller
 * gates it). Shows how many visits the job already has; tapping opens the
 * pop-up with every visit on the job and the form to log a new one.
 */
export default function SiteVisitButton({ order }: { order: WorkOrder }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => watchSiteVisits(order.orderNumber, (rows) => setCount(rows.length)), [order.orderNumber]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-orange-500/40 bg-orange-500/10 text-orange-800 dark:text-orange-300 text-sm font-medium active:scale-[0.98] transition-transform"
      >
        <Footprints className="w-4 h-4" />
        Log Job Site Visit
        {count > 0 && (
          <span className="text-xs font-normal opacity-90">
            · {count} logged
          </span>
        )}
      </button>
      {open && <SiteVisitPopup job={siteVisitJobOf(order)} onClose={() => setOpen(false)} startNew={count === 0} />}
    </>
  );
}
