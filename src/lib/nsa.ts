/**
 * NSA ownership: rForce's "NSA Ownership" checkbox on the order. The work-order
 * export carries it as a trailing column holding 1 / 0 (the HTML export) or
 * true / false (a CSV re-save), so both are read.
 *
 * Three answers, not two, and the difference matters:
 *   true      the column is there and says this job is NSA-owned
 *   false     the column is there and says it is not
 *   undefined the report has no such column at all (an export made before it
 *             was added to the rForce report)
 *
 * The importers leave `undefined` OUT of the database write, so a report
 * without the column never un-flags a job that an earlier report flagged.
 */
export function parseNsaFlag(raw: string | null | undefined): boolean {
  const v = (raw ?? "").toString().trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "y" || v === "x";
}

/** The header rForce gives the column. Matched ignoring case and spacing. */
export const NSA_HEADER = "NSA Ownership";

export function isNsaHeader(header: string): boolean {
  return header.replace(/\s+/g, " ").trim().toLowerCase() === NSA_HEADER.toLowerCase();
}
