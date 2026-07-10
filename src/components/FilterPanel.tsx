"use client";

import { useState, useMemo } from "react";
import { WorkOrder } from "@/lib/types";
import { Filter, X, ChevronDown } from "lucide-react";

export interface Filters {
  installer: string | null;
  serviceTech: string | null;
}

export const EMPTY_FILTERS: Filters = { installer: null, serviceTech: null };

export function applyFilters(orders: WorkOrder[], filters: Filters): WorkOrder[] {
  return orders.filter((o) => {
    if (filters.installer && o.installer !== filters.installer) return false;
    if (filters.serviceTech && o.serviceRep !== filters.serviceTech) return false;
    return true;
  });
}

export function hasActiveFilters(filters: Filters): boolean {
  return filters.installer !== null || filters.serviceTech !== null;
}

function getUniqueValues(orders: WorkOrder[], field: keyof WorkOrder): string[] {
  const set = new Set<string>();
  for (const o of orders) {
    const val = o[field];
    if (typeof val === "string" && val.trim()) set.add(val);
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

  const installers = useMemo(() => getUniqueValues(orders, "installer"), [orders]);
  const serviceTechs = useMemo(() => getUniqueValues(orders, "serviceRep"), [orders]);

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
          <div className="absolute right-0 top-full mt-1 w-72 bg-background border border-border rounded-lg shadow-lg z-40 p-3 space-y-3">
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
