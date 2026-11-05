// Downloads for More for More sheets, built to match the paper sheet like for
// like:
//
//   - Excel (one sheet): the real bonus-sheet workbook from
//     public/templates/more-for-more-bonus.xlsx with the answers written into
//     the same cells a person would type them into. Nothing is redrawn, so
//     fonts, borders, colours and print setup are the sheet's own.
//   - Excel (date range): a Summary tab (one row per sheet, for payroll entry)
//     followed by one filled bonus-sheet tab per More for More.
//   - PDF: the same grid drawn from MFM_LAYOUT (generated from the template),
//     with the same values in the same boxes.
//
// jspdf and jszip load on demand, only when someone downloads.

import { format } from "date-fns";
import {
  calcSheet,
  DEDUCTIONS,
  normalizeLead,
  normalizeOffice,
  UNIT_ITEMS,
  type MoreForMore,
} from "./more-for-more";
import { MFM_LAYOUT } from "./more-for-more-layout";

const TEMPLATE_URL = "/templates/more-for-more-bonus.xlsx";
const SHEET_PATH = "xl/worksheets/sheet2.xml";

/** Sheet rows for each person's unit block, in UNIT_ITEMS order. */
const UNIT_ROWS = [6, 19, 32];
const SUBTOTAL_ROWS = [16, 29, 42];
/** Deduction rows on the sheet, in DEDUCTIONS order (Truck spans 10-11). */
const DEDUCTION_ROWS = [6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17];
/** Lead, apprentice 1, apprentice 2 columns in the deductions/extras tables. */
const PERSON_COLS = ["L", "N", "P"];
const NAME_CELLS = ["F3", "I3", "M3"];
const TIER_CELLS = ["H3", "L3", "P3"];

function moneyText(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtDate(iso: string | null | undefined, pattern = "M/d/yyyy"): string {
  if (!iso) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : format(d, pattern);
}

type CellValue = string | number;

interface SheetValues {
  values: Record<string, CellValue>;
}

/** Every answer on a sheet, keyed by the cell it belongs in. */
export function sheetValues(rec: MoreForMore): SheetValues {
  const lead = normalizeLead(rec.lead_data);
  const office = normalizeOffice(rec.office_data);
  const { people, finalTotal } = calcSheet(lead, office);
  const v: Record<string, CellValue> = {};
  const put = (ref: string, val: CellValue | null | undefined) => {
    if (val === null || val === undefined || val === "") return;
    v[ref] = val;
  };

  put("A3", rec.job_name);
  put("D3", rec.order_number);
  put("Q3", office.nps);

  people.forEach((p, i) => {
    put(NAME_CELLS[i], p.name);
    put(TIER_CELLS[i], p.tier ?? "");
    const start = UNIT_ROWS[i];
    UNIT_ITEMS.forEach((item, j) => {
      const q = Number(p.qty[item.key]) || 0;
      if (!q) return;
      put(`C${start + j}`, q);
      put(`G${start + j}`, p.lines[item.key]);
    });
    put(`G${SUBTOTAL_ROWS[i]}`, p.subtotal);

    const ded = office.deductions[i] || {};
    DEDUCTIONS.forEach((d, j) => {
      const pct = Number(ded[d.key]) || 0;
      if (pct) put(`${PERSON_COLS[i]}${DEDUCTION_ROWS[j]}`, `${pct}%`);
    });
  });

  const jobs = office.additionalJobs.filter((j) => j.trim());
  if (jobs.length) {
    put("I21", jobs.join(", "));
    people.forEach((p, i) => put(`${PERSON_COLS[i]}22`, p.additionalJobs));
  }

  // JIP Bonus: tick the lines that apply beside the sheet's printed amounts.
  if (office.jipInstallRelated) {
    put("L25", "✓");
    if (people.length > 1) put("L26", "✓");
  }
  if (office.jipLittle) {
    put("L27", "✓");
    if (people.length > 1) put("L28", "✓");
  }

  // Short year: the Office Only answer box is narrow.
  put("P25", fmtDate(office.dateReceived, "M/d/yy"));
  put("P26", office.entered8020 ? "Yes" : "");
  put("P27", fmtDate(office.payrollDate, "M/d/yy"));
  put("P28", office.reviewedWithLead ? "Yes" : "");

  const notes = ["Additonal Notes:"];
  if (lead.installerNote.trim()) notes.push(`Installer: ${lead.installerNote.trim()}`);
  if (office.officeNote.trim()) notes.push(`Office: ${office.officeNote.trim()}`);
  v.I30 = notes.join("\n");

  // Final pay sits under the notes box, on rows the sheet leaves empty.
  if (rec.status === "completed" || Object.keys(rec.office_data || {}).length) {
    put("I41", "Final Pay");
    people.forEach((p, i) => {
      put(`${PERSON_COLS[i]}41`, i === 0 ? "Lead" : "Apprentice");
      // Text, not a number: the sheet formats these cells as dates.
      put(`${PERSON_COLS[i]}42`, moneyText(p.pay));
    });
    put("I42", `Total ${moneyText(finalTotal)}`);
  }

  return { values: v };
}

// ─── Excel ──────────────────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Write one value into an existing cell, keeping the cell's own style. */
function setCell(xml: string, ref: string, value: CellValue): string {
  const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  const m = xml.match(re);
  if (!m) throw new Error(`Bonus sheet template has no cell ${ref}`);
  const attrs = m[1].replace(/\s+t="[^"]*"/, "").replace(/\s*\/$/, "");
  const cell =
    typeof value === "number"
      ? `<c r="${ref}"${attrs}><v>${value}</v></c>`
      : `<c r="${ref}"${attrs} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  return xml.replace(m[0], cell);
}

function fillSheetXml(templateXml: string, rec: MoreForMore): string {
  const { values } = sheetValues(rec);
  let xml = templateXml;
  for (const [ref, val] of Object.entries(values)) xml = setCell(xml, ref, val);
  return xml;
}

async function loadTemplate() {
  const JSZip = (await import("jszip")).default;
  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error("Could not load the bonus sheet template.");
  // The template sits behind the sign-in check; an expired session gets the
  // login page back instead of the file.
  if (/text\/html/i.test(res.headers?.get?.("content-type") || "")) {
    throw new Error("Your sign-in expired. Refresh the page, sign in again, and retry the download.");
  }
  return JSZip.loadAsync(await res.arrayBuffer());
}

function slug(s: string): string {
  return (s || "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "job";
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function sheetFileBase(rec: MoreForMore): string {
  return `more-for-more-${slug(rec.order_number)}-${slug(rec.job_name)}`;
}

/** One sheet, as the bonus-sheet workbook filled in. */
export async function buildSheetXlsx(rec: MoreForMore): Promise<Blob> {
  const zip = await loadTemplate();
  const xml = await zip.file(SHEET_PATH)!.async("string");
  zip.file(SHEET_PATH, fillSheetXml(xml, rec));
  return zip.generateAsync({ type: "blob", mimeType: XLSX_MIME, compression: "DEFLATE" });
}

export async function downloadSheetXlsx(rec: MoreForMore): Promise<void> {
  saveBlob(await buildSheetXlsx(rec), `${sheetFileBase(rec)}.xlsx`);
}

function colLetter(n: number): string {
  let s = "";
  n += 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** A plain Summary tab: a header row, then one row per sheet. */
function summarySheetXml(recs: MoreForMore[]): string {
  const header = [
    "Created", "Submitted", "Status", "Completed", "Job #", "Job Name", "Install Date", "Crew", "Submitted By",
    ...[0, 1, 2].flatMap((i) => {
      const who = i === 0 ? "Lead" : `Apprentice ${i}`;
      return [`${who}`, `${who} Tier`, `${who} Units $`, `${who} Deduction %`, `${who} Deduction $`, `${who} Add'l Jobs $`, `${who} JIP $`, `${who} Pay`];
    }),
    ...UNIT_ITEMS.map((u) => `Lead Qty: ${u.label}`),
    "Total Submitted", "Total Pay", "NPS", "Additional Jobs", "Date Received", "80/20 Entered", "Payroll Date",
    "Reviewed with Lead", "Times Submitted", "Installer Note", "Office Note",
  ];
  const rows: CellValue[][] = recs.map((rec) => {
    const lead = normalizeLead(rec.lead_data);
    const office = normalizeOffice(rec.office_data);
    const { people, leadTotal, finalTotal } = calcSheet(lead, office);
    const personCols = [0, 1, 2].flatMap((i) => {
      const p = people[i];
      if (!p) return ["", "", "", "", "", "", "", ""];
      return [p.name, p.tier ?? "", p.subtotal, p.deductionPct, p.deductionAmt, p.additionalJobs, p.jip, p.pay];
    });
    return [
      fmtDate(rec.created_at), fmtDate(rec.submitted_at), rec.status === "completed" ? "Completed" : "Needs office",
      fmtDate(rec.completed_at), rec.order_number, rec.job_name, fmtDate(rec.install_date), rec.crew_name || "",
      rec.created_by_name || rec.created_by,
      ...personCols,
      ...UNIT_ITEMS.map((u) => Number(lead.leadQty[u.key]) || ""),
      leadTotal, finalTotal, office.nps, office.additionalJobs.filter((j) => j.trim()).join(", "),
      fmtDate(office.dateReceived), office.entered8020 ? "Yes" : "", fmtDate(office.payrollDate),
      office.reviewedWithLead ? "Yes" : "", rec.submit_count, lead.installerNote, office.officeNote,
    ];
  });
  const cell = (v: CellValue, r: number, c: number) => {
    const ref = `${colLetter(c)}${r}`;
    if (v === "" || v === null || v === undefined) return "";
    return typeof v === "number"
      ? `<c r="${ref}"><v>${v}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(v))}</t></is></c>`;
  };
  const all = [header, ...rows];
  const data = all
    .map((row, ri) => `<row r="${ri + 1}">${row.map((v, ci) => cell(v, ri + 1, ci)).join("")}</row>`)
    .join("");
  const cols = header.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i === 5 || i >= header.length - 2 ? 28 : 14}" customWidth="1"/>`).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetViews><sheetView workbookViewId="0" tabSelected="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${data}</sheetData>` +
    (rows.length ? `<autoFilter ref="A1:${colLetter(header.length - 1)}${rows.length + 1}"/>` : "") +
    `</worksheet>`
  );
}

/** Excel tab names: 31 characters, none of []:*?/\ and unique. */
function tabName(rec: MoreForMore, used: Set<string>): string {
  const base = `${rec.order_number} ${rec.job_name}`.replace(/[\[\]:*?/\\']/g, " ").replace(/\s+/g, " ").trim().slice(0, 28) || "Sheet";
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) name = `${base.slice(0, 26)} ${n++}`;
  used.add(name.toLowerCase());
  return name;
}

/**
 * A date range of sheets: Summary first, then each sheet as its own filled
 * bonus-sheet tab, oldest first.
 */
export async function downloadRangeXlsx(recs: MoreForMore[], from: string, to: string): Promise<void> {
  const zip = await loadTemplate();
  const templateXml = await zip.file(SHEET_PATH)!.async("string");
  // The template's own tab becomes the first job's; copies need no printer
  // settings part (pageSetup keeps scale/orientation without it).
  const plainXml = templateXml.replace(/\s*r:id="rId1"/, "").replace('tabSelected="1"', 'tabSelected="0"');

  const ordered = [...recs].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const used = new Set<string>(["summary"]);
  let sheetsXml = `<sheet name="Summary" sheetId="1" r:id="rIdSum"/>`;
  let rels = `<Relationship Id="rIdSum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/summary.xml"/>`;
  let types = `<Override PartName="/xl/worksheets/summary.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  zip.file("xl/worksheets/summary.xml", summarySheetXml(ordered));

  ordered.forEach((rec, i) => {
    const name = xmlEscape(tabName(rec, used));
    if (i === 0) {
      zip.file(SHEET_PATH, fillSheetXml(templateXml.replace('tabSelected="1"', 'tabSelected="0"'), rec));
      sheetsXml += `<sheet name="${name}" sheetId="2" r:id="rId2"/>`;
      return;
    }
    const path = `worksheets/mfm${i}.xml`;
    zip.file(`xl/${path}`, fillSheetXml(plainXml, rec));
    sheetsXml += `<sheet name="${name}" sheetId="${i + 2}" r:id="rIdM${i}"/>`;
    rels += `<Relationship Id="rIdM${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${path}"/>`;
    types += `<Override PartName="/xl/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  });

  if (!ordered.length) {
    // Nothing in range: keep just the (empty) Summary.
    zip.remove(SHEET_PATH);
    zip.remove("xl/worksheets/_rels/sheet2.xml.rels");
  }

  let wb = await zip.file("xl/workbook.xml")!.async("string");
  wb = wb.replace(/<sheets>[\s\S]*?<\/sheets>/, `<sheets>${sheetsXml}</sheets>`);
  zip.file("xl/workbook.xml", wb);

  let wbRels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
  if (!ordered.length) wbRels = wbRels.replace(/<Relationship Id="rId2" [^>]*\/>/, "");
  zip.file("xl/_rels/workbook.xml.rels", wbRels.replace("</Relationships>", `${rels}</Relationships>`));

  let ct = await zip.file("[Content_Types].xml")!.async("string");
  if (!ordered.length) ct = ct.replace(/<Override PartName="\/xl\/worksheets\/sheet2\.xml"[^>]*\/>/, "");
  zip.file("[Content_Types].xml", ct.replace("</Types>", `${types}</Types>`));

  const blob = await zip.generateAsync({ type: "blob", mimeType: XLSX_MIME, compression: "DEFLATE" });
  saveBlob(blob, `more-for-more_${from || "start"}_to_${to || format(new Date(), "yyyy-MM-dd")}.xlsx`);
}

// ─── PDF ────────────────────────────────────────────────────────────────────

const THEME_FILLS: Record<string, [number, number, number]> = {
  "theme2_-0.1": [208, 206, 206],
  "theme0_-0.15": [217, 217, 217],
};

function fillRgb(fill: string | undefined): [number, number, number] | null {
  if (!fill) return null;
  if (THEME_FILLS[fill]) return THEME_FILLS[fill];
  if (/^[0-9a-f]{6}$/i.test(fill)) {
    return [parseInt(fill.slice(0, 2), 16), parseInt(fill.slice(2, 4), 16), parseInt(fill.slice(4, 6), 16)];
  }
  return null;
}

function parseRef(ref: string): { c: number; r: number } {
  const m = ref.match(/^([A-Z]+)(\d+)$/)!;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { c: c - 1, r: Number(m[2]) - 1 };
}

/**
 * A number as Excel would print it with the cell's own format: "$"#,##0 shows
 * 7.5 as $8, General shows 460 as 460. Only the formats this sheet uses.
 */
function formatNumber(n: number, nf: string | undefined): string {
  if (!nf || nf === "@") return String(Math.round(n * 1e9) / 1e9);
  if (nf.includes("$")) {
    const dec = (nf.split(";")[0].match(/0\.(0+)/)?.[1].length) ?? 0;
    return "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  return String(n);
}

/** The sheet as a one-page landscape PDF, drawn from the template's own grid. */
export async function buildSheetPdf(rec: MoreForMore): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 24;
  const L = MFM_LAYOUT;

  // Excel column width units → points (~7 px per char at 96 dpi, + padding).
  const colPts = L.cols.map((w) => (w * 7 + 5) * 0.75);
  const rowPts = L.rows;
  const rawW = colPts.reduce((s, w) => s + w, 0);
  const rawH = rowPts.reduce((s, h) => s + h, 0);
  const scale = Math.min((pageW - 2 * M) / rawW, (pageH - 2 * M) / rawH);
  const x0 = (pageW - rawW * scale) / 2;
  const y0 = M;
  const colX = [x0];
  colPts.forEach((w) => colX.push(colX[colX.length - 1] + w * scale));
  const rowY = [y0];
  rowPts.forEach((h) => rowY.push(rowY[rowY.length - 1] + h * scale));

  const { values } = sheetValues(rec);

  // Merged ranges draw as one box; every other cell is its own.
  const covered = new Map<string, { c1: number; r1: number; c2: number; r2: number }>();
  const boxes: { ref: string; c1: number; r1: number; c2: number; r2: number }[] = [];
  for (const m of L.merges) {
    const [a, b] = m.split(":");
    const p1 = parseRef(a);
    const p2 = parseRef(b);
    const box = { c1: p1.c, r1: p1.r, c2: p2.c, r2: p2.r };
    for (let r = p1.r; r <= p2.r; r++) for (let c = p1.c; c <= p2.c; c++) covered.set(`${c},${r}`, box);
    boxes.push({ ref: a, ...box });
  }
  for (let r = 0; r < rowPts.length; r++) {
    for (let c = 0; c < colPts.length; c++) {
      if (covered.has(`${c},${r}`)) continue;
      boxes.push({ ref: `${colLetter(c)}${r + 1}`, c1: c, r1: r, c2: c, r2: r });
    }
  }

  const cellAt = (c: number, r: number) => L.cells[`${colLetter(c)}${r + 1}`] || {};

  // 1. Fills.
  for (const b of boxes) {
    const rgb = fillRgb(cellAt(b.c1, b.r1).fill);
    if (!rgb) continue;
    doc.setFillColor(...rgb);
    doc.rect(colX[b.c1], rowY[b.r1], colX[b.c2 + 1] - colX[b.c1], rowY[b.r2 + 1] - rowY[b.r1], "F");
  }

  // 2. Borders, edge by edge, from each cell's own border (as Excel draws
  //    them) — except the edges inside a merged box, which Excel never draws.
  const sameMerge = (c1: number, r1: number, c2: number, r2: number) => {
    const a = covered.get(`${c1},${r1}`);
    return !!a && a === covered.get(`${c2},${r2}`);
  };
  doc.setDrawColor(0, 0, 0);
  const widths = [0, 0.5, 1.1, 1.8];
  for (let r = 0; r < rowPts.length; r++) {
    for (let c = 0; c < colPts.length; c++) {
      const b = cellAt(c, r).b;
      if (!b) continue;
      const [t, rt, bt, lt] = b;
      const xa = colX[c], xb = colX[c + 1], ya = rowY[r], yb = rowY[r + 1];
      const line = (w: number, x1: number, y1: number, x2: number, y2: number) => {
        if (!w) return;
        doc.setLineWidth(widths[w] * scale);
        doc.line(x1, y1, x2, y2);
      };
      if (!sameMerge(c, r, c, r - 1)) line(t, xa, ya, xb, ya);
      if (!sameMerge(c, r, c + 1, r)) line(rt, xb, ya, xb, yb);
      if (!sameMerge(c, r, c, r + 1)) line(bt, xa, yb, xb, yb);
      if (!sameMerge(c, r, c - 1, r)) line(lt, xa, ya, xa, yb);
    }
  }

  // 3. Text: the sheet's printed labels and rates, then the answers on top.
  const pad = 2.5 * scale;
  for (const b of boxes) {
    const style = cellAt(b.c1, b.r1);
    const filled = values[b.ref];
    const raw = filled !== undefined ? filled : style.v;
    if (raw === undefined) continue;
    const text = typeof raw === "number" ? formatNumber(raw, style.nf) : String(raw);
    const isAnswer = filled !== undefined && style.v === undefined;
    const size = (style.sz || 11) * scale * (isAnswer ? 0.95 : 0.9);
    doc.setFont("helvetica", style.bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(0, 0, 0);
    const x1 = colX[b.c1] + pad;
    const x2 = colX[b.c2 + 1] - pad;
    const ya = rowY[b.r1];
    const yb = rowY[b.r2 + 1];
    const width = x2 - x1;
    const lines: string[] =
      b.ref === "I30" || style.wrap ? doc.splitTextToSize(text.replace(/✓/g, "X"), width) : [text.replace(/✓/g, "X")];
    const lh = size * 1.15;
    const blockH = lines.length * lh;
    let y: number;
    if (style.va === "top" || b.ref === "I30") y = ya + pad + size * 0.85;
    else if (style.va === "center") y = (ya + yb) / 2 - blockH / 2 + size * 0.85;
    else y = yb - pad - (lines.length - 1) * lh - size * 0.15;
    const h = style.h === "center" || style.h === "centerContinuous" ? "center" : style.h === "right" ? "right" : typeof filled === "number" || (filled === undefined && typeof style.v === "number") ? "right" : "left";
    const x = h === "center" ? (x1 + x2) / 2 : h === "right" ? x2 : x1;
    for (const ln of lines) {
      if (y > yb + 1) break;
      doc.text(ln, x, y, { align: h as "left" | "center" | "right" });
      y += lh;
    }
  }

  doc.setTextColor(110, 110, 110);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  const foot = [
    `Submitted by ${rec.created_by_name || rec.created_by} on ${fmtDate(rec.submitted_at)}`,
    rec.completed_at ? `completed by ${rec.completed_by_name || rec.completed_by || "office"} on ${fmtDate(rec.completed_at)}` : "waiting on office",
  ].join(" · ");
  doc.text(foot, x0, pageH - 12);

  return doc.output("blob");
}

export async function downloadSheetPdf(rec: MoreForMore): Promise<void> {
  saveBlob(await buildSheetPdf(rec), `${sheetFileBase(rec)}.pdf`);
}

export async function printSheetPdf(rec: MoreForMore): Promise<void> {
  const blob = await buildSheetPdf(rec);
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (!w) saveBlob(blob, `${sheetFileBase(rec)}.pdf`);
}
