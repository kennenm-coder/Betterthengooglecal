"use client";

import { Building2, ShieldAlert } from "lucide-react";
import { SPECIAL_LABEL, type SpecialDay } from "@/lib/special-days-store";

/**
 * A crew blocked for the day by the scheduling app. Deliberately not a button:
 * there is no job behind it, so there is nothing to open.
 */
export default function SpecialDayTile({
  day,
  compact = false,
}: {
  day: SpecialDay;
  compact?: boolean;
}) {
  const special = day.kind === "special_ops";
  const Icon = special ? ShieldAlert : Building2;
  return (
    <div
      className={`w-full rounded-md ${compact ? "px-3 py-2 text-sm" : "px-3 py-2 text-base"} ${
        special ? "bg-orange-600 text-white" : "bg-teal-700 text-white"
      }`}
      data-testid="special-day-tile"
    >
      <div className="font-medium truncate flex items-center gap-1.5">
        <Icon className={compact ? "w-3.5 h-3.5 shrink-0" : "w-4 h-4 shrink-0"} />
        {day.crewName}
      </div>
      <div className={`${compact ? "text-xs" : "text-sm"} opacity-90`}>
        {SPECIAL_LABEL[day.kind]} &middot; All day
      </div>
    </div>
  );
}
