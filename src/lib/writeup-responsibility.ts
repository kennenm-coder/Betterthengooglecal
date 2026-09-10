// Responsibility matrix for write-ups: who a job's issue is on, and — when it's
// on Retail — which defect-code source. Field-only: this is shown on the
// Write-Ups page expanded tile and never included in the PDF export.

/** Empty = not set. Stored lowercase in field_work_orders.responsibility. */
export type WriteUpResponsibility = "" | "customer" | "manufacturing" | "retail";

export const RESPONSIBILITY_OPTIONS: { value: Exclude<WriteUpResponsibility, "">; label: string }[] = [
  { value: "customer", label: "Customer" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "retail", label: "Retail" },
];

export function responsibilityLabel(value: string): string {
  return RESPONSIBILITY_OPTIONS.find((o) => o.value === value)?.label || value;
}

/** Retail-only defect codes (the "Source" column of the responsibility matrix). */
export interface DefectCodeOption {
  code: string;
  source: string;
}

export const DEFECT_CODES: DefectCodeOption[] = [
  { code: "A2", source: "Ordering" },
  { code: "A3", source: "Install" },
  { code: "A5", source: "Measurement" },
  { code: "A6", source: "Warehouse" },
  { code: "A9", source: "Sales" },
  { code: "A15", source: "Stain Shop" },
];

/** "A9 — Sales" for a stored code, or the raw value if it isn't recognized. */
export function defectCodeLabel(code: string): string {
  const m = DEFECT_CODES.find((d) => d.code === code);
  return m ? `${m.code} — ${m.source}` : code;
}
