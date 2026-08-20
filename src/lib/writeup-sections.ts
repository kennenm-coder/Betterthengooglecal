// Groups a job's write-up rows into per-submission sections for the doc page
// and PDF, so two write-ups on the same job read as two separate, numbered
// blocks — each with its own work-to-complete list and its own material total.
//
// Grouping key: batch_id when present (migration 013), else the created time to
// the minute (legacy rows share a near-identical timestamp per submission).
//
// Work items are numbered 1..N within each section (restart per write-up). An
// issue that fanned out to several units is collapsed to ONE number listing the
// units. Numbers are assigned over the full canonical order, so completing an
// item never renumbers the others — completed items just move to their own list
// keeping the number they already had.

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
  unitLabel: string | null;
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
  outstanding: NumberedWorkItem[];
  completed: NumberedWorkItem[];
  specChanges: SpecChange[];
  notes: { unitLabel: string | null; text: string }[];
  newProducts: { unitLabel: string | null; product: WriteUpNewProduct }[];
  photos: WriteUpPhoto[];
  materials: SectionMaterialLine[];
  totalPcs: number;
  rows: FieldWorkOrder[];
}

function sectionKey(w: FieldWorkOrder): string {
  if (w.batchId) return w.batchId;
  // Legacy fallback: rows from one submission share created time to the minute.
  return `t:${(w.createdAt || "").slice(0, 16)}`;
}

function statusOf(rows: FieldWorkOrder[]): WriteUpStatus {
  if (rows.every((r) => r.status === "draft")) return "draft";
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
    for (const row of rows) {
      for (const c of row.specChanges || []) specChanges.push(c);
      if (row.notes && row.notes.trim()) notes.push({ unitLabel: row.unitLabel, text: row.notes });
      if (row.newProduct) newProducts.push({ unitLabel: row.unitLabel, product: row.newProduct });
      for (const p of row.photos || []) photos.push(p);
      for (const m of row.materialItems || []) materials.push({ ...m, unitLabel: row.unitLabel });
    }
    const totalPcs = materials.reduce((s, m) => s + (m.qty || 0), 0);

    const createdAt = rows.map((r) => r.createdAt).sort()[0] || "";
    const creator = rows.find((r) => r.createdAt === createdAt) || rows[0];
    const editedRows = rows.filter((r) => r.updatedBy && Math.abs(+new Date(r.updatedAt) - +new Date(r.createdAt)) > 60000);
    const lastEdited = editedRows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];

    sections.push({
      key,
      index: 0, // set after sort
      createdAt,
      createdByName: creator.createdByName || creator.createdBy || "",
      updatedAt: lastEdited?.updatedAt || "",
      updatedByName: lastEdited ? lastEdited.updatedByName || lastEdited.updatedBy || "" : "",
      status: statusOf(rows),
      outstanding: numbered.filter((n) => !n.completed),
      completed: numbered.filter((n) => n.completed),
      specChanges,
      notes,
      newProducts,
      photos,
      materials,
      totalPcs,
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
