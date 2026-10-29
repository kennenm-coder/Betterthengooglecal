/**
 * The third rForce report that lands in /api/upload: one row per VENDOR
 * purchase order, carrying the PO's status, our cost, and the vendor's
 * estimated ship date.
 *
 * Both export shapes are accepted — the ".xls" that is really an HTML table,
 * and the "Details Only / Comma Delimited .csv" export — because the two are a
 * dropdown apart in rForce's Attach File dialog and picking the other one
 * should not quietly stop the feed. Everything downstream of parsing is shared.
 *
 * Mind the THREE meanings of "order" this report now carries.
 *
 *   "Purchase Order: Purchase Order Number" (ZX3345099P) is the vendor PO,
 *   stored as `vendor_po_number`. One order carries one to nine of them.
 *
 *   "Order: Order Number" is the JOB this PO belongs to — an install order or
 *   a service order. Stored as `order_number`, and the join key: it is what
 *   `work_orders.order_number` holds and what the material-list app calls the
 *   job's P.O. # (`data.job.poNumber`).
 *
 *   "Order: Sold Order Number" (04961974) is the original order the customer
 *   bought, stored as `sold_order_number`. Informational only.
 *
 * For the original product the last two are the same number. They diverge for
 * SERVICE parts, where the sold number stays on the install that was sold and
 * the job number points at the service order opened later — which is the only
 * way to reach a service job's parts at all. See migration 042.
 *
 * "Order: Order Number" was added to the report on 2026-10-29, so the sold
 * number is still accepted as a fallback for both: a run of the previous
 * export, or a future one that drops the column, keeps importing with the old
 * behaviour rather than failing.
 *
 * Cells are read by column INDEX off the header row rather than by building a
 * name→value object, because this report ships two columns whose names differ
 * only by a prefix ("Order: Status" and "Status") and a name map makes the
 * wrong one easy to grab.
 */

import { parse } from "csv-parse/sync";

export interface PurchaseOrderRow {
  vendor_po_number: string;
  /** The job this PO belongs to — install or service. The join key. */
  order_number: string;
  /** The original order the customer bought. Equal to order_number for product. */
  sold_order_number: string;
  po_status: string;
  vendor: string;
  cost: number | null;
  estimated_ship_date: string | null;
  order_status: string;
  retail_total: number | null;
}

/** The header that no other report we import carries. */
const SIGNATURE_HEADER = "purchase order: purchase order number";

const HEADERS = {
  ORDER_STATUS: "order: status",
  /** The job the PO belongs to. Added 2026-10-29; absent from older exports. */
  JOB_ORDER_NUMBER: "order: order number",
  SOLD_ORDER_NUMBER: "order: sold order number",
  PO_STATUS: "status",
  VENDOR_PO_NUMBER: SIGNATURE_HEADER,
  VENDOR: "vendor",
  COST: "total",
  SHIP_DATE: "estimated ship date",
  RETAIL_TOTAL: "order: retail total",
} as const;

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function text(cell: string): string {
  return decodeHtmlEntities(cell.replace(/<[^>]*>/g, "")).trim();
}

/**
 * "1,526.71" -> 1526.71, "($25.00)" -> -25, "" -> null.
 *
 * Null rather than 0 on purpose: a PO with no cost yet and a PO that genuinely
 * costs nothing are different facts, and summing a job's POs should not quietly
 * treat the first as the second.
 */
function parseMoney(raw: string): number | null {
  if (!raw) return null;
  const negative = /^\(.*\)$/.test(raw.trim());
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

/**
 * "12/5/2022" -> "2022-12-05".
 *
 * Parsed by hand rather than through `new Date()`: this is a calendar date with
 * no time, and letting the runtime interpret it drags the server's timezone in
 * and can land the value a day early.
 */
function parseShipDate(raw: string): string | null {
  if (!raw) return null;
  const match = raw.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 2000 || year > 2100) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

function looksLikeHtmlTable(content: string): boolean {
  return content.includes("<table");
}

/**
 * True when this upload is the PO/ETA report, in either export shape.
 *
 * Checked before the work-order tests in detectFormat(): the HTML shape would
 * otherwise be claimed by the work-order XLS test, and the header this looks
 * for appears in no other report we import.
 */
export function isPurchaseOrderReport(content: string): boolean {
  if (looksLikeHtmlTable(content)) {
    const headerRow = content.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);
    if (!headerRow) return false;
    return text(headerRow[0]).toLowerCase().includes(SIGNATURE_HEADER);
  }
  const firstLine = content.replace(/^﻿/, "").split("\n")[0] ?? "";
  return firstLine.toLowerCase().includes(SIGNATURE_HEADER);
}

/** Header name -> column index. First occurrence wins. */
function indexHeaders(names: string[]): Map<string, number> {
  const index = new Map<string, number>();
  names.forEach((raw, i) => {
    const name = raw.trim().toLowerCase();
    if (name && !index.has(name)) index.set(name, i);
  });
  return index;
}

function htmlRows(html: string): string[][] {
  const table = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
  if (!table) return [];

  const rowMatches = table[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  if (!rowMatches) return [];

  return rowMatches.map((row) =>
    (row.match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi) ?? []).map(text)
  );
}

function csvRows(csv: string): string[][] {
  try {
    return parse(csv.replace(/^﻿/, ""), {
      columns: false,
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
      // Salesforce "Details Only" exports still sometimes trail a footer line;
      // it has no PO number, so the row loop drops it.
      trim: true,
    }) as string[][];
  } catch {
    return [];
  }
}

export function parsePurchaseOrderReport(content: string): PurchaseOrderRow[] {
  const rows = looksLikeHtmlTable(content) ? htmlRows(content) : csvRows(content);
  if (rows.length < 2) return [];

  const columns = indexHeaders(rows[0]);
  // Without a PO number and at least one order number there is nothing to key
  // on or to join to. Either order column alone is enough: an old export has
  // only the sold number, and each stands in for the other per row below.
  const poColumn = columns.get(HEADERS.VENDOR_PO_NUMBER);
  const jobOrderColumn = columns.get(HEADERS.JOB_ORDER_NUMBER);
  const soldOrderColumn = columns.get(HEADERS.SOLD_ORDER_NUMBER);
  if (poColumn === undefined) return [];
  if (jobOrderColumn === undefined && soldOrderColumn === undefined) return [];

  // Last row wins on a repeated PO number. A PostgREST upsert cannot touch the
  // same key twice in one statement, so duplicates have to be collapsed here
  // rather than rejected by the database mid-batch.
  const byPo = new Map<string, PurchaseOrderRow>();

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const at = (column: number | undefined): string =>
      column === undefined || column >= cells.length ? "" : (cells[column] ?? "").trim();

    const vendorPoNumber = at(poColumn);
    // Each falls back to the other, per row rather than per file: a blank cell
    // in one column must not cost us the row, and on an old export the sold
    // number is the only number there is.
    const soldOrderNumber = at(soldOrderColumn);
    const jobOrderNumber = at(jobOrderColumn) || soldOrderNumber;
    if (!vendorPoNumber || !jobOrderNumber) continue;

    byPo.set(vendorPoNumber, {
      vendor_po_number: vendorPoNumber,
      order_number: jobOrderNumber,
      sold_order_number: soldOrderNumber || jobOrderNumber,
      // Cancelled POs are filtered out of the report upstream, but if one ever
      // arrives it is stored as-is — consumers exclude that status. Dropping
      // the row instead would leave the old status sitting in the table
      // looking live.
      po_status: at(columns.get(HEADERS.PO_STATUS)),
      vendor: at(columns.get(HEADERS.VENDOR)),
      cost: parseMoney(at(columns.get(HEADERS.COST))),
      estimated_ship_date: parseShipDate(at(columns.get(HEADERS.SHIP_DATE))),
      order_status: at(columns.get(HEADERS.ORDER_STATUS)),
      retail_total: parseMoney(at(columns.get(HEADERS.RETAIL_TOTAL))),
    });
  }

  return [...byPo.values()];
}
