"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  WorkOrder,
  MaterialUnit,
  WriteUpLineItem,
  SpecChange,
  WriteUpMaterialItem,
  WriteUpNewProduct,
  WriteUpPhoto,
  WriteUpStatus,
  FieldWorkOrder,
} from "@/lib/types";
import { useAuth } from "@/hooks/useAuth";
import CameraCapture from "./CameraCapture";
import {
  getWriteUpPresets,
  fetchCatalogPickItems,
  CatalogPickItem,
  fetchUnitOptions,
  UnitOptions,
  fetchTrimOptions,
  TrimOptions,
  fetchPartsCatalog,
  PartsCatalogItem,
  lengthsToQty,
  SPEC_FIELDS,
  unitLabelOf,
  submitWriteUpBatch,
  saveWriteUpBatchEdit,
  buildWriteUpMailto,
  updateWriteUp,
  deleteWriteUp,
  getSignedPhotoUrl,
  WriteUpEntryInput,
} from "@/lib/work-order-store";
import {
  WriteUpDraft,
  saveDraft,
  loadDraft,
  clearDraft,
  putDraftPhoto,
  getDraftPhoto,
  deleteDraftPhoto,
} from "@/lib/writeup-draft";
import { getWriteUpEmails } from "@/lib/action-settings";
import {
  X,
  Plus,
  Check,
  Loader2,
  Wrench,
  Pencil,
  Trash2,
  Package,
  Camera,
  ImagePlus,
  Send,
  RotateCcw,
  MessageSquare,
  StickyNote,
  AlertTriangle,
} from "lucide-react";

export type WriteUpTarget = Pick<
  WorkOrder,
  "orderNumber" | "workOrderNumber" | "customerName" | "address" | "materialJob"
>;

interface Props {
  order: WriteUpTarget;
  units: MaterialUnit[];
  initialUnit?: string | null;
  onClose: () => void;
  onSaved?: () => void;
  /** When set, the modal edits this existing write-up in place instead of
   *  creating new ones. */
  editWriteUp?: FieldWorkOrder;
  /** When set, edit a whole submission (all its unit rows) through the guided
   *  new-write-up flow, saving each row in place. Takes precedence over editWriteUp. */
  editBatch?: FieldWorkOrder[];
}

interface LocalPhoto {
  id: string;
  name: string;
  blob: Blob;
  /** Set for photos already uploaded (editing an existing write-up). */
  path?: string;
}


// ── Issue-first model (create) ──────────────────────────────────────────────
// Flat model (matches the old spreadsheet):
//   1. Background + financing + paint/stain notes
//   2. Units affected (picked or added manually) — a top-level list
//   3. Spec changes per unit
//   4. Work to complete (issues) — each references which units it affects
//   5. Trim / material — one list
//   6. Photos — one set

/** A unit affected by this write-up: identity + its spec corrections. */
interface WuUnit {
  key: string;
  isNewProduct: boolean;
  /** Programmed unit label, or the typed unit # for a new product. */
  unitLabel: string;
  unitType: string;
  /** Opt-in: only when checked does the spec-entry field show / save. */
  hasSpecChange: boolean;
  specEntries: SpecEntry[];
}

/** A part to order on an issue (from the catalog or custom). */
interface PartItem {
  key: string;
  name: string;
  productType?: string;
  qty: number;
  custom?: boolean;
  /** Which affected units need this part; empty = all affected units. */
  unitKeys: string[];
}

/** A work-to-complete item — its own materials + photos, references the units
 *  it affects (empty = whole job). */
interface WuIssue {
  id: string;
  label: string;
  note: string;
  /** "Something needs ordered" flag → parts + notes. */
  needsOrdering: boolean;
  parts: PartItem[];
  orderingNotes: string;
  unitKeys: string[];
  materials: WriteUpMaterialItem[];
  photos: LocalPhoto[];
}

/** Where the camera / upload is currently adding photos. */
type PhotoTarget = { kind: "edit" } | { kind: "issue"; issueId: string } | null;

const emptyProduct: WriteUpNewProduct = {
  type: "",
  size: "",
  exteriorColor: "",
  interiorColor: "",
  intFinish: "",
  details: "",
  frame: "",
};

// ── Spec catalog ───────────────────────────────────────────────────────────
// One master list of documentable specs. `kind` drives the value input:
// measurements use inches + fraction pickers (no typo-prone free text), colors/
// finish/species/stain get catalog type-ahead, the rest are plain text.
type SpecKind = "measure" | "color" | "finish" | "species" | "stain" | "text";

const SPEC_CATALOG: { label: string; kind: SpecKind }[] = [
  { label: "Width", kind: "measure" },
  { label: "Height", kind: "measure" },
  { label: "Exterior Color", kind: "color" },
  { label: "Interior Color", kind: "color" },
  { label: "Interior Finish", kind: "finish" },
  { label: "Frame", kind: "text" },
  { label: "Species", kind: "species" },
  { label: "Stain", kind: "stain" },
  { label: "Sub Type / Details", kind: "text" },
  { label: "Grilles", kind: "text" },
  { label: "Grille Pattern", kind: "text" },
  { label: "Glass / Low-E", kind: "text" },
  { label: "Tempered", kind: "text" },
  { label: "Screen", kind: "text" },
  { label: "Hardware / Lock Color", kind: "text" },
  { label: "Sash Operation", kind: "text" },
  { label: "Trim / Casing", kind: "text" },
  { label: "Jamb Depth", kind: "measure" },
];

const FRACTIONS_16 = [
  "0", "1/16", "1/8", "3/16", "1/4", "5/16", "3/8", "7/16",
  "1/2", "9/16", "5/8", "11/16", "3/4", "13/16", "7/8", "15/16",
];

function specKindOf(label: string): SpecKind {
  const hit = SPEC_CATALOG.find((s) => s.label.toLowerCase() === label.toLowerCase());
  if (hit) return hit.kind;
  const l = label.toLowerCase();
  if (l.includes("width") || l.includes("height") || l.includes("depth") || l.includes("size")) return "measure";
  if (l.includes("color") || l.includes("colour")) return "color";
  if (l.includes("finish")) return "finish";
  if (l.includes("species")) return "species";
  if (l.includes("stain")) return "stain";
  return "text";
}

/** inches + fraction → display string like `24 1/2"` (empty when blank). */
function composeMeasure(whole: string, frac: string): string {
  const w = (whole || "").trim();
  if (!w) return "";
  return `${w}${frac && frac !== "0" ? ` ${frac}` : ""}"`;
}

/** Parse `24 1/2"` back into inches + fraction for editing. */
function parseMeasure(value: string): { whole: string; frac: string } {
  const s = (value || "").replace(/["']/g, "").trim();
  if (!s) return { whole: "", frac: "0" };
  const parts = s.split(/\s+/);
  const whole = parts[0] || "";
  const frac = parts[1] && FRACTIONS_16.includes(parts[1]) ? parts[1] : "0";
  return { whole, frac };
}

/** Nearest 1/16 fraction label for a decimal fraction stored on a unit. */
function fracLabelFromNum(n: number | null | undefined): string {
  if (!n) return "0";
  const idx = Math.round(n * 16);
  return FRACTIONS_16[idx] || "0";
}

/** One documented spec on a unit — the working shape inside the editor. */
interface SpecEntry {
  id: string;
  label: string;
  kind: SpecKind;
  /** Current value on the programmed unit (blank for a manually-added product). */
  oldValue: string;
  /** New value for non-measure specs. */
  newValue: string;
  /** Inches + fraction for measure specs. */
  whole: string;
  frac: string;
}

function specEntryValue(e: SpecEntry): string {
  return e.kind === "measure" ? composeMeasure(e.whole, e.frac) : e.newValue.trim();
}

/** Read a unit's current value for a given spec label. */
function readCurrentSpec(unit: MaterialUnit, label: string): string {
  const f = SPEC_FIELDS.find((s) => s.label.toLowerCase() === label.toLowerCase());
  if (f) return f.read(unit);
  const l = label.toLowerCase();
  if (l === "width") return composeMeasure(String(unit.widthWhole || ""), fracLabelFromNum(unit.widthFrac));
  if (l === "height") return composeMeasure(String(unit.heightWhole || ""), fracLabelFromNum(unit.heightFrac));
  for (const line of String(unit.specDescription || "").split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0 && line.slice(0, idx).trim().toLowerCase() === l) return line.slice(idx + 1).trim();
  }
  return "";
}

/** Spec labels this unit actually carries (for quick suggestions). */
function unitSpecLabels(unit: MaterialUnit | null): string[] {
  if (!unit) return [];
  const labels = new Set<string>();
  for (const f of SPEC_FIELDS) if (f.read(unit)) labels.add(f.label);
  if (unit.widthWhole) labels.add("Width");
  if (unit.heightWhole) labels.add("Height");
  for (const line of String(unit.specDescription || "").split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) labels.add(line.slice(0, idx).trim());
  }
  return [...labels];
}

/** Rebuild editor spec entries from stored spec changes (edit / draft resume). */
function specEntriesFromChanges(changes: SpecChange[]): SpecEntry[] {
  return changes.map((c) => {
    const kind = specKindOf(c.field);
    const m = kind === "measure" ? parseMeasure(c.newValue) : { whole: "", frac: "0" };
    return {
      id: crypto.randomUUID(),
      label: c.field,
      kind,
      oldValue: c.oldValue,
      newValue: kind === "measure" ? "" : c.newValue,
      whole: m.whole,
      frac: m.frac,
    };
  });
}

export default function WriteUpModal({ order, units, onClose, onSaved, editWriteUp, editBatch }: Props) {
  const { user, autoCc } = useAuth();
  const isBatchEdit = !!editBatch && editBatch.length > 0;
  // The old single-row flat editor only applies when NOT doing a guided batch edit.
  const isEditing = !!editWriteUp && !isBatchEdit;
  const [presets, setPresets] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<CatalogPickItem[]>([]);
  const [options, setOptions] = useState<UnitOptions | null>(null);
  const [trimOptions, setTrimOptions] = useState<TrimOptions | null>(null);
  const [partsCatalog, setPartsCatalog] = useState<PartsCatalogItem[]>([]);

  // CREATE (flat model): background + notes, units, per-unit specs live on the
  // units, work-to-complete issues, one material list, one photo set.
  const [background, setBackground] = useState("");
  const [financingNotes, setFinancingNotes] = useState("");
  const [paintStainNotes, setPaintStainNotes] = useState("");
  const [wuUnits, setWuUnits] = useState<WuUnit[]>([]);
  const [issues, setIssues] = useState<WuIssue[]>([]);
  const [showSummary, setShowSummary] = useState(false);
  const [photoTarget, setPhotoTarget] = useState<PhotoTarget>(null);
  // EDIT: a single existing row loaded as a flat per-unit form.
  const [editWork, setEditWork] = useState<WriteUpLineItem[]>([]);
  const [editSpecs, setEditSpecs] = useState<SpecEntry[]>([]);
  const [editMaterials, setEditMaterials] = useState<WriteUpMaterialItem[]>([]);
  const [editPhotos, setEditPhotos] = useState<LocalPhoto[]>([]);
  const [editNote, setEditNote] = useState("");
  const [editUnitLabel, setEditUnitLabel] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  // Edit mode: status + saving flag
  const [status, setStatus] = useState<WriteUpStatus>(editWriteUp?.status || "open");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletingWriteUp, setDeletingWriteUp] = useState(false);

  const [pendingDraft, setPendingDraft] = useState<WriteUpDraft | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  // Photos taken with the in-app camera this session (by id) that haven't been
  // saved to the device yet. Library uploads are already in the roll, so they
  // aren't tracked here.
  const [cameraPhotoIds, setCameraPhotoIds] = useState<Set<string>>(new Set());
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [closing, setClosing] = useState(false); // "unsaved changes" guard

  useEffect(() => {
    getWriteUpPresets().then(setPresets);
    fetchCatalogPickItems().then(setCatalog).catch(() => setCatalog([]));
    fetchUnitOptions().then(setOptions).catch(() => setOptions(null));
    fetchTrimOptions().then(setTrimOptions).catch(() => setTrimOptions(null));
    fetchPartsCatalog().then(setPartsCatalog).catch(() => setPartsCatalog([]));
  }, []);

  // Self-heal: if the parts catalog came back empty (e.g. the first fetch fired
  // before the auth session was ready → RLS returned 0 rows), retry a couple of
  // times so the picker fills in without needing a page reload.
  useEffect(() => {
    if (partsCatalog.length > 0) return;
    let tries = 0;
    const t = setInterval(() => {
      tries += 1;
      fetchPartsCatalog()
        .then((rows) => {
          if (rows.length > 0) setPartsCatalog(rows);
        })
        .catch(() => {});
      if (tries >= 3) clearInterval(t);
    }, 2000);
    return () => clearInterval(t);
  }, [partsCatalog.length]);

  useEffect(() => {
    if (isEditing || isBatchEdit) return; // editing doesn't use the local draft system
    let cancelled = false;
    loadDraft(order.orderNumber).then((d) => {
      if (cancelled) return;
      const hasContent =
        d &&
        ((d.issues && d.issues.some((it) => it.label.trim() || it.materials?.length || it.photos?.length)) ||
          (d.units && d.units.length > 0) ||
          d.background?.trim() ||
          d.financingNotes?.trim() ||
          d.paintStainNotes?.trim());
      if (hasContent) {
        setPendingDraft(d);
      } else {
        setIssues([makeIssue()]);
        setDraftReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.orderNumber, isEditing]);

  // Edit mode: load the existing write-up (one unit) into the flat form.
  useEffect(() => {
    if (!editWriteUp) return;
    let cancelled = false;
    (async () => {
      const loaded: LocalPhoto[] = [];
      for (const p of editWriteUp.photos) {
        const url = await getSignedPhotoUrl(p.path);
        if (!url) continue;
        try {
          const res = await fetch(url);
          if (res.ok) {
            const blob = await res.blob();
            loaded.push({ id: crypto.randomUUID(), name: p.name, blob, path: p.path });
          }
        } catch {
          /* skip a photo that won't load */
        }
      }
      if (cancelled) return;
      setEditWork(editWriteUp.lineItems);
      setEditSpecs(specEntriesFromChanges(editWriteUp.specChanges));
      setEditMaterials(editWriteUp.materialItems);
      setEditNote(editWriteUp.notes);
      setEditPhotos(loaded);
      setEditUnitLabel(editWriteUp.unitLabel || "");
      setStatus(editWriteUp.status);
      setDraftReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editWriteUp]);

  // Batch edit: load a whole submission into the guided (new-write-up) flow.
  // The text + structure fill in immediately; photos download in the background
  // and attach a moment later, so the form never sits blank.
  useEffect(() => {
    if (!isBatchEdit || !editBatch) return;
    let cancelled = false;

    // ── Phase 1 (synchronous): everything except photo blobs ──
    // Whole-job notes → background / financing / paint.
    let bg = "", fin = "", paint = "";
    for (const r of editBatch) {
      if (!r.notes) continue;
      const rest: string[] = [];
      for (const seg of r.notes.split("\n\n")) {
        if (seg.startsWith("Financing notes: ")) fin = seg.slice("Financing notes: ".length);
        else if (seg.startsWith("Paint & stain notes: ")) paint = seg.slice("Paint & stain notes: ".length);
        else rest.push(seg);
      }
      const restText = rest.join("\n\n").trim();
      if (restText && !bg) bg = restText;
    }
    setBackground(bg);
    setFinancingNotes(fin);
    setPaintStainNotes(paint);

    // Units = rows with a unit label (the whole-job row, null, isn't a unit).
    const unitRows = editBatch.filter((r) => r.unitLabel);
    const labelToKey = new Map<string, string>();
    const hydUnits: WuUnit[] = unitRows.map((r) => {
      const key = crypto.randomUUID();
      labelToKey.set((r.unitLabel || "").trim(), key);
      return {
        key,
        isNewProduct: !!r.newProduct,
        unitLabel: r.unitLabel || "",
        unitType: r.newProduct?.type || "",
        hasSpecChange: r.specChanges.length > 0,
        specEntries: specEntriesFromChanges(r.specChanges),
      };
    });
    setWuUnits(hydUnits);

    // Issues = line items grouped by their number (or label) across rows.
    interface IAgg { key: string; label: string; note: string; needsOrdering: boolean; orderingNotes: string; unitKeys: Set<string>; order: number; }
    const iMap = new Map<string, IAgg>();
    let order = 0;
    for (const r of editBatch) {
      for (const li of r.lineItems) {
        const gk = li.seq != null ? `s:${li.seq}` : `l:${li.label.trim().toLowerCase()}`;
        let g = iMap.get(gk);
        if (!g) {
          let note = "", needsOrdering = false, orderingNotes = "";
          for (const b of (li.notes || "").split(" · ")) {
            if (b.startsWith("NEEDS ORDERED: ")) { needsOrdering = true; orderingNotes = b.slice("NEEDS ORDERED: ".length); }
            else if (b === "NEEDS ORDERED") needsOrdering = true;
            else if (b.trim()) note = note ? `${note} · ${b}` : b;
          }
          g = { key: crypto.randomUUID(), label: li.label, note, needsOrdering, orderingNotes, unitKeys: new Set(), order: order++ };
          iMap.set(gk, g);
        }
        const k = r.unitLabel ? labelToKey.get(r.unitLabel.trim()) : undefined;
        if (k) g.unitKeys.add(k);
      }
    }
    const issueAggs = [...iMap.values()].sort((a, b) => a.order - b.order);

    // Best guess: attach each row's materials + photos to an issue that affects
    // that unit (materials/photos are stored per-unit, not per-issue). Photos
    // are held by path here; their blobs download in phase 2.
    const matByIssue = new Map<string, WriteUpMaterialItem[]>();
    const photoPathsByIssue = new Map<string, WriteUpPhoto[]>();
    const targetFor = (unitKey: string | null): IAgg | undefined => {
      if (unitKey) {
        const m = issueAggs.find((g) => g.unitKeys.has(unitKey));
        if (m) return m;
      }
      return issueAggs.find((g) => g.unitKeys.size === 0) || issueAggs[0];
    };
    for (const r of editBatch) {
      const unitKey = r.unitLabel ? labelToKey.get(r.unitLabel.trim()) || null : null;
      const target = targetFor(unitKey);
      if (!target) continue;
      if (r.materialItems.length) matByIssue.set(target.key, [...(matByIssue.get(target.key) || []), ...r.materialItems]);
      if (r.photos.length) photoPathsByIssue.set(target.key, [...(photoPathsByIssue.get(target.key) || []), ...r.photos]);
    }

    const hydIssues: WuIssue[] = issueAggs.map((g) => ({
      id: g.key,
      label: g.label,
      note: g.note,
      needsOrdering: g.needsOrdering,
      parts: [],
      orderingNotes: g.orderingNotes,
      unitKeys: [...g.unitKeys],
      materials: matByIssue.get(g.key) || [],
      photos: [],
    }));
    setIssues(hydIssues.length ? hydIssues : [makeIssue()]);
    setStatus(editBatch[0].status);
    setDraftReady(true);

    // ── Phase 2 (background): download photo blobs, then attach them ──
    (async () => {
      const photoByPath = new Map<string, LocalPhoto>();
      for (const r of editBatch) {
        for (const p of r.photos) {
          if (photoByPath.has(p.path)) continue;
          const url = await getSignedPhotoUrl(p.path);
          if (!url) continue;
          try {
            const res = await fetch(url);
            if (res.ok) photoByPath.set(p.path, { id: crypto.randomUUID(), name: p.name, blob: await res.blob(), path: p.path });
          } catch {
            /* skip a photo that won't load */
          }
        }
      }
      if (cancelled || photoByPath.size === 0) return;
      setIssues((prev) =>
        prev.map((i) => {
          const paths = photoPathsByIssue.get(i.id);
          if (!paths || paths.length === 0) return i;
          const photos = paths.map((pp) => photoByPath.get(pp.path)).filter((x): x is LocalPhoto => !!x);
          return photos.length ? { ...i, photos } : i;
        })
      );
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBatchEdit]);

  const unitOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: { label: string; unit: MaterialUnit }[] = [];
    for (const u of units) {
      if (u.isMisc) continue;
      const label = unitLabelOf(u);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      opts.push({ label, unit: u });
    }
    return opts;
  }, [units]);

  // ── Units affected (create): top-level list + per-unit specs ──
  function makeWuUnit(opts: { isNewProduct: boolean; unitLabel: string }): WuUnit {
    const u = opts.isNewProduct ? null : unitOptions.find((o) => o.label === opts.unitLabel)?.unit || null;
    return {
      key: crypto.randomUUID(),
      isNewProduct: opts.isNewProduct,
      unitLabel: opts.unitLabel,
      unitType: u ? String(u.unitType || u.type || u.summarySubType || "") : "",
      hasSpecChange: false,
      specEntries: [],
    };
  }
  function toggleUnit(label: string) {
    const existing = wuUnits.find((u) => !u.isNewProduct && u.unitLabel === label);
    if (existing) {
      setWuUnits((prev) => prev.filter((u) => u.key !== existing.key));
      setIssues((is) => is.map((it) => ({ ...it, unitKeys: it.unitKeys.filter((k) => k !== existing.key) })));
    } else {
      setWuUnits((prev) => [...prev, makeWuUnit({ isNewProduct: false, unitLabel: label })]);
    }
  }
  function addManualUnit() {
    setWuUnits((prev) => [...prev, makeWuUnit({ isNewProduct: true, unitLabel: "" })]);
  }
  function updateUnit(key: string, patch: Partial<WuUnit>) {
    setWuUnits((prev) => prev.map((u) => (u.key === key ? { ...u, ...patch } : u)));
  }
  function removeUnit(key: string) {
    setWuUnits((prev) => prev.filter((u) => u.key !== key));
    setIssues((is) => is.map((it) => ({ ...it, unitKeys: it.unitKeys.filter((k) => k !== key) })));
  }
  function unitObjFor(u: WuUnit): MaterialUnit | null {
    if (u.isNewProduct || !u.unitLabel) return null;
    return unitOptions.find((o) => o.label === u.unitLabel)?.unit || null;
  }
  const unitTitle = (u: WuUnit) =>
    u.isNewProduct ? (u.unitLabel.trim() ? `Unit ${u.unitLabel.trim()}` : "New product") : u.unitLabel || "Whole job";

  // ── Work to complete (create): issues that reference affected units ──
  function makeIssue(): WuIssue {
    return { id: crypto.randomUUID(), label: "", note: "", needsOrdering: false, parts: [], orderingNotes: "", unitKeys: [], materials: [], photos: [] };
  }
  function addIssue() {
    setIssues((prev) => [...prev, makeIssue()]);
  }
  function updateIssue(id: string, patch: Partial<WuIssue>) {
    setIssues((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }
  function removeIssue(id: string) {
    setIssues((prev) => {
      const it = prev.find((x) => x.id === id);
      if (it) for (const p of it.photos) deleteDraftPhoto(p.id);
      return prev.filter((x) => x.id !== id);
    });
  }
  function toggleIssueUnit(issueId: string, unitKey: string) {
    setIssues((prev) =>
      prev.map((it) => {
        if (it.id !== issueId) return it;
        const has = it.unitKeys.includes(unitKey);
        return { ...it, unitKeys: has ? it.unitKeys.filter((k) => k !== unitKey) : [...it.unitKeys, unitKey] };
      })
    );
  }

  // ── Edit-mode work items ──
  function addWorkItem(label: string, kind: "preset" | "custom") {
    const v = label.trim();
    if (!v) return;
    if (editWork.some((w) => w.label.toLowerCase() === v.toLowerCase())) return;
    setEditWork((prev) => [...prev, { kind, label: v }]);
  }
  function removeWorkItem(i: number) {
    setEditWork((prev) => prev.filter((_, j) => j !== i));
  }
  function setWorkItemNotes(i: number, notes: string | undefined) {
    setEditWork((prev) => prev.map((w, j) => (j === i ? { ...w, notes } : w)));
  }
  function toggleWorkItemComplete(i: number) {
    setEditWork((prev) => prev.map((w, j) => (j === i ? { ...w, completed: !w.completed } : w)));
  }
  function changeStatus(s: WriteUpStatus) {
    setStatus(s);
    if (s === "closed") setEditWork((prev) => prev.map((w) => ({ ...w, completed: true })));
  }
  const editUnit =
    unitOptions.find((o) => o.label === editUnitLabel)?.unit || null;

  // ── Photos (edit = the row's photos; create = per work-item) ──
  function untrackCamera(photoId: string) {
    setCameraPhotoIds((prev) => {
      if (!prev.has(photoId)) return prev;
      const n = new Set(prev);
      n.delete(photoId);
      return n;
    });
  }
  async function addPhotosTo(target: PhotoTarget, files: File[], fromCamera = false) {
    if (!target) return;
    const added: LocalPhoto[] = files.map((f) => ({ id: crypto.randomUUID(), name: f.name || "photo", blob: f }));
    for (const a of added) putDraftPhoto(a.id, a.blob);
    if (target.kind === "edit") {
      setEditPhotos((prev) => [...prev, ...added]);
    } else {
      setIssues((prev) => prev.map((it) => (it.id === target.issueId ? { ...it, photos: [...it.photos, ...added] } : it)));
    }
    if (fromCamera) setCameraPhotoIds((prev) => { const n = new Set(prev); added.forEach((a) => n.add(a.id)); return n; });
  }
  function removeEditPhoto(photoId: string) {
    setEditPhotos((prev) => prev.filter((p) => p.id !== photoId));
    untrackCamera(photoId);
    deleteDraftPhoto(photoId);
  }
  function removeIssuePhoto(issueId: string, photoId: string) {
    setIssues((prev) => prev.map((it) => (it.id === issueId ? { ...it, photos: it.photos.filter((p) => p.id !== photoId) } : it)));
    untrackCamera(photoId);
    deleteDraftPhoto(photoId);
  }
  function openCamera(target: PhotoTarget) {
    setPhotoTarget(target);
    setShowCamera(true);
  }

  const allPhotos = isEditing ? editPhotos : issues.flatMap((it) => it.photos);
  const unsavedCameraPhotos = allPhotos.filter((p) => cameraPhotoIds.has(p.id));

  function photoToFile(p: LocalPhoto): File {
    return p.blob instanceof File
      ? p.blob
      : new File([p.blob], p.name || "photo.jpg", { type: p.blob.type || "image/jpeg" });
  }
  async function saveAllToDevice() {
    const files = unsavedCameraPhotos.map(photoToFile);
    if (files.length === 0) return;
    const nav = navigator as Navigator & {
      canShare?: (data?: unknown) => boolean;
      share?: (data?: unknown) => Promise<void>;
    };
    try {
      if (nav.share && nav.canShare && nav.canShare({ files })) {
        await nav.share({ files });
      } else {
        for (const file of files) {
          const url = URL.createObjectURL(file);
          const a = document.createElement("a");
          a.href = url;
          a.download = file.name || "photo.jpg";
          a.click();
          URL.revokeObjectURL(url);
        }
      }
      setCameraPhotoIds(new Set());
    } catch {
      /* cancelled */
    }
    setShowSavePrompt(false);
  }

  // ── Derived ──
  function specChangesOf(entries: SpecEntry[], label: string): SpecChange[] {
    const out: SpecChange[] = [];
    for (const e of entries) {
      const v = specEntryValue(e);
      if (v && v !== e.oldValue.trim()) out.push({ unitLabel: label, field: e.label, oldValue: e.oldValue, newValue: v });
    }
    return out;
  }
  const unitLabelOfWu = (u: WuUnit) => (u.isNewProduct ? u.unitLabel.trim() : u.unitLabel);
  const unitValid = (u: WuUnit) => (u.isNewProduct ? u.unitLabel.trim().length > 0 && u.unitType.trim().length > 0 : true);
  const validUnits = wuUnits.filter(unitValid);
  const validIssues = issues.filter((it) => it.label.trim().length > 0);

  const editHasContent =
    editWork.length > 0 ||
    editSpecs.some((e) => specEntryValue(e).length > 0) ||
    editMaterials.length > 0 ||
    editPhotos.length > 0 ||
    editNote.trim().length > 0;
  const createHasContent =
    validIssues.length > 0 ||
    validUnits.some((u) => u.hasSpecChange && u.specEntries.some((e) => specEntryValue(e).length > 0)) ||
    issues.some((it) => it.materials.length > 0 || it.photos.length > 0) ||
    background.trim().length > 0 ||
    financingNotes.trim().length > 0 ||
    paintStainNotes.trim().length > 0;
  const editorHasContent = isEditing ? editHasContent : createHasContent;

  /** Fan out to one row per affected unit, plus a whole-job row that carries
   *  general work, the background/notes, the material list, and the photos. */
  function buildInputs(): WriteUpEntryInput[] {
    interface Agg {
      unitLabel: string | null;
      isNewProduct: boolean;
      unitType: string;
      tasks: WriteUpLineItem[];
      specs: SpecChange[];
      materials: WriteUpMaterialItem[];
      photos: LocalPhoto[];
      notes: string;
    }
    const byKey = new Map<string, Agg>();
    const WHOLE = "__whole__";
    const whole = (): Agg => {
      let a = byKey.get(WHOLE);
      if (!a) {
        a = { unitLabel: null, isNewProduct: false, unitType: "", tasks: [], specs: [], materials: [], photos: [], notes: "" };
        byKey.set(WHOLE, a);
      }
      return a;
    };
    // One row per affected unit — captures its spec changes.
    for (const u of validUnits) {
      const label = unitLabelOfWu(u);
      byKey.set(u.key, {
        unitLabel: label || null,
        isNewProduct: u.isNewProduct,
        unitType: u.unitType.trim(),
        tasks: [],
        specs: u.hasSpecChange ? specChangesOf(u.specEntries, label) : [],
        materials: [],
        photos: [],
        notes: "",
      });
    }
    // Issues → tasks (+ their own materials/photos) onto their affected units,
    // or the whole-job bucket. Each issue gets a stable 1-based number (seq)
    // shared across every unit it fans out to, so the doc/PDF number it once.
    validIssues.forEach((it, issueIdx) => {
      const noteBits = [
        it.note.trim(),
        it.needsOrdering && it.orderingNotes.trim() ? `NEEDS ORDERED: ${it.orderingNotes.trim()}` : it.needsOrdering ? "NEEDS ORDERED" : "",
      ].filter(Boolean);
      const task: WriteUpLineItem = { kind: "custom", label: it.label.trim(), notes: noteBits.join(" · ") || undefined, seq: issueIdx + 1 };
      const keys = it.unitKeys.filter((k) => byKey.has(k));
      const targets = keys.length === 0 ? [whole()] : keys.map((k) => byKey.get(k)!);
      const partToMaterial = (p: PartItem): WriteUpMaterialItem => ({
        item: p.productType ? `${p.name.trim()} (${p.productType})` : p.name.trim(),
        color: "",
        species: "",
        qty: p.qty > 0 ? p.qty : 1,
        unit: "EA",
        lengths: "",
        vendor: "",
        custom: p.custom,
      });
      // Parts checked for specific units go on each of those units' rows; the
      // rest (no units checked = all affected) go on the item's first target.
      const namedParts = it.needsOrdering ? it.parts.filter((p) => p.name.trim()) : [];
      const generalParts: PartItem[] = [];
      for (const p of namedParts) {
        const valid = (p.unitKeys || []).filter((k) => byKey.has(k));
        if (valid.length === 0) generalParts.push(p);
        else for (const k of valid) byKey.get(k)!.materials.push(partToMaterial(p));
      }
      const generalPartMaterials = generalParts.map(partToMaterial);
      targets.forEach((a, idx) => {
        a.tasks.push(task);
        // Attach this item's materials + photos to just its first target (no dupes).
        if (idx === 0) {
          a.materials.push(...generalPartMaterials, ...it.materials);
          a.photos.push(...it.photos);
        }
      });
    });
    // Background + notes go on the whole-job row.
    const noteParts = [
      background.trim(),
      financingNotes.trim() ? `Financing notes: ${financingNotes.trim()}` : "",
      paintStainNotes.trim() ? `Paint & stain notes: ${paintStainNotes.trim()}` : "",
    ].filter(Boolean);
    if (noteParts.length) whole().notes = noteParts.join("\n\n");
    return [...byKey.values()]
      .filter((a) => a.tasks.length || a.specs.length || a.materials.length || a.photos.length || a.notes.trim())
      .map((a) => ({
        unitLabel: a.unitLabel,
        lineItems: a.tasks,
        specChanges: a.specs,
        materialItems: a.materials,
        newProduct: a.isNewProduct ? { ...emptyProduct, type: a.unitType } : null,
        notes: a.notes,
        photos: a.photos.map((p) => ({ blob: p.path ? undefined : p.blob, path: p.path, name: p.name })),
      }));
  }

  // ── Draft (de)serialization ── (create only)
  async function photosFromDraft(refs: { id: string; name: string }[]): Promise<LocalPhoto[]> {
    const out: LocalPhoto[] = [];
    for (const p of refs) {
      const blob = await getDraftPhoto(p.id);
      if (blob) out.push({ id: p.id, name: p.name, blob });
    }
    return out;
  }
  async function resumeDraft() {
    if (!pendingDraft) return;
    setBackground(pendingDraft.background || "");
    setFinancingNotes(pendingDraft.financingNotes || "");
    setPaintStainNotes(pendingDraft.paintStainNotes || "");
    setWuUnits(
      (pendingDraft.units || []).map((u) => ({
        key: u.key,
        isNewProduct: u.isNewProduct,
        unitLabel: u.unitLabel,
        unitType: u.unitType,
        hasSpecChange: u.hasSpecChange ?? (u.specChanges?.length > 0),
        specEntries: specEntriesFromChanges(u.specChanges),
      }))
    );
    const dIssues = pendingDraft.issues || [];
    const restored = await Promise.all(
      dIssues.map(async (it) => ({
        id: it.id,
        label: it.label,
        note: it.note,
        needsOrdering: !!it.needsOrdering,
        parts: (it.parts || []).map((p) => ({ key: p.key, name: p.name, productType: p.productType, qty: p.qty, custom: p.custom, unitKeys: p.unitKeys || [] })),
        orderingNotes: it.orderingNotes || "",
        unitKeys: it.unitKeys,
        materials: it.materials || [],
        photos: await photosFromDraft(it.photos || []),
      }))
    );
    setIssues(restored.length > 0 ? restored : [makeIssue()]);
    setPendingDraft(null);
    setDraftReady(true);
  }
  async function discardDraft() {
    await clearDraft(order.orderNumber);
    setPendingDraft(null);
    setBackground("");
    setFinancingNotes("");
    setPaintStainNotes("");
    setWuUnits([]);
    setIssues([makeIssue()]);
    setDraftReady(true);
  }
  function buildDraftNow(): WriteUpDraft | null {
    if (!createHasContent) return null;
    return {
      orderNumber: order.orderNumber,
      updatedAt: new Date().toISOString(),
      background,
      financingNotes,
      paintStainNotes,
      units: wuUnits.map((u) => ({
        key: u.key,
        isNewProduct: u.isNewProduct,
        unitLabel: u.unitLabel,
        unitType: u.unitType,
        hasSpecChange: u.hasSpecChange,
        specChanges: u.specEntries.map((e) => ({ unitLabel: unitLabelOfWu(u), field: e.label, oldValue: e.oldValue, newValue: specEntryValue(e) })),
      })),
      issues: issues.map((it) => ({
        id: it.id,
        label: it.label,
        note: it.note,
        needsOrdering: it.needsOrdering,
        parts: it.parts.map((p) => ({ key: p.key, name: p.name, productType: p.productType, qty: p.qty, custom: p.custom, unitKeys: p.unitKeys })),
        orderingNotes: it.orderingNotes,
        unitKeys: it.unitKeys,
        materials: it.materials,
        photos: it.photos.map((p) => ({ id: p.id, name: p.name })),
      })),
    };
  }

  // Keep a live pointer to the current flush so background/crash handlers save
  // the latest state without re-binding listeners on every keystroke.
  const flushRef = useRef<() => void>(() => {});
  flushRef.current = () => {
    if (isEditing || isBatchEdit || !draftReady || submitting) return;
    const d = buildDraftNow();
    if (d) saveDraft(d);
    else clearDraft(order.orderNumber);
  };

  // Flush immediately when the app is backgrounded or closed (crash-safe-ish).
  useEffect(() => {
    const flush = () => flushRef.current?.();
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  // ── Auto-save (debounced) ──
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isEditing || isBatchEdit || !draftReady || submitting) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const d = buildDraftNow();
      if (!d) {
        clearDraft(order.orderNumber);
        return;
      }
      saveDraft(d);
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1500);
    }, 700);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftReady, issues, wuUnits, background, financingNotes, paintStainNotes]);

  // ── Close guard ──
  const dirty = editorHasContent;
  function attemptClose() {
    if (isEditing) {
      onClose(); // edit mode: no draft to preserve
      return;
    }
    if (dirty) setClosing(true);
    else onClose();
  }

  async function saveChanges() {
    if (!editWriteUp || saving) return;
    setSaving(true);
    setError("");
    const label = editWriteUp.newProduct ? editUnitLabel.trim() : editUnitLabel;
    const keepPhotos: WriteUpPhoto[] = editPhotos
      .filter((p) => p.path)
      .map((p) => ({ path: p.path!, name: p.name }));
    const newPhotoFiles = editPhotos.filter((p) => !p.path).map((p) => p.blob);
    const res = await updateWriteUp(editWriteUp.id, {
      orderNumber: order.orderNumber || editWriteUp.orderNumber,
      unitLabel: editUnitLabel.trim() || null,
      lineItems: editWork,
      specChanges: specChangesOf(editSpecs, label),
      materialItems: editMaterials,
      newProduct: editWriteUp.newProduct,
      notes: editNote.trim(),
      status,
      keepPhotos,
      newPhotoFiles,
      updatedBy: user?.email || "",
      updatedByName: user?.email?.split("@")[0] || "",
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error ? `Couldn't save: ${res.error}` : "Couldn't save changes — try again.");
      return;
    }
    onSaved?.();
    onClose();
  }

  async function handleDeleteWriteUp() {
    if (deletingWriteUp) return;
    // Batch edit deletes every row of the submission; flat edit deletes one row.
    const rows = isBatchEdit ? editBatch || [] : editWriteUp ? [editWriteUp] : [];
    if (rows.length === 0) return;
    setDeletingWriteUp(true);
    setError("");
    for (const r of rows) {
      const res = await deleteWriteUp(
        r.id,
        r.photos.map((p) => p.path)
      );
      if (!res.ok) {
        setDeletingWriteUp(false);
        setError(res.error ? `Couldn't delete: ${res.error}` : "Couldn't delete the write-up — try again.");
        return;
      }
    }
    setDeletingWriteUp(false);
    onSaved?.();
    onClose();
  }

  // Save an edited write-up submission in place through the guided flow.
  async function saveGuidedEdit() {
    if (!isBatchEdit || !editBatch || saving) return;
    if (validIssues.length === 0 && !createHasContent) {
      setError("Add at least one work item.");
      return;
    }
    setSaving(true);
    setError("");
    const ctx = {
      orderNumber: order.orderNumber || editBatch[0].orderNumber,
      batchId: editBatch[0].batchId || crypto.randomUUID(),
      workOrderNumber: order.workOrderNumber || editBatch[0].workOrderNumber,
      jobId: order.materialJob?.id || editBatch[0].jobId || null,
      customerName: order.customerName || editBatch[0].customerName,
      address: order.address || editBatch[0].address,
      createdBy: editBatch[0].createdBy,
      createdByName: editBatch[0].createdByName,
      updatedBy: user?.email || "",
      updatedByName: user?.email?.split("@")[0] || "",
      status,
    };
    const res = await saveWriteUpBatchEdit(editBatch, ctx, buildInputs(), (done, total) =>
      setProgress({ done, total })
    );
    setSaving(false);
    setProgress(null);
    if (!res.ok) {
      setError(res.error ? `Couldn't save: ${res.error}` : "Couldn't save the changes — try again.");
      return;
    }
    onSaved?.();
    onClose();
  }
  async function saveAndClose() {
    const d = buildDraftNow();
    if (d) await saveDraft(d);
    onClose();
  }
  async function discardAndClose() {
    await clearDraft(order.orderNumber);
    onClose();
  }

  async function submitWriteUp(sendEmail: boolean, startStatus: WriteUpStatus = "in_review") {
    if (startStatus !== "draft" && validIssues.length === 0) {
      setError("Add at least one issue with a description and a scope.");
      return;
    }
    if (startStatus === "draft" && !createHasContent) {
      setError("Nothing to save yet — add some detail first.");
      return;
    }

    setSubmitting(true);
    setError("");
    const ctx = {
      orderNumber: order.orderNumber,
      workOrderNumber: order.workOrderNumber,
      jobId: order.materialJob?.id || null,
      customerName: order.customerName,
      address: order.address,
      createdBy: user?.email || "",
      createdByName: user?.email?.split("@")[0] || "",
      status: startStatus,
    };
    const inputs: WriteUpEntryInput[] = buildInputs();

    const { created, error: saveError } = await submitWriteUpBatch(ctx, inputs, (done, total) =>
      setProgress({ done, total })
    );
    setSubmitting(false);
    setProgress(null);

    if (created.length === 0) {
      // Show the actual database reason so it's fixable (RLS, permissions, etc.).
      // The draft is untouched, so nothing is lost.
      setError(
        saveError
          ? `Couldn't save: ${saveError} — it's still saved as a draft, try again.`
          : "Could not save the write-up. It's still saved as a draft — try again."
      );
      return;
    }

    await clearDraft(order.orderNumber);

    if (sendEmail) {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const docLink = `${origin}/work-orders/${encodeURIComponent(order.orderNumber)}`;
      const toEmails = await getWriteUpEmails();
      const mailto = buildWriteUpMailto(ctx, inputs, docLink, toEmails, autoCc);
      if (typeof window !== "undefined") window.location.href = mailto;
    }

    onSaved?.();
    onClose();
  }

  const totalUnits = buildInputs().length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) attemptClose();
      }}
    >
      {/* Unsaved-changes close guard */}
      {closing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-6">
          <div className="bg-background rounded-2xl shadow-xl w-full max-w-xs p-5 text-center">
            <RotateCcw className="w-8 h-8 text-amber-600 mx-auto mb-2" />
            <p className="font-semibold">Leave this write-up?</p>
            <p className="text-xs text-muted mt-1">
              Your progress is saved as a draft — you can resume it later, or discard it now.
            </p>
            <div className="mt-4 space-y-2">
              <button onClick={() => setClosing(false)} className="w-full py-3 rounded-xl bg-amber-500 text-white text-sm font-semibold">
                Keep editing
              </button>
              <button onClick={saveAndClose} className="w-full py-3 rounded-xl border border-border text-sm font-medium">
                Save draft &amp; close
              </button>
              <button onClick={discardAndClose} className="w-full py-3 rounded-xl text-sm font-medium text-danger">
                Discard write-up
              </button>
            </div>
          </div>
        </div>
      )}

      {showSavePrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-6">
          <div className="bg-background rounded-2xl shadow-xl w-full max-w-xs p-5 text-center">
            <Camera className="w-8 h-8 text-amber-600 mx-auto mb-2" />
            <p className="font-semibold">
              Save {unsavedCameraPhotos.length} photo{unsavedCameraPhotos.length !== 1 ? "s" : ""} to your device?
            </p>
            <p className="text-xs text-muted mt-1">
              They&apos;re already attached to the write-up. Saving also keeps a copy in your camera roll.
            </p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowSavePrompt(false)} className="flex-1 py-3 rounded-xl border border-border text-sm font-medium">
                Not now
              </button>
              <button onClick={saveAllToDevice} className="flex-1 py-3 rounded-xl bg-amber-500 text-white text-sm font-semibold">
                Save all
              </button>
            </div>
          </div>
        </div>
      )}

      {showCamera && (
        <CameraCapture
          onDone={(files) => {
            if (files.length) {
              addPhotosTo(photoTarget, files, true);
              // Back on the write-up screen, ask whether to also save the shots
              // to the camera roll (they're already attached to the write-up).
              setShowSavePrompt(true);
            }
          }}
          onClose={() => {
            setShowCamera(false);
            setPhotoTarget(null);
          }}
        />
      )}

      <div className="bg-background w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl h-[96vh] sm:h-auto sm:max-h-[94vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Wrench className="w-5 h-5 text-amber-600 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-base font-semibold leading-tight">
                {isEditing || isBatchEdit ? "Edit Write-Up" : "Field Write-Up"}
              </h2>
              <p className="text-xs text-muted leading-tight truncate">
                {order.customerName} · #{order.orderNumber}
                {savedTick && <span className="text-green-600"> · saved</span>}
              </p>
            </div>
          </div>
          <button onClick={attemptClose} className="p-2 rounded-lg hover:bg-surface text-muted shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {pendingDraft && (
          <div className="mx-4 mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-3 shrink-0">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <RotateCcw className="w-4 h-4 text-amber-600" />
              Unfinished write-up found
            </p>
            <p className="text-xs text-muted mt-0.5">
              Saved {new Date(pendingDraft.updatedAt).toLocaleString()} ·{" "}
              {(pendingDraft.issues?.length ?? 0)} issue(s)
            </p>
            <div className="flex gap-2 mt-2.5">
              <button onClick={resumeDraft} className="flex-1 py-3 rounded-xl bg-amber-500 text-white text-sm font-semibold">
                Resume
              </button>
              <button onClick={discardDraft} className="flex-1 py-3 rounded-xl border border-border text-sm font-medium">
                Start fresh
              </button>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          {/* Status — edit mode only */}
          {(isEditing || isBatchEdit) && (
            <section>
              <SectionLabel>Status</SectionLabel>
              <div className="flex gap-2 mt-2">
                {(["draft", "in_review", "open", "closed"] as WriteUpStatus[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => changeStatus(s)}
                    className={`flex-1 py-2.5 rounded-lg text-xs font-medium border transition-colors ${
                      status === s ? "bg-amber-500 border-amber-500 text-white" : "border-border text-muted"
                    }`}
                  >
                    {{ draft: "Draft", in_review: "In review", open: "Open", closed: "Closed", archived: "Archived" }[s]}
                  </button>
                ))}
              </div>
            </section>
          )}

          {isEditing ? (
            /* ── Edit: one existing unit, flat form ── */
            <>
              <section>
                <SectionLabel>What needs done? — {editUnitLabel || "Whole job"}</SectionLabel>
                <div className="mt-3">
                  <WorkNeeded
                    presets={presets}
                    items={editWork}
                    onAdd={addWorkItem}
                    onRemove={removeWorkItem}
                    onNotes={setWorkItemNotes}
                    allowComplete
                    onToggleComplete={toggleWorkItemComplete}
                  />
                </div>
              </section>
              <UnitSpecSection
                unit={editUnit}
                specEntries={editSpecs}
                onChange={setEditSpecs}
                colorOptions={trimOptions ? [...trimOptions.colors, ...trimOptions.stains] : []}
                finishOptions={options?.intFinishes || []}
                speciesOptions={trimOptions?.species || []}
                stainOptions={trimOptions?.stains || []}
              />
              <MaterialSection
                materials={editMaterials}
                onChange={setEditMaterials}
                catalog={catalog}
                colorOptions={trimOptions ? [...trimOptions.colors, ...trimOptions.stains] : []}
                speciesOptions={trimOptions?.species || []}
              />
              <PhotoSection
                photos={editPhotos}
                onOpenCamera={() => openCamera({ kind: "edit" })}
                onUpload={(files) => addPhotosTo({ kind: "edit" }, files)}
                onRemove={removeEditPhoto}
              />
              <section>
                <span className="text-xs font-bold flex items-center gap-1.5 text-muted uppercase tracking-wide">
                  <StickyNote className="w-3.5 h-3.5" /> Note
                </span>
                <textarea
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  rows={2}
                  placeholder="Anything else the office should know…"
                  className="w-full mt-2 rounded-lg border border-border bg-background px-3 py-3 text-base resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                />
              </section>
            </>
          ) : (
            /* ── Create: flat top-level flow ── */
            <>
              {/* 1. What's wrong + notes */}
              <section className="space-y-3">
                <div>
                  <SectionLabel step={1}>What&apos;s wrong?</SectionLabel>
                  <textarea
                    value={background}
                    onChange={(e) => setBackground(e.target.value)}
                    rows={3}
                    placeholder="Overall situation — e.g. the original windows were stained the wrong color…"
                    className="w-full mt-2 rounded-lg border border-border bg-background px-3 py-3 text-base resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Financing notes</label>
                  <textarea
                    value={financingNotes}
                    onChange={(e) => setFinancingNotes(e.target.value)}
                    rows={2}
                    placeholder="Optional…"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Paint &amp; stain notes</label>
                  <textarea
                    value={paintStainNotes}
                    onChange={(e) => setPaintStainNotes(e.target.value)}
                    rows={2}
                    placeholder="Optional…"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                  />
                </div>
              </section>

              {/* 2. Units affected — pick units, opt into spec changes per unit */}
              <section>
                <SectionLabel step={2}>Units affected</SectionLabel>
                <p className="text-[11px] text-muted mt-0.5">Tap the units on this job, or add one that isn&apos;t loaded.</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {unitOptions.map((o) => (
                    <UnitChip
                      key={o.label}
                      active={wuUnits.some((u) => !u.isNewProduct && u.unitLabel === o.label)}
                      label={o.label}
                      onClick={() => toggleUnit(o.label)}
                    />
                  ))}
                  <button
                    onClick={addManualUnit}
                    className="px-3 py-2.5 rounded-lg text-sm font-medium border border-dashed border-amber-500/50 text-amber-600 flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" /> Add unit manually
                  </button>
                </div>
                {wuUnits.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {wuUnits.map((u) => (
                      <div
                        key={u.key}
                        className={`rounded-xl border p-3 space-y-2 ${
                          u.isNewProduct ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-surface/40"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold">{unitTitle(u)}</span>
                          {u.isNewProduct && (
                            <button onClick={() => removeUnit(u.key)} className="p-1 rounded text-muted hover:text-danger">
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                        {u.isNewProduct && (
                          <>
                            <StackedInput label="Unit #" value={u.unitLabel} onChange={(v) => updateUnit(u.key, { unitLabel: v })} placeholder="101" />
                            <ComboInput
                              label="Product type"
                              value={u.unitType}
                              onChange={(v) => updateUnit(u.key, { unitType: v })}
                              options={options?.productTypes || []}
                              placeholder="Double Hung…"
                            />
                          </>
                        )}
                        <label className="flex items-center gap-2 text-sm font-medium cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={u.hasSpecChange}
                            onChange={(e) => updateUnit(u.key, { hasSpecChange: e.target.checked })}
                            className="w-4 h-4 accent-amber-500"
                          />
                          Spec change needed on this unit
                        </label>
                        {u.hasSpecChange && (
                          <div className="pt-1">
                            <UnitSpecSection
                              unit={unitObjFor(u)}
                              specEntries={u.specEntries}
                              onChange={(entries) => updateUnit(u.key, { specEntries: entries })}
                              colorOptions={trimOptions ? [...trimOptions.colors, ...trimOptions.stains] : []}
                              finishOptions={options?.intFinishes || []}
                              speciesOptions={trimOptions?.species || []}
                              stainOptions={trimOptions?.stains || []}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* 3. Work to complete (issues) */}
              <section>
                <SectionLabel step={3}>Work to complete</SectionLabel>
                <div className="mt-2 space-y-3">
                  {issues.map((it, idx) => (
                    <IssueCard
                      key={it.id}
                      issue={it}
                      index={idx}
                      presets={presets}
                      affectedUnits={wuUnits}
                      unitTitle={unitTitle}
                      canRemove={issues.length > 1}
                      catalog={catalog}
                      partsCatalog={partsCatalog}
                      colorOptions={trimOptions ? [...trimOptions.colors, ...trimOptions.stains] : []}
                      speciesOptions={trimOptions?.species || []}
                      onUpdate={(patch) => updateIssue(it.id, patch)}
                      onRemove={() => removeIssue(it.id)}
                      onToggleUnit={(unitKey) => toggleIssueUnit(it.id, unitKey)}
                      onOpenCamera={() => openCamera({ kind: "issue", issueId: it.id })}
                      onUpload={(files) => addPhotosTo({ kind: "issue", issueId: it.id }, files)}
                      onRemovePhoto={(pid) => removeIssuePhoto(it.id, pid)}
                    />
                  ))}
                </div>
                <button
                  onClick={addIssue}
                  className="w-full mt-3 py-3 rounded-xl border-2 border-dashed border-amber-500/50 text-amber-600 text-sm font-semibold flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Add another work item
                </button>
              </section>

              {unsavedCameraPhotos.length > 0 && (
                <button
                  onClick={() => setShowSavePrompt(true)}
                  className="w-full py-3 rounded-xl border border-amber-500/50 text-amber-600 text-sm font-semibold flex items-center justify-center gap-2 active:bg-amber-500/10"
                >
                  <ImagePlus className="w-4 h-4" />
                  Save {unsavedCameraPhotos.length} photo{unsavedCameraPhotos.length !== 1 ? "s" : ""} to camera roll
                </button>
              )}

              {buildInputs().length > 0 && (
                <UnitSummary open={showSummary} onToggle={() => setShowSummary((v) => !v)} inputs={buildInputs()} />
              )}
            </>
          )}


          {/* Danger zone — delete the whole write-up (edit mode) */}
          {(isEditing || isBatchEdit) && (
            <div className="pt-3 border-t border-border">
              {confirmDelete ? (
                <div className="rounded-xl border border-danger/40 bg-danger/5 p-3">
                  <p className="text-sm font-medium text-danger flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4" />
                    Delete this entire write-up? This can&apos;t be undone.
                  </p>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => setConfirmDelete(false)}
                      disabled={deletingWriteUp}
                      className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDeleteWriteUp}
                      disabled={deletingWriteUp}
                      className="flex-1 py-2.5 rounded-lg bg-danger text-white text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      {deletingWriteUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      {deletingWriteUp ? "Deleting…" : "Delete write-up"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1.5 text-sm font-medium text-danger"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete write-up
                </button>
              )}
            </div>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border shrink-0">
          {isBatchEdit ? (
            <button
              onClick={saveGuidedEdit}
              disabled={saving}
              className="w-full py-4 rounded-xl bg-amber-500 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.99] transition-transform"
            >
              {saving ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {progress ? `Saving ${progress.done}/${progress.total}…` : "Saving…"}
                </>
              ) : (
                <>
                  <Check className="w-5 h-5" />
                  Save changes
                </>
              )}
            </button>
          ) : isEditing ? (
            <button
              onClick={saveChanges}
              disabled={saving || !editorHasContent}
              className="w-full py-4 rounded-xl bg-amber-500 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.99] transition-transform"
            >
              {saving ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Check className="w-5 h-5" />
                  Save changes
                </>
              )}
            </button>
          ) : (
            <>
              <div className="flex gap-2">
                <button
                  onClick={() => submitWriteUp(false, "draft")}
                  disabled={submitting || !editorHasContent}
                  className="shrink-0 px-4 py-4 rounded-xl border-2 border-amber-500 text-amber-600 font-semibold flex items-center justify-center gap-2 disabled:opacity-40 active:scale-[0.99] transition-transform"
                  title="Save as a draft — not yet submitted for review"
                >
                  <Check className="w-5 h-5" />
                  Save draft
                </button>
                <button
                  onClick={() => submitWriteUp(true, "in_review")}
                  disabled={submitting || totalUnits === 0}
                  className="flex-1 py-4 rounded-xl bg-amber-500 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.99] transition-transform"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {progress ? `Uploading ${progress.done}/${progress.total}…` : "Submitting…"}
                    </>
                  ) : (
                    <>
                      <Send className="w-5 h-5" />
                      Submit &amp; Email ({totalUnits})
                    </>
                  )}
                </button>
              </div>
              <p className="text-[11px] text-muted text-center mt-1.5">
                <strong>Save draft</strong> keeps it as a draft · <strong>Submit</strong> sends it for review.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Work-needed: type-to-search + item rows with optional notes ── */
function WorkNeeded({
  presets,
  items,
  onAdd,
  onRemove,
  onNotes,
  allowComplete = false,
  onToggleComplete,
}: {
  presets: string[];
  items: WriteUpLineItem[];
  onAdd: (label: string, kind: "preset" | "custom") => void;
  onRemove: (i: number) => void;
  onNotes: (i: number, notes: string | undefined) => void;
  /** Edit mode: show a done checkbox on each item. */
  allowComplete?: boolean;
  onToggleComplete?: (i: number) => void;
}) {
  const [draft, setDraft] = useState("");

  const q = draft.trim().toLowerCase();
  const matches = presets.filter(
    (p) => p.toLowerCase().includes(q) && !items.some((w) => w.label.toLowerCase() === p.toLowerCase())
  );
  const exact = presets.some((p) => p.toLowerCase() === q);

  function addCustom() {
    if (!q) return;
    onAdd(draft.trim(), exact ? "preset" : "custom");
    setDraft("");
  }

  return (
    <div>
      {/* Added items */}
      {items.length > 0 && (
        <div className="space-y-2 mb-2">
          {items.map((w, i) => (
            <div key={i} className="rounded-xl border border-border bg-surface px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {allowComplete && (
                    <button
                      onClick={() => onToggleComplete?.(i)}
                      className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                        w.completed ? "bg-green-600 border-green-600 text-white" : "border-border text-transparent"
                      }`}
                      title={w.completed ? "Mark not done" : "Mark done"}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <span className={`text-sm font-medium truncate ${w.completed ? "line-through text-muted" : ""}`}>
                    {w.label}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => onNotes(i, w.notes === undefined ? "" : undefined)}
                    className={`p-1.5 rounded-lg ${w.notes !== undefined ? "text-amber-600" : "text-muted hover:text-foreground"}`}
                    title="Add a note"
                  >
                    <MessageSquare className="w-4 h-4" />
                  </button>
                  <button onClick={() => onRemove(i)} className="p-1.5 rounded-lg text-muted hover:text-danger">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {w.notes !== undefined && (
                <textarea
                  value={w.notes}
                  onChange={(e) => onNotes(i, e.target.value)}
                  rows={2}
                  autoFocus
                  placeholder="Add detail for this item (optional)…"
                  className="w-full mt-2 rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Search / add */}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addCustom();
          }
        }}
        placeholder="Type a task (e.g. Redo caulking)…"
        className="w-full rounded-lg border border-border bg-background px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-400/50"
      />

      {q && (
        <div className="mt-2 rounded-xl border border-border overflow-hidden">
          {matches.map((p) => (
            <button
              key={p}
              onClick={() => {
                onAdd(p, "preset");
                setDraft("");
              }}
              className="w-full text-left px-3 py-3 text-sm border-b border-border last:border-b-0 hover:bg-surface flex items-center gap-2"
            >
              <Plus className="w-4 h-4 text-muted" />
              {p}
            </button>
          ))}
          {!exact && (
            <button
              onClick={addCustom}
              className="w-full text-left px-3 py-3 text-sm bg-amber-500/10 text-amber-700 font-medium flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add “{draft.trim()}”
            </button>
          )}
        </div>
      )}

      {/* A couple of quick suggestions when the box is empty */}
      {!q && items.length === 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {presets.slice(0, 6).map((p) => (
            <button
              key={p}
              onClick={() => onAdd(p, "preset")}
              className="px-3 py-2 rounded-full text-sm font-medium border border-border bg-surface text-foreground hover:border-amber-400"
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


/* ── Reusable: photos grid + take/upload ── */
function PhotoSection({
  photos,
  onOpenCamera,
  onUpload,
  onRemove,
}: {
  photos: LocalPhoto[];
  onOpenCamera: () => void;
  onUpload: (files: File[]) => void;
  onRemove: (id: string) => void;
}) {
  const [dragActive, setDragActive] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith("image/"));
    if (files.length) onUpload(files);
  }

  return (
    <div>
      <span className="text-xs font-bold flex items-center gap-1.5 text-muted uppercase tracking-wide">
        <Camera className="w-3.5 h-3.5" /> Photos
      </span>
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mt-2">
          {photos.map((p) => (
            <PhotoThumb key={p.id} blob={p.blob} onRemove={() => onRemove(p.id)} />
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 mt-2">
        <button
          type="button"
          onClick={onOpenCamera}
          className="flex items-center justify-center gap-2 py-4 rounded-xl border border-dashed border-border text-sm font-medium text-muted active:bg-surface"
        >
          <Camera className="w-4 h-4" /> Take photos
        </button>
        {/* Upload — also a drop target on desktop (drag photos straight in). */}
        <label
          onDragOver={(e) => {
            e.preventDefault();
            if (!dragActive) setDragActive(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragActive(false);
          }}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center gap-0.5 py-4 rounded-xl border border-dashed text-sm font-medium cursor-pointer transition-colors ${
            dragActive ? "border-amber-500 bg-amber-500/10 text-amber-600" : "border-border text-muted active:bg-surface"
          }`}
        >
          <span className="flex items-center gap-2">
            <ImagePlus className="w-4 h-4" /> {dragActive ? "Drop to upload" : "Upload"}
          </span>
          <span className="hidden sm:block text-[10px] font-normal text-muted">or drag &amp; drop</span>
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length) onUpload(files);
              e.target.value = "";
            }}
          />
        </label>
      </div>
    </div>
  );
}

/* ── Reusable: a unit's spec corrections ── */
function UnitSpecSection({
  unit,
  specEntries,
  onChange,
  colorOptions,
  finishOptions,
  speciesOptions,
  stainOptions,
}: {
  unit: MaterialUnit | null;
  specEntries: SpecEntry[];
  onChange: (entries: SpecEntry[]) => void;
  colorOptions: string[];
  finishOptions: string[];
  speciesOptions: string[];
  stainOptions: string[];
}) {
  function addSpec(label: string) {
    const clean = label.trim();
    if (!clean || specEntries.some((e) => e.label.toLowerCase() === clean.toLowerCase())) return;
    const kind = specKindOf(clean);
    const oldValue = unit ? readCurrentSpec(unit, clean) : "";
    const seed = kind === "measure" ? parseMeasure(oldValue) : { whole: "", frac: "0" };
    onChange([
      ...specEntries,
      { id: crypto.randomUUID(), label: clean, kind, oldValue, newValue: "", whole: seed.whole, frac: seed.frac },
    ]);
  }
  return (
    <div>
      <span className="text-xs font-bold flex items-center gap-1.5 text-muted uppercase tracking-wide">
        <Pencil className="w-3.5 h-3.5" /> Spec changes
      </span>
      <div className="mt-2 space-y-2">
        {specEntries.map((entry) => (
          <SpecEntryRow
            key={entry.id}
            entry={entry}
            colorOptions={colorOptions}
            finishOptions={finishOptions}
            speciesOptions={speciesOptions}
            stainOptions={stainOptions}
            onChange={(patch) => onChange(specEntries.map((e) => (e.id === entry.id ? { ...e, ...patch } : e)))}
            onRemove={() => onChange(specEntries.filter((e) => e.id !== entry.id))}
          />
        ))}
      </div>
      <SpecAdder onAdd={addSpec} unitLabels={unitSpecLabels(unit)} existing={specEntries.map((e) => e.label)} />
    </div>
  );
}

/* ── Reusable: trim / material list ── */
function MaterialSection({
  materials,
  onChange,
  catalog,
  colorOptions,
  speciesOptions,
}: {
  materials: WriteUpMaterialItem[];
  onChange: (m: WriteUpMaterialItem[]) => void;
  catalog: CatalogPickItem[];
  colorOptions: string[];
  speciesOptions: string[];
}) {
  return (
    <div>
      <span className="text-xs font-bold flex items-center gap-1.5 text-muted uppercase tracking-wide">
        <Package className="w-3.5 h-3.5" /> Trim / material
      </span>
      {materials.length > 0 && (
        <div className="mt-2 space-y-2">
          {materials.map((m, i) => (
            <div key={i} className="flex items-center justify-between gap-2 px-3 py-3 rounded-xl bg-surface border border-border">
              <div className="min-w-0 text-sm">
                <span className="font-semibold">
                  {m.qty} {m.unit} · {m.item}
                </span>
                <span className="text-muted">
                  {[m.color, m.species, m.lengths, m.vendor].filter(Boolean).map((s) => ` · ${s}`).join("")}
                </span>
              </div>
              <button onClick={() => onChange(materials.filter((_, j) => j !== i))} className="p-2 rounded-lg text-muted hover:text-danger shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      <MaterialAdder catalog={catalog} colorOptions={colorOptions} speciesOptions={speciesOptions} onAdd={(m) => onChange([...materials, m])} />
    </div>
  );
}

/* ── One work-to-complete item: description + which affected units it hits ── */
function IssueCard({
  issue,
  index,
  presets,
  affectedUnits,
  unitTitle,
  canRemove,
  catalog,
  partsCatalog,
  colorOptions,
  speciesOptions,
  onUpdate,
  onRemove,
  onToggleUnit,
  onOpenCamera,
  onUpload,
  onRemovePhoto,
}: {
  issue: WuIssue;
  index: number;
  presets: string[];
  affectedUnits: WuUnit[];
  unitTitle: (u: WuUnit) => string;
  canRemove: boolean;
  catalog: CatalogPickItem[];
  partsCatalog: PartsCatalogItem[];
  colorOptions: string[];
  speciesOptions: string[];
  onUpdate: (patch: Partial<WuIssue>) => void;
  onRemove: () => void;
  onToggleUnit: (unitKey: string) => void;
  onOpenCamera: () => void;
  onUpload: (files: File[]) => void;
  onRemovePhoto: (id: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface/40 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold flex items-center gap-1.5">
          <Wrench className="w-4 h-4 text-amber-600" /> Item {index + 1}
        </span>
        {canRemove && (
          <button onClick={onRemove} className="p-1.5 rounded-lg text-muted hover:text-danger">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      <div>
        <input
          value={issue.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="What needs done? e.g. Redo caulking, Reinstall unit…"
          className="w-full rounded-lg border border-border bg-background px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-400/50"
        />
        {!issue.label.trim() && (
          <div className="flex flex-wrap gap-2 mt-2">
            {presets.slice(0, 6).map((p) => (
              <button
                key={p}
                onClick={() => onUpdate({ label: p })}
                className="px-3 py-1.5 rounded-full text-sm font-medium border border-border bg-surface text-foreground hover:border-amber-400"
              >
                {p}
              </button>
            ))}
          </div>
        )}
        <input
          value={issue.note}
          onChange={(e) => onUpdate({ note: e.target.value })}
          placeholder="Optional detail…"
          className="w-full mt-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
        />
      </div>

      {/* Affects which units — right under what needs done */}
      <div>
        <span className="text-xs font-bold text-muted uppercase tracking-wide">Affects</span>
        {affectedUnits.length === 0 ? (
          <p className="text-xs text-muted mt-1">
            No units added yet — this counts as a whole-job item. Add units up top to attach them.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2 mt-2">
            <UnitChip active={issue.unitKeys.length === 0} label="Whole job" onClick={() => onUpdate({ unitKeys: [] })} />
            {affectedUnits.map((u) => (
              <UnitChip key={u.key} active={issue.unitKeys.includes(u.key)} label={unitTitle(u)} onClick={() => onToggleUnit(u.key)} />
            ))}
          </div>
        )}
      </div>

      {/* Materials for this item */}
      <MaterialSection
        materials={issue.materials}
        onChange={(m) => onUpdate({ materials: m })}
        catalog={catalog}
        colorOptions={colorOptions}
        speciesOptions={speciesOptions}
      />

      {/* Ordering — flag anything that needs ordered (lives with materials) */}
      <div>
        <button
          onClick={() => onUpdate({ needsOrdering: !issue.needsOrdering })}
          className="flex items-center gap-2 text-sm"
        >
          <span
            className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
              issue.needsOrdering ? "bg-amber-500 border-amber-500 text-white" : "border-border text-transparent"
            }`}
          >
            <Check className="w-3.5 h-3.5" />
          </span>
          Something needs ordered
        </button>
        {issue.needsOrdering && (
          <div className="mt-2 space-y-3">
            <PartsPicker
              parts={issue.parts}
              catalog={partsCatalog}
              affectedUnits={affectedUnits.filter((u) => issue.unitKeys.length === 0 || issue.unitKeys.includes(u.key))}
              unitTitle={unitTitle}
              onChange={(parts) => onUpdate({ parts })}
            />
            <div>
              <span className="text-xs font-bold text-muted uppercase tracking-wide">Ordering notes</span>
              <textarea
                value={issue.orderingNotes}
                onChange={(e) => onUpdate({ orderingNotes: e.target.value })}
                rows={2}
                placeholder="Anything else about what needs ordered…"
                className="w-full mt-1 rounded-lg border border-border bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/50"
              />
            </div>
          </div>
        )}
      </div>

      {/* Photos for this item */}
      <PhotoSection photos={issue.photos} onOpenCamera={onOpenCamera} onUpload={onUpload} onRemove={onRemovePhoto} />
    </section>
  );
}

/* ── Parts needed picker — type-ahead over the parts catalog, grouped by
 *    product type, with custom entries and per-part quantity. ── */
function PartsPicker({
  parts,
  catalog,
  affectedUnits,
  unitTitle,
  onChange,
}: {
  parts: PartItem[];
  catalog: PartsCatalogItem[];
  affectedUnits: WuUnit[];
  unitTitle: (u: WuUnit) => string;
  onChange: (parts: PartItem[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const q = query.trim().toLowerCase();

  // Product types on the affected units — used to surface the most likely
  // parts first (a double-hung write-up leads with double-hung parts).
  const relevantTypes = useMemo(
    () => new Set(affectedUnits.map((u) => u.unitType.trim().toLowerCase()).filter(Boolean)),
    [affectedUnits]
  );

  const label = (c: PartsCatalogItem) =>
    c.position ? `${c.category} — ${c.partName} · ${c.position}` : `${c.category} — ${c.partName}`;

  const groups = useMemo(() => {
    const filtered = catalog.filter((c) => {
      if (!q) return true;
      return (
        c.productType.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.partName.toLowerCase().includes(q) ||
        (c.position || "").toLowerCase().includes(q)
      );
    });
    const byType = new Map<string, PartsCatalogItem[]>();
    for (const c of filtered) {
      const arr = byType.get(c.productType) || [];
      arr.push(c);
      byType.set(c.productType, arr);
    }
    return [...byType.entries()].sort((a, b) => {
      const ar = relevantTypes.has(a[0].toLowerCase()) ? 0 : 1;
      const br = relevantTypes.has(b[0].toLowerCase()) ? 0 : 1;
      return ar - br || a[0].localeCompare(b[0]);
    });
  }, [catalog, q, relevantTypes]);

  function addPart(name: string, productType?: string, custom?: boolean) {
    onChange([...parts, { key: crypto.randomUUID(), name, productType, qty: 1, custom, unitKeys: [] }]);
    setQuery("");
    setOpen(false);
  }
  function setQty(key: string, qty: number) {
    onChange(parts.map((p) => (p.key === key ? { ...p, qty: Math.max(1, qty) } : p)));
  }
  function setUnits(key: string, unitKeys: string[]) {
    onChange(parts.map((p) => (p.key === key ? { ...p, unitKeys } : p)));
  }
  function toggleUnit(key: string, unitKey: string) {
    onChange(
      parts.map((p) =>
        p.key === key
          ? { ...p, unitKeys: p.unitKeys.includes(unitKey) ? p.unitKeys.filter((k) => k !== unitKey) : [...p.unitKeys, unitKey] }
          : p
      )
    );
  }
  function removePart(key: string) {
    onChange(parts.filter((p) => p.key !== key));
  }

  return (
    <div>
      <span className="text-xs font-bold text-muted uppercase tracking-wide">Parts needed</span>

      {parts.length > 0 && (
        <div className="mt-2 space-y-2">
          {parts.map((p) => (
            <div key={p.key} className="rounded-lg border border-border bg-background px-2.5 py-2 space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{p.name}</div>
                  {p.productType && <div className="text-[11px] text-muted truncate">{p.productType}</div>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setQty(p.key, p.qty - 1)}
                    className="w-7 h-7 rounded-md border border-border text-muted flex items-center justify-center"
                  >
                    −
                  </button>
                  <input
                    inputMode="numeric"
                    value={p.qty}
                    onChange={(e) => setQty(p.key, parseInt(e.target.value, 10) || 1)}
                    className="w-10 text-center rounded-md border border-border bg-background py-1 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setQty(p.key, p.qty + 1)}
                    className="w-7 h-7 rounded-md border border-border text-muted flex items-center justify-center"
                  >
                    +
                  </button>
                </div>
                <button type="button" onClick={() => removePart(p.key)} className="p-1 rounded text-muted hover:text-danger shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {affectedUnits.length > 0 && (
                <div>
                  <span className="text-[11px] text-muted">For</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    <UnitChip
                      active={p.unitKeys.length === 0}
                      label="All units"
                      onClick={() => setUnits(p.key, [])}
                    />
                    {affectedUnits.map((u) => (
                      <UnitChip
                        key={u.key}
                        active={p.unitKeys.includes(u.key)}
                        label={unitTitle(u)}
                        onClick={() => toggleUnit(p.key, u.key)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="relative mt-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={catalog.length ? "Search parts, or type a custom part…" : "Type a part…"}
          className="w-full rounded-lg border border-border bg-background px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-400/50"
        />
        {open && (
          <div className="absolute z-20 left-0 right-0 mt-1 rounded-xl border border-border bg-background shadow-lg max-h-72 overflow-y-auto">
            {q && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addPart(query.trim(), undefined, true);
                }}
                className="w-full text-left px-3 py-2.5 text-sm font-medium text-amber-600 border-b border-border flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Add custom: &ldquo;{query.trim()}&rdquo;
              </button>
            )}
            {groups.map(([type, items]) => (
              <div key={type}>
                <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted bg-surface sticky top-0">
                  {type}
                </div>
                {items.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addPart(label(c), c.productType);
                    }}
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-surface border-b border-border last:border-b-0"
                  >
                    {label(c)}
                  </button>
                ))}
              </div>
            ))}
            {groups.length === 0 && !q && (
              <div className="px-3 py-3 text-sm text-muted">No parts catalog loaded — type a custom part above.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Review-by-unit summary (from the fanned-out inputs) ── */
function UnitSummary({
  open,
  onToggle,
  inputs,
}: {
  open: boolean;
  onToggle: () => void;
  inputs: WriteUpEntryInput[];
}) {
  return (
    <div className="rounded-xl border border-border">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold">
        <span>Review by unit ({inputs.length})</span>
        <span className="text-xs text-muted">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {inputs.map((inp, i) => (
            <div key={i} className="rounded-lg bg-surface border border-border p-2.5">
              <div className="text-sm font-semibold">
                {inp.unitLabel || "Whole job"}
                {inp.newProduct?.type ? ` · ${inp.newProduct.type}` : ""}
              </div>
              {inp.lineItems.length > 0 && (
                <ul className="mt-1 text-xs space-y-0.5">
                  {inp.lineItems.map((li, j) => (
                    <li key={j}>
                      • {li.label}
                      {li.notes ? ` — ${li.notes}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {inp.specChanges.length > 0 && (
                <div className="mt-1 text-xs text-muted">
                  {inp.specChanges.map((c, j) => (
                    <div key={j}>
                      {c.field}: {c.oldValue || "—"} → {c.newValue}
                    </div>
                  ))}
                </div>
              )}
              {inp.materialItems.length > 0 && <div className="mt-1 text-xs text-muted">{inp.materialItems.length} material line(s)</div>}
              {inp.photos.length > 0 && <div className="mt-1 text-xs text-muted">{inp.photos.length} photo(s)</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children, step }: { children: React.ReactNode; step?: number }) {
  return (
    <div className="flex items-center gap-2">
      {step !== undefined && (
        <span className="w-5 h-5 rounded-full bg-amber-500 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
          {step}
        </span>
      )}
      <span className="text-sm font-bold">{children}</span>
    </div>
  );
}

function PhotoThumb({ blob, onRemove }: { blob: Blob; onRemove: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return (
    <div className="relative aspect-square rounded-xl overflow-hidden border border-border bg-surface">
      {url && <img src={url} alt="" className="w-full h-full object-cover" />}
      <button onClick={onRemove} className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

/* ── Spec adder — search the spec catalog (or the unit's own fields) + custom ── */
function SpecAdder({
  onAdd,
  unitLabels,
  existing,
}: {
  onAdd: (label: string) => void;
  unitLabels: string[];
  existing: string[];
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const taken = new Set(existing.map((s) => s.toLowerCase()));
  // The unit's own spec fields first, then the master catalog.
  const pool = [...new Set([...unitLabels, ...SPEC_CATALOG.map((s) => s.label)])];
  const matches = pool
    .filter((l) => !taken.has(l.toLowerCase()) && (!query || l.toLowerCase().includes(query)))
    .slice(0, 8);
  const exact = pool.some((l) => l.toLowerCase() === query);

  function add(label: string) {
    onAdd(label);
    setQ("");
  }

  return (
    <div className="mt-2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (query) add(q.trim());
          }
        }}
        placeholder="Add a spec change — search or type your own…"
        className="w-full rounded-lg border border-dashed border-amber-500/50 bg-background px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-400/50"
      />
      {query && (
        <div className="mt-1 rounded-xl border border-border overflow-hidden">
          {matches.map((l) => (
            <button
              key={l}
              onClick={() => add(l)}
              className="w-full text-left px-3 py-2.5 text-sm border-b border-border last:border-b-0 hover:bg-surface flex items-center gap-2"
            >
              <Plus className="w-4 h-4 text-muted" />
              {l}
            </button>
          ))}
          {!exact && (
            <button
              onClick={() => add(q.trim())}
              className="w-full text-left px-3 py-2.5 text-sm bg-amber-500/10 text-amber-700 font-medium flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add “{q.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── One spec-change row — value input adapts to the spec kind ── */
function SpecEntryRow({
  entry,
  colorOptions,
  finishOptions,
  speciesOptions,
  stainOptions,
  onChange,
  onRemove,
}: {
  entry: SpecEntry;
  colorOptions: string[];
  finishOptions: string[];
  speciesOptions: string[];
  stainOptions: string[];
  onChange: (patch: Partial<SpecEntry>) => void;
  onRemove: () => void;
}) {
  const suggest =
    entry.kind === "color"
      ? colorOptions
      : entry.kind === "finish"
      ? finishOptions
      : entry.kind === "species"
      ? speciesOptions
      : entry.kind === "stain"
      ? stainOptions
      : [];

  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="min-w-0">
          <span className="text-sm font-semibold">{entry.label}</span>
          {entry.oldValue ? (
            <span className="text-[11px] text-muted"> · now: {entry.oldValue}</span>
          ) : null}
        </div>
        <button onClick={onRemove} className="p-1.5 rounded-lg text-muted hover:text-danger shrink-0">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {entry.kind === "measure" ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] text-muted block mb-1">Inches</label>
            <input
              inputMode="numeric"
              value={entry.whole}
              onChange={(e) => onChange({ whole: e.target.value.replace(/[^0-9]/g, "") })}
              placeholder="24"
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-amber-400/50"
            />
          </div>
          <div>
            <label className="text-[11px] text-muted block mb-1">Fraction</label>
            <select
              value={entry.frac}
              onChange={(e) => onChange({ frac: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base"
            >
              {FRACTIONS_16.map((fr) => (
                <option key={fr} value={fr}>
                  {fr === "0" ? "—" : fr}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : suggest.length > 0 ? (
        <ComboInput label="New value" value={entry.newValue} onChange={(v) => onChange({ newValue: v })} options={suggest} placeholder="New value…" />
      ) : (
        <input
          value={entry.newValue}
          onChange={(e) => onChange({ newValue: e.target.value })}
          placeholder="New value…"
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-amber-400/50"
        />
      )}
    </div>
  );
}

/* ── Material adder — single-column, big touch targets ── */
function MaterialAdder({
  catalog,
  colorOptions,
  speciesOptions,
  onAdd,
}: {
  catalog: CatalogPickItem[];
  colorOptions: string[];
  speciesOptions: string[];
  onAdd: (m: WriteUpMaterialItem) => void;
}) {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<CatalogPickItem | null>(null);
  const [custom, setCustom] = useState(false);
  const [unit, setUnit] = useState("PCS");
  const [color, setColor] = useState("");
  const [species, setSpecies] = useState("");
  const [lengths, setLengths] = useState("");
  const [vendor, setVendor] = useState("");

  // Quantity is derived from the lengths field so it's never double-entered.
  const computedQty = lengthsToQty(lengths);

  // When a profile is picked, surface its own species first, then the rest of
  // the catalog's species. Custom typing is always allowed.
  const speciesList = useMemo(() => {
    const head = picked?.species || [];
    return [...new Set([...head, ...speciesOptions])];
  }, [picked, speciesOptions]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || picked) return [];
    return catalog
      .filter((c) => c.profile.toLowerCase().includes(q) || c.nicknames.some((n) => n.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [search, catalog, picked]);

  function choose(c: CatalogPickItem) {
    setPicked(c);
    setCustom(false);
    setSearch(c.profile);
    setUnit(c.unit || "PCS");
    if (c.vendors.length === 1) setVendor(c.vendors[0]);
    if (c.species.length === 1) setSpecies(c.species[0]);
  }
  function chooseCustom() {
    setCustom(true);
    setPicked(null);
  }
  function reset() {
    setSearch("");
    setPicked(null);
    setCustom(false);
    setUnit("PCS");
    setColor("");
    setSpecies("");
    setLengths("");
    setVendor("");
  }
  function add() {
    const itemName = picked ? picked.profile : search.trim();
    if (!itemName) return;
    onAdd({
      profileId: picked?.id,
      item: itemName,
      color: color.trim(),
      species: species.trim(),
      qty: Math.max(1, computedQty),
      unit: unit.trim() || "PCS",
      lengths: lengths.trim(),
      vendor: vendor.trim(),
      custom: custom || !picked,
    });
    reset();
  }

  const showEntry = picked || custom;

  return (
    <div className="mt-2 rounded-xl border border-dashed border-border p-3">
      <div className="relative">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPicked(null);
            setCustom(false);
          }}
          placeholder="Search catalog (1x6 EJ, lattice, casing)…"
          className="w-full rounded-lg border border-border bg-background px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-400/50"
        />
        {matches.length > 0 && (
          <div className="absolute z-10 left-0 right-0 mt-1 rounded-xl border border-border bg-background shadow-lg max-h-60 overflow-y-auto">
            {matches.map((c) => (
              <button
                key={c.id}
                onClick={() => choose(c)}
                className="w-full text-left px-3 py-3 text-sm hover:bg-surface flex items-center justify-between gap-2 border-b border-border last:border-b-0"
              >
                <span className="font-medium truncate">{c.profile}</span>
                <span className="text-[10px] text-muted shrink-0">{c.category}</span>
              </button>
            ))}
            {search.trim() && (
              <button onClick={chooseCustom} className="w-full text-left px-3 py-3 text-sm text-amber-600 font-medium">
                + Use “{search.trim()}” as custom item
              </button>
            )}
          </div>
        )}
        {search.trim() && !picked && !custom && matches.length === 0 && (
          <button onClick={chooseCustom} className="mt-2 text-sm text-amber-600 font-medium">
            + Use “{search.trim()}” as custom item
          </button>
        )}
      </div>

      {showEntry && (
        <div className="mt-3 space-y-3">
          {/* Lengths drives the count — no separate qty field. */}
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="text-xs text-muted block mb-1">Lengths / count</label>
              <input
                value={lengths}
                onChange={(e) => setLengths(e.target.value)}
                placeholder="5@8' 10@10'  ·  or just  5"
                className="w-full rounded-lg border border-border bg-background px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-400/50"
              />
            </div>
            <StackedInput label="Unit" value={unit} onChange={setUnit} />
          </div>
          <p className="text-[11px] text-muted -mt-1">
            {computedQty > 0 ? (
              <>
                Counts to <strong className="text-foreground">{computedQty} {unit.trim() || "PCS"}</strong>
              </>
            ) : (
              <>Type a count like <strong>5</strong>, or lengths like <strong>5@8&apos; 10@10&apos;</strong></>
            )}
          </p>
          <ComboInput label="Color" value={color} onChange={setColor} options={colorOptions} placeholder="Start typing a color or stain…" />
          <ComboInput label="Species" value={species} onChange={setSpecies} options={speciesList} placeholder="Start typing a species…" />
          {picked && picked.vendors.length > 1 ? (
            <div>
              <label className="text-xs text-muted block mb-1">Vendor</label>
              <select value={vendor} onChange={(e) => setVendor(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-3 text-base">
                <option value="">—</option>
                {picked.vendors.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <StackedInput label="Vendor" value={vendor} onChange={setVendor} />
          )}
          <button
            onClick={add}
            disabled={computedQty < 1}
            className="w-full py-3 rounded-xl bg-amber-500 text-white text-sm font-semibold flex items-center justify-center gap-1 disabled:opacity-40"
          >
            <Plus className="w-4 h-4" />
            Add material
          </button>
        </div>
      )}
    </div>
  );
}

/* Text input with a catalog type-ahead — narrows as you type, custom text ok. */
function ComboInput({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const q = value.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return options.slice(0, 8);
    return options.filter((o) => o.toLowerCase().includes(q) && o.toLowerCase() !== q).slice(0, 8);
  }, [q, options]);

  return (
    <div className="relative">
      <label className="text-xs text-muted block mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-background px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-400/50"
      />
      {open && matches.length > 0 && (
        <div className="absolute z-20 left-0 right-0 mt-1 rounded-xl border border-border bg-background shadow-lg max-h-56 overflow-y-auto">
          {matches.map((o) => (
            <button
              key={o}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(o);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2.5 text-sm hover:bg-surface border-b border-border last:border-b-0"
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StackedInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  list,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  list?: string;
}) {
  return (
    <div>
      <label className="text-xs text-muted block mb-1">{label}</label>
      <input
        type={type}
        value={value}
        list={list}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-400/50"
      />
    </div>
  );
}

function UnitChip({
  active,
  onClick,
  label,
  added,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  added?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors flex items-center gap-1 ${
        active
          ? "bg-primary border-primary text-white"
          : added
          ? "bg-amber-500/10 border-amber-500/40 text-amber-700"
          : "bg-surface border-border text-foreground hover:border-primary/40"
      }`}
    >
      {added && <Check className="w-3.5 h-3.5" />}
      {label}
    </button>
  );
}
