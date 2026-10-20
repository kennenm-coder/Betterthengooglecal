// Groups a job's write-up rows into per-submission sections for the doc page
// and PDF, so two write-ups on the same job read as two separate, numbered
// blocks — each with its own work-to-complete list and its own material total.
//
// The material total is what the office buys from, so it merges identical lines
// and counts only the work that isn't installed yet. Each work item owns its own
// material list on the create screen; those lines carry the item's seq, which is
// what lets the total drop them once the item is checked off.
//
// Grouping key: batch_id when present (migration 013), else the created time to
// the minute (legacy rows share a near-identical timestamp per submission).
//
// Work items are numbered 1..N within each section (restart per write-up). An
// issue that fanned out to several units is collapsed to ONE number listing the
// units. Numbers are assigned over the full canonical order, so completing an
// item never renumbers the others — completed items just move to their own list
// keeping the number they already had.

import { mergeLengths } from "./lengths";
import {
  FieldWorkOrder,
  SpecChange,
  WriteUpMaterialItem,
  WriteUpNewProduct,
  WriteUpPhoto,
  WriteUpStatus,
} from "./types";

export interface NumberedWorkItem {
  /** 1-based number within the section, stable across completion. */
  seq: number;
  label: string;
  notes?: string;
  /** Units this item affects ("Whole job" for a whole-job item). */
  units: string[];
  /** True only when the item is installed (done) on every unit it affects. */
  completed: boolean;
  /** True only when the item is reviewed on every unit it affects. */
  reviewed: boolean;
  /** Who last reviewed it + when (for the Write-Ups tab attribution). */
  reviewedByName?: string;
  reviewedAt?: string;
  /** The exact line items this collapses to, so the review action can flip
   *  them across every affected row. */
  sources: { rowId: string; index: number }[];
}

export interface SectionMaterialLine extends WriteUpMaterialItem {
  /** The units this line covers — several once identical lines are merged. */
  unitLabel: string | null;
  /** True when every work item this line was ordered for is installed, so the
   *  line is no longer something the office needs to buy. False for a line
   *  with no work item behind it (a write-up saved before materials were
   *  linked, or a line added in the flat edit form). */
  installed: boolean;
  /** Display numbers of the work items this line was ordered for. */
  workNumbers: number[];
}

/**
 * Split a write-up's material lines into the two things they actually are:
 * trim ordered from a lumber vendor by the piece, and parts ordered from
 * Andersen by part number. They share one stored list because a part has always
 * been saved as a material line, which left the office reading one blended
 * table and sorting it out by eye.
 *
 * A line with no `kind` is trim. Every write-up saved before the two lists were
 * split apart has no kind, and those have always been shown as trim — so an old
 * write-up reads exactly as it did before, parts included.
 */
export function splitMaterialLines<T extends WriteUpMaterialItem>(
  lines: T[]
): { trim: T[]; parts: T[] } {
  const trim: T[] = [];
  const parts: T[] = [];
  for (const m of lines) (m.kind === "part" ? parts : trim).push(m);
  return { trim, parts };
}

/**
 * Split a compiled list into what the office still has to buy and what the
 * field has already installed, so a table can total the first group and show
 * the second struck through underneath instead of counting it twice.
 */
export function splitInstalled<T extends { installed: boolean }>(
  lines: T[]
): { needed: T[]; installed: T[] } {
  return {
    needed: lines.filter((m) => !m.installed),
    installed: lines.filter((m) => m.installed),
  };
}

/** Pieces across a set of lines — the number in a table's QTY header. */
export function pcsOf(lines: { qty?: number }[]): number {
  return lines.reduce((sum, m) => sum + (m.qty || 0), 0);
}

/**
 * Collapse identical lines into one row, adding the quantities and combining
 * the lengths — the same thing the material-list maker does to the install
 * PDF's rows. Four work items that each need the same caulk are one line to
 * buy, not four, and the office was reading the unmerged list by eye.
 *
 * Installed state is part of the key, so finished work never merges into what's
 * still needed; the two groups stay separately countable.
 */
export function mergeMaterialLines(lines: SectionMaterialLine[]): SectionMaterialLine[] {
  const byKey = new Map<string, SectionMaterialLine>();
  const units = new Map<string, string[]>();
  const order: string[] = [];
  for (const m of lines) {
    // Unit of measure and vendor join the maker's item/color/species key: "2
    // Tubes" plus "2 PCS" is not 4 of anything, and two vendors are two orders.
    const key = [
      m.installed ? "done" : "need",
      m.kind === "part" ? "part" : "trim",
      m.profileId || "",
      (m.item || "").trim().toLowerCase(),
      (m.color || "").trim().toLowerCase(),
      (m.species || "").trim().toLowerCase(),
      (m.unit || "").trim().toLowerCase(),
      (m.vendor || "").trim().toLowerCase(),
      (m.size || "").trim().toLowerCase(),
      (m.partNumber || "").trim().toLowerCase(),
    ].join("|");
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, { ...m, workNumbers: [...m.workNumbers] });
      units.set(key, m.unitLabel ? [m.unitLabel] : []);
      order.push(key);
      continue;
    }
    seen.qty = (seen.qty || 0) + (m.qty || 0);
    seen.lengths = mergeLengths(seen.lengths, m.lengths);
    for (const n of m.workNumbers) if (!seen.workNumbers.includes(n)) seen.workNumbers.push(n);
    const u = units.get(key)!;
    if (m.unitLabel && !u.includes(m.unitLabel)) u.push(m.unitLabel);
  }
  return order.map((key) => {
    const row = byKey.get(key)!;
    const u = units.get(key)!;
    row.workNumbers.sort((a, b) => a - b);
    return { ...row, unitLabel: u.length ? u.join(", ") : null };
  });
}

export interface WriteUpSection {
  key: string;
  /** 1-based position of this write-up within the job (chronological). */
  index: number;
  createdAt: string;
  createdByName: string;
  updatedAt: string;
  updatedByName: string;
  status: WriteUpStatus;
  /** Latest updated_at across the rows, edited or not (the nudge fallback clock). */
  lastTouchedAt: string;
  /** Latest closed_at across the rows, or null if none was ever closed. */
  closedAt: string | null;
  /** Latest nudge snooze across the rows, or null. */
  nudgeSnoozedUntil: string | null;
  outstanding: NumberedWorkItem[];
  completed: NumberedWorkItem[];
  specChanges: SpecChange[];
  notes: { unitLabel: string | null; text: string }[];
  newProducts: { unitLabel: string | null; product: WriteUpNewProduct }[];
  photos: WriteUpPhoto[];
  /** Merged, still-needed lines first, then the installed ones. */
  materials: SectionMaterialLine[];
  /** Pieces the office still has to buy — installed work excluded. */
  outstandingPcs: number;
  /** Pieces on the lines whose work is already installed. */
  installedPcs: number;
  rows: FieldWorkOrder[];
}

function sectionKey(w: FieldWorkOrder): string {
  if (w.batchId) return w.batchId;
  // Legacy fallback: rows from one submission share created time to the minute.
  return `t:${(w.createdAt || "").slice(0, 16)}`;
}

function statusOf(rows: FieldWorkOrder[]): WriteUpStatus {
  if (rows.every((r) => r.status === "draft")) return "draft";
  if (rows.every((r) => r.status === "archived")) return "archived";
  if (rows.every((r) => r.status === "closed")) return "closed";
  if (rows.some((r) => r.status === "open")) return "open";
  if (rows.some((r) => r.status === "in_review")) return "in_review";
  return "open";
}

/** Split a job's write-ups into chronological, numbered sections. */
export function groupWriteUpSections(writeUps: FieldWorkOrder[]): WriteUpSection[] {
  const byKey = new Map<string, FieldWorkOrder[]>();
  for (const w of writeUps) {
    const k = sectionKey(w);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(w);
  }

  const sections: WriteUpSection[] = [];
  for (const [key, rows] of byKey) {
    // ── Number the work items (collapse fan-out duplicates) ──
    interface Agg {
      seq?: number;
      label: string;
      notes?: string;
      units: Set<string>;
      total: number;
      done: number;
      reviewed: number;
      reviewedByName?: string;
      reviewedAt?: string;
      sources: { rowId: string; index: number }[];
      order: number;
    }
    const groups = new Map<string, Agg>();
    let appearance = 0;
    for (const row of rows) {
      const unit = row.unitLabel || "Whole job";
      (row.lineItems || []).forEach((li, index) => {
        const gkey = li.seq != null ? `s:${li.seq}` : `l:${li.label.trim().toLowerCase()}`;
        let g = groups.get(gkey);
        if (!g) {
          g = { seq: li.seq, label: li.label, notes: li.notes, units: new Set(), total: 0, done: 0, reviewed: 0, sources: [], order: appearance++ };
          groups.set(gkey, g);
        }
        g.units.add(unit);
        g.total += 1;
        if (li.completed) g.done += 1;
        if (li.reviewed) {
          g.reviewed += 1;
          if (li.reviewedAt && (!g.reviewedAt || li.reviewedAt > g.reviewedAt)) {
            g.reviewedAt = li.reviewedAt;
            g.reviewedByName = li.reviewedByName || li.reviewedBy;
          }
        }
        g.sources.push({ rowId: row.id, index });
        if (!g.notes && li.notes) g.notes = li.notes;
      });
    }
    const ordered = [...groups.values()].sort((a, b) => {
      if (a.seq != null && b.seq != null) return a.seq - b.seq;
      if (a.seq != null) return -1;
      if (b.seq != null) return 1;
      return a.order - b.order;
    });
    // Assign numbers over the FULL order so completion never renumbers.
    const numbered: NumberedWorkItem[] = ordered.map((g, i) => ({
      seq: i + 1,
      label: g.label,
      notes: g.notes,
      units: [...g.units],
      completed: g.total > 0 && g.done === g.total,
      reviewed: g.total > 0 && g.reviewed === g.total,
      reviewedByName: g.reviewedByName,
      reviewedAt: g.reviewedAt,
      sources: g.sources,
    }));

    // ── Aggregate the rest across the section's rows ──
    const specChanges: SpecChange[] = [];
    const notes: { unitLabel: string | null; text: string }[] = [];
    const newProducts: { unitLabel: string | null; product: WriteUpNewProduct }[] = [];
    const photos: WriteUpPhoto[] = [];
    const materials: SectionMaterialLine[] = [];
    // A material line points at the work item it was ordered for by that item's
    // STORED seq. The display numbers are reassigned over the full canonical
    // order above, so they can differ — map one to the other rather than
    // assuming they match.
    const workByStoredSeq = new Map<number, { workNumber: number; completed: boolean }>();
    ordered.forEach((g, i) => {
      if (g.seq != null) workByStoredSeq.set(g.seq, { workNumber: i + 1, completed: numbered[i].completed });
    });
    for (const row of rows) {
      for (const c of row.specChanges || []) specChanges.push(c);
      if (row.notes && row.notes.trim()) notes.push({ unitLabel: row.unitLabel, text: row.notes });
      if (row.newProduct) newProducts.push({ unitLabel: row.unitLabel, product: row.newProduct });
      for (const p of row.photos || []) photos.push(p);
      for (const m of row.materialItems || []) {
        const work = m.workSeq != null ? workByStoredSeq.get(m.workSeq) : undefined;
        materials.push({
          ...m,
          unitLabel: row.unitLabel,
          installed: !!work?.completed,
          workNumbers: work ? [work.workNumber] : [],
        });
      }
    }
    // Merge identical lines, then still-needed first so every reader gets the
    // two groups in order without sorting again.
    const mergedMaterials = mergeMaterialLines(materials);
    const { needed: neededMaterials, installed: installedMaterials } = splitInstalled(mergedMaterials);

    const createdAt = rows.map((r) => r.createdAt).sort()[0] || "";
    const creator = rows.find((r) => r.createdAt === createdAt) || rows[0];
    const editedRows = rows.filter((r) => r.updatedBy && Math.abs(+new Date(r.updatedAt) - +new Date(r.createdAt)) > 60000);
    const lastEdited = editedRows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
    const latest = (vals: (string | null | undefined)[]): string | null =>
      vals.filter((v): v is string => !!v).sort().pop() || null;

    sections.push({
      key,
      index: 0, // set after sort
      createdAt,
      createdByName: creator.createdByName || creator.createdBy || "",
      updatedAt: lastEdited?.updatedAt || "",
      updatedByName: lastEdited ? lastEdited.updatedByName || lastEdited.updatedBy || "" : "",
      status: statusOf(rows),
      lastTouchedAt: latest(rows.map((r) => r.updatedAt)) || createdAt,
      closedAt: latest(rows.map((r) => r.closedAt)),
      nudgeSnoozedUntil: latest(rows.map((r) => r.nudgeSnoozedUntil)),
      outstanding: numbered.filter((n) => !n.completed),
      completed: numbered.filter((n) => n.completed),
      specChanges,
      notes,
      newProducts,
      photos,
      materials: [...neededMaterials, ...installedMaterials],
      outstandingPcs: pcsOf(neededMaterials),
      installedPcs: pcsOf(installedMaterials),
      rows,
    });
  }

  // Chronological: oldest write-up first, so "Write-up 1" is the earliest pass.
  sections.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  sections.forEach((s, i) => (s.index = i + 1));
  return sections;
}

/** Zero-padded work-item number, e.g. 3 → "003". */
export function padSeq(n: number): string {
  return String(n).padStart(3, "0");
}
