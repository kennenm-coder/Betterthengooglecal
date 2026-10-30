"use client";

import { MaterialUnit } from "@/lib/types";
import { useState } from "react";
import { ChevronDown, ChevronUp, Package } from "lucide-react";

/* The per-unit product specs block from a calendar tile. It lives in its own
   file because the write-up's desktop split view shows the same accordions in
   its reference pane — the sizes and colours are the half of a job people read
   while they're filling the write-up in. */

function getExterior(u: MaterialUnit): string {
  return u.exteriorColor || u.summaryExterior || u.extColor || "";
}

function getInterior(u: MaterialUnit): string {
  return u.interiorColor || u.summaryInterior || u.intColor || "";
}

function fracToString(frac: number): string {
  if (frac === 0.125) return "1/8";
  if (frac === 0.25) return "1/4";
  if (frac === 0.375) return "3/8";
  if (frac === 0.5) return "1/2";
  if (frac === 0.625) return "5/8";
  if (frac === 0.75) return "3/4";
  if (frac === 0.875) return "7/8";
  if (frac === 0) return "";
  return String(frac);
}

function formatSize(u: MaterialUnit): string {
  const w = u.widthWhole + (u.widthFrac ? ` ${fracToString(u.widthFrac)}` : "");
  const h = u.heightWhole + (u.heightFrac ? ` ${fracToString(u.heightFrac)}` : "");
  return `${w}" x ${h}"`;
}

/* ── Product Specs ── */

export default function ProductSpecs({ units }: { units: MaterialUnit[] }) {
  return (
    <div className="mt-3 pt-3 border-t border-border">
      <div className="flex items-center gap-2 mb-2">
        <Package className="w-4 h-4 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          Product Specs ({units.length})
        </span>
      </div>
      <div className="space-y-1">
        {units.map((unit, i) => (
          <UnitAccordion key={i} unit={unit} index={i} />
        ))}
      </div>
    </div>
  );
}

function parseSpecDescription(spec: string): { label: string; value: string }[] {
  return spec
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(":");
      if (idx === -1) return { label: line, value: "" };
      return { label: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
    });
}

function UnitAccordion({ unit, index }: { unit: MaterialUnit; index: number }) {
  const [open, setOpen] = useState(false);
  const unitLabel = unit.label || `#${index + 1}`;
  const unitName = unit.type || unit.unitType || unit.abbrev || "Unit";
  const specLines = unit.specDescription ? parseSpecDescription(unit.specDescription) : [];
  const fieldCount = specLines.length;
  const category = specLines.find(s => s.label === "Category")?.value || "";
  const subCategory = specLines.find(s => s.label === "Sub-Category")?.value || "";

  if (unit.isMisc) {
    return (
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-surface">
          <span className="text-xs text-muted font-mono shrink-0">{unitLabel}</span>
          <span className="text-sm font-medium">MISC</span>
          <span className="text-sm text-muted truncate">{unit.description || ""}</span>
          {(unit.qty || 1) > 1 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-primary-light text-primary font-medium shrink-0">
              x{unit.qty}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left bg-surface hover:bg-surface/80 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-muted font-mono shrink-0">{unitLabel}</span>
          <span className="text-sm font-medium truncate">{unitName}</span>
          {category && <span className="text-xs text-muted truncate">· {category}</span>}
          {subCategory && <span className="text-xs text-muted truncate">· {subCategory}</span>}
          {(unit.qty || unit.summaryQty || 0) > 1 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-primary-light text-primary font-medium shrink-0">
              x{unit.qty || unit.summaryQty}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {fieldCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-light text-primary font-medium">
              {fieldCount} fields
            </span>
          )}
          {open ? (
            <ChevronUp className="w-4 h-4 text-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted" />
          )}
        </div>
      </button>

      {open && (
        <div className="px-3 py-2 border-t border-border text-sm space-y-0.5">
          {specLines.length > 0 ? (
            specLines.map((s, i) => (
              <SpecLine key={i} label={s.label} value={s.value} />
            ))
          ) : (
            <>
              <SpecLine label="Size" value={formatSize(unit)} />
              {getExterior(unit) && <SpecLine label="Ext Color" value={getExterior(unit)} />}
              {getInterior(unit) && <SpecLine label="Int Color" value={getInterior(unit)} />}
              {unit.intFinish && <SpecLine label="Int Finish" value={unit.intFinish} />}
              {unit.location && <SpecLine label="Location" value={unit.location} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SpecLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="text-muted shrink-0">{label}:</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  );
}
