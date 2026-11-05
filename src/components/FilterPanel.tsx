"use client";

import { useState, useMemo } from "react";
import { WorkOrder } from "@/lib/types";
import { Filter, X } from "lucide-react";
import { crewsForDate, ownsOrder } from "@/lib/format-utils";

/**
 * One filter: a crew name. It no longer matters whether the person is on the
 * job as install crew or service tech — tap a name and you see every work
 * order that name is assigned to.
 */
export interface Filters {
  crew: string | null;
}

export const EMPTY_FILTERS: Filters = { crew: null };

export function applyFilters(orders: WorkOrder[], filters: Filters): WorkOrder[] {
  const crew = filters.crew;
  if (!crew) return orders;
  // ownsOrder checks every name a job carries (the scheduling app's per-day
  // crews and all three rForce fields), ignoring case and extra spaces, so a
  // multi-crew job shows up for each of its crews.
  return orders.filter((o) => ownsOrder(o, [crew]));
}

export function hasActiveFilters(filters: Filters): boolean {
  return filters.crew !== null;
}

/**
 * Every name that appears on any job, install or service, once each.
 * Names that differ only by case or spacing collapse into the first spelling
 * seen, so one person never shows up twice.
 */
function getCrewOptions(orders: WorkOrder[]): string[] {
  const byKey = new Map<string, string>();
  const add = (name: string | null | undefined) => {
    const trimmed = name?.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase().replace(/\s+/g, " ");
    if (!byKey.has(key)) byKey.set(key, trimmed);
  };
  for (const o of orders) {
    add(o.installer);
    add(o.serviceRep);
    add(o.primaryResource);
    for (const name of crewsForDate(o)) add(name);
  }
  return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
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

  const crews = useMemo(() => getCrewOptions(orders), [orders]);

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
            1
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="fixed right-2 top-14 w-72 max-w-[calc(100vw-1rem)] max-h-[calc(100vh-5rem)] flex flex-col bg-background border border-border rounded-lg shadow-lg z-40 p-3 gap-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">Filter by crew</span>
              {active && (
                <button
                  onClick={() => onChange(EMPTY_FILTERS)}
                  className="text-xs text-primary hover:underline"
                >
                  Clear
                </button>
              )}
            </div>

            {crews.length === 0 ? (
              <p className="text-sm text-muted py-2">No crew names found.</p>
            ) : (
              <div className="overflow-y-auto -mx-1 px-1 space-y-1">
                {crews.map((name) => {
                  const selected = filters.crew === name;
                  return (
                    <button
                      key={name}
                      onClick={() => {
                        // Tap a name to filter; tap it again to clear.
                        onChange({ crew: selected ? null : name });
                        setOpen(false);
                      }}
                      className={`w-full flex items-center justify-between text-left px-3 py-2.5 rounded-md border text-sm transition-colors ${
                        selected
                          ? "border-primary bg-primary-light text-primary font-medium"
                          : "border-border hover:bg-surface"
                      }`}
                    >
                      <span>{name}</span>
                      {selected && <X className="w-4 h-4" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
