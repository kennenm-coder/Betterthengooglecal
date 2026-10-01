"use client";

import { useState, useMemo } from "react";
import { WorkOrder } from "@/lib/types";
import { Filter, X, ChevronDown } from "lucide-react";
import { crewsForDate, hasCrew } from "@/lib/format-utils";

export interface Filters {
  installer: string | null;
  serviceTech: string | null;
}

export const EMPTY_FILTERS: Filters = { installer: null, serviceTech: null };

export function applyFilters(orders: WorkOrder[], filters: Filters): WorkOrder[] {
  return orders.filter((o) => {
    // Match ANY crew on the job, not just the one rForce exports. Filtering on
    // the single resource field hid multi-crew jobs from their second crew
    // entirely — they saw no tile at all, not just a tile missing a name.
    //
    // The extra crews only count for the field the job actually carries, so an
    // install crew filter still can't pull in a service job that happens to
    // share a name — the two dropdowns stay separate, as before.
    if (filters.installer) {
      const match =
        o.installer === filters.installer ||
        (!!o.installer && hasCrew(o, filters.installer));
      if (!match) return false;
    }
    if (filters.serviceTech) {
      const match =
        o.serviceRep === filters.serviceTech ||
        (!!o.serviceRep && hasCrew(o, filters.serviceTech));
      if (!match) return false;
    }
    return true;
  });
}

export function hasActiveFilters(filters: Filters): boolean {
  return filters.installer !== null || filters.serviceTech !== null;
}

/**
 * Crew names for the dropdown: the rForce field plus every crew the scheduling
 * app added. Without the second half a helper crew never appears in the list,
 * so there is no way to filter to it.
 *
 * Extra crews are only collected from jobs that carry this field, keeping the
 * install and service dropdowns the separate lists they have always been.
 */
function getCrewOptions(orders: WorkOrder[], field: "installer" | "serviceRep"): string[] {
  const set = new Set<string>();
  for (const o of orders) {
    const val = o[field];
    if (!val || !val.trim()) continue;
    set.add(val);
    for (const name of crewsForDate(o)) if (name) set.add(name);
  }
  return Array.from(set).sort();
}

export default function FilterPanel({
  orders,
  filters,
  onChange,
}: {
  orders: WorkOrder[];
  filters: Filters;
  onChange: (filters: Filters) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = hasActiveFilters(filters);

  const installers = useMemo(() => getCrewOptions(orders, "installer"), [orders]);
  const serviceTechs = useMemo(() => getCrewOptions(orders, "serviceRep"), [orders]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md border text-sm transition-colors ${
          active
            ? "border-primary bg-primary-light text-primary font-medium"
            : "border-border hover:bg-surface"
        }`}
      >
        <Filter className="w-4 h-4" />
        <span className="hidden sm:inline">Filter</span>
        {active && (
          <span className="w-4 h-4 rounded-full bg-primary text-white text-[10px] flex items-center justify-center">
            {(filters.installer ? 1 : 0) + (filters.serviceTech ? 1 : 0)}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="fixed right-2 top-14 w-72 max-w-[calc(100vw-1rem)] bg-background border border-border rounded-lg shadow-lg z-40 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">Filters</span>
              {active && (
                <button
                  onClick={() => onChange(EMPTY_FILTERS)}
                  className="text-xs text-primary hover:underline"
                >
                  Clear all
                </button>
              )}
            </div>

            <FilterSelect
              label="Install Crew"
              value={filters.installer}
              options={installers}
              onChange={(v) => onChange({ ...filters, installer: v })}
            />

            <FilterSelect
              label="Service Tech"
              value={filters.serviceTech}
              options={serviceTechs}
              onChange={(v) => onChange({ ...filters, serviceTech: v })}
            />
          </div>
        </>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: string[];
  onChange: (value: string | null) => void;
}) {
  return (
    <div>
      <label className="text-xs text-muted mb-1 block">{label}</label>
      <div className="relative">
        <select
          value={value || ""}
          onChange={(e) => onChange(e.target.value || null)}
          className="w-full appearance-none bg-surface border border-border rounded-md px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">All</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
        {value && (
          <button
            onClick={(e) => {
              e.preventDefault();
              onChange(null);
            }}
            className="absolute right-7 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-border"
          >
            <X className="w-3 h-3 text-muted" />
          </button>
        )}
      </div>
    </div>
  );
}
