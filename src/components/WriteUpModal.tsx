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
  lengthsToQty,
  SPEC_FIELDS,
  unitLabelOf,
  submitWriteUpBatch,
  buildWriteUpMailto,
  updateWriteUp,
  deleteWriteUp,
  getSignedPhotoUrl,
  WriteUpEntryInput,
} from "@/lib/work-order-store";
import {
  WriteUpDraft,
  DraftBlock,
  saveDraft,
  loadDraft,
  clearDraft,
  putDraftPhoto,
  getDraftPhoto,
  deleteDraftPhoto,
} from "@/lib/writeup-draft";
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
}

interface LocalPhoto {
  id: string;
  name: string;
  blob: Blob;
  /** Set for photos already uploaded (editing an existing write-up). */
  path?: string;
}

/** One unit in the write-up. Work-to-complete is shared across all blocks;
 *  everything else (specs, trim, photos, notes) is per-unit. */
type ProgrammedUnit = { label: string; unit: MaterialUnit };
interface UnitBlock {
  id: string;
  /** true = manually-added product (not on the job). */
  isNewProduct: boolean;
  /** Programmed unit label, or the typed unit # for a new product; "" = whole job. */
  unitLabel: string;
  /** Product type (new product only). */
  unitType: string;
  specEntries: SpecEntry[];
  materialItems: WriteUpMaterialItem[];
  notes: string;
  photos: LocalPhoto[];
}

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

export default function WriteUpModal({ order, units, initialUnit, onClose, onSaved, editWriteUp }: Props) {
  const { user, autoCc } = useAuth();
  const isEditing = !!editWriteUp;
  const [presets, setPresets] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<CatalogPickItem[]>([]);
  const [options, setOptions] = useState<UnitOptions | null>(null);
  const [trimOptions, setTrimOptions] = useState<TrimOptions | null>(null);

  // Shared work-to-complete (applies to every unit block below).
  const [sharedWork, setSharedWork] = useState<WriteUpLineItem[]>([]);
  // Per-unit blocks — each its own specs / trim / photos / notes.
  const [blocks, setBlocks] = useState<UnitBlock[]>([]);
  // Which block the camera / upload is currently adding photos to.
  const [photoTarget, setPhotoTarget] = useState<string | null>(null);

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
  }, []);

  useEffect(() => {
    if (isEditing) return; // edit mode doesn't use the local draft system
    let cancelled = false;
    loadDraft(order.orderNumber).then((d) => {
      if (cancelled) return;
      if (d && Array.isArray(d.blocks) && d.blocks.length > 0) {
        setPendingDraft(d);
      } else {
        seedFirstBlock();
        setDraftReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.orderNumber, isEditing]);

  // Edit mode: load the existing write-up into one block (incl. its photos).
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
      const u = unitOptions.find((o) => o.label === editWriteUp.unitLabel)?.unit || null;
      setSharedWork(editWriteUp.lineItems);
      setBlocks([
        {
          id: crypto.randomUUID(),
          isNewProduct: !!editWriteUp.newProduct,
          unitLabel: editWriteUp.unitLabel || "",
          unitType:
            editWriteUp.newProduct?.type ||
            (u ? String(u.unitType || u.type || u.summarySubType || "") : ""),
          specEntries: specEntriesFromChanges(editWriteUp.specChanges),
          materialItems: editWriteUp.materialItems,
          notes: editWriteUp.notes,
          photos: loaded,
        },
      ]);
      setStatus(editWriteUp.status);
      setDraftReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editWriteUp]);

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

  // ── Shared work-to-complete ──
  function addWorkItem(label: string, kind: "preset" | "custom") {
    const v = label.trim();
    if (!v) return;
    if (sharedWork.some((w) => w.label.toLowerCase() === v.toLowerCase())) return;
    setSharedWork((prev) => [...prev, { kind, label: v }]);
  }
  function removeWorkItem(i: number) {
    setSharedWork((prev) => prev.filter((_, j) => j !== i));
  }
  function setWorkItemNotes(i: number, notes: string | undefined) {
    setSharedWork((prev) => prev.map((w, j) => (j === i ? { ...w, notes } : w)));
  }
  function toggleWorkItemComplete(i: number) {
    setSharedWork((prev) => prev.map((w, j) => (j === i ? { ...w, completed: !w.completed } : w)));
  }

  // Setting status controls bulk completion: closing marks all work done.
  function changeStatus(s: WriteUpStatus) {
    setStatus(s);
    if (s === "closed") {
      setSharedWork((prev) => prev.map((w) => ({ ...w, completed: true })));
    }
  }

  // ── Unit blocks ──
  function makeBlock(opts: { isNewProduct: boolean; unitLabel: string }): UnitBlock {
    const u = opts.isNewProduct
      ? null
      : unitOptions.find((o) => o.label === opts.unitLabel)?.unit || null;
    return {
      id: crypto.randomUUID(),
      isNewProduct: opts.isNewProduct,
      unitLabel: opts.unitLabel,
      unitType: u ? String(u.unitType || u.type || u.summarySubType || "") : "",
      specEntries: [],
      materialItems: [],
      notes: "",
      photos: [],
    };
  }
  function seedFirstBlock() {
    const label = initialUnit && unitOptions.some((o) => o.label === initialUnit) ? initialUnit : "";
    setBlocks([makeBlock({ isNewProduct: false, unitLabel: label })]);
  }
  function addUnitBlock(opts: { isNewProduct: boolean; unitLabel: string }) {
    setBlocks((prev) => [...prev, makeBlock(opts)]);
  }
  function updateBlock(id: string, patch: Partial<UnitBlock>) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }
  function removeBlock(id: string) {
    setBlocks((prev) => {
      const b = prev.find((x) => x.id === id);
      if (b) for (const p of b.photos) deleteDraftPhoto(p.id);
      return prev.filter((x) => x.id !== id);
    });
  }
  function unitForBlock(b: UnitBlock): MaterialUnit | null {
    if (b.isNewProduct || !b.unitLabel) return null;
    return unitOptions.find((o) => o.label === b.unitLabel)?.unit || null;
  }

  // ── Photos (targeting a specific block) ──
  async function addPhotosToBlock(blockId: string | null, files: File[], fromCamera = false) {
    if (!blockId) return;
    const added: LocalPhoto[] = files.map((f) => ({
      id: crypto.randomUUID(),
      name: f.name || "photo",
      blob: f,
    }));
    for (const a of added) putDraftPhoto(a.id, a.blob);
    setBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, photos: [...b.photos, ...added] } : b))
    );
    if (fromCamera) {
      setCameraPhotoIds((prev) => {
        const next = new Set(prev);
        for (const a of added) next.add(a.id);
        return next;
      });
    }
  }
  function removePhotoFromBlock(blockId: string, photoId: string) {
    setBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, photos: b.photos.filter((p) => p.id !== photoId) } : b))
    );
    setCameraPhotoIds((prev) => {
      if (!prev.has(photoId)) return prev;
      const next = new Set(prev);
      next.delete(photoId);
      return next;
    });
    deleteDraftPhoto(photoId);
  }
  function openCameraForBlock(blockId: string) {
    setPhotoTarget(blockId);
    setShowCamera(true);
  }

  const allPhotos = blocks.flatMap((b) => b.photos);
  /** Camera photos taken this session that the user hasn't saved to the roll. */
  const unsavedCameraPhotos = allPhotos.filter((p) => cameraPhotoIds.has(p.id));

  function photoToFile(p: LocalPhoto): File {
    return p.blob instanceof File
      ? p.blob
      : new File([p.blob], p.name || "photo.jpg", { type: p.blob.type || "image/jpeg" });
  }

  /** Save every camera photo to the device in one action — the iOS/Android share
   *  sheet accepts multiple files and offers "Save N Images" to the camera roll.
   *  Falls back to individual downloads on browsers without file sharing. */
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
      /* user cancelled the share sheet — keep them unsaved so they can retry */
    }
    setShowSavePrompt(false);
  }

  // ── Derived: per-block spec changes + submit inputs ──
  function blockSpecChanges(b: UnitBlock): SpecChange[] {
    const label = b.isNewProduct ? b.unitLabel.trim() : b.unitLabel;
    const out: SpecChange[] = [];
    for (const e of b.specEntries) {
      const newValue = specEntryValue(e);
      if (newValue && newValue !== e.oldValue.trim()) {
        out.push({ unitLabel: label, field: e.label, oldValue: e.oldValue, newValue });
      }
    }
    return out;
  }
  function blockHasContent(b: UnitBlock): boolean {
    return (
      (b.isNewProduct && b.unitType.trim().length > 0) ||
      b.specEntries.some((e) => specEntryValue(e).length > 0) ||
      b.materialItems.length > 0 ||
      b.photos.length > 0 ||
      b.notes.trim().length > 0
    );
  }
  /** Blocks complete enough to save (a new product needs a # and a type). */
  const validBlocks = blocks.filter((b) =>
    b.isNewProduct ? b.unitLabel.trim().length > 0 && b.unitType.trim().length > 0 : true
  );
  function blockToInput(b: UnitBlock): WriteUpEntryInput {
    return {
      unitLabel: b.isNewProduct ? b.unitLabel.trim() || null : b.unitLabel || null,
      lineItems: sharedWork,
      specChanges: blockSpecChanges(b),
      materialItems: b.materialItems,
      newProduct: b.isNewProduct ? { ...emptyProduct, type: b.unitType.trim() } : null,
      notes: b.notes.trim(),
      photoFiles: b.photos.map((p) => p.blob),
    };
  }

  const editorHasContent =
    validBlocks.length > 0 && (sharedWork.length > 0 || validBlocks.some(blockHasContent));

  // ── Draft (de)serialization ──
  function blockToDraft(b: UnitBlock): DraftBlock {
    return {
      id: b.id,
      isNewProduct: b.isNewProduct,
      unitLabel: b.unitLabel,
      unitType: b.unitType,
      specChanges: b.specEntries.map((e) => ({
        unitLabel: b.unitLabel,
        field: e.label,
        oldValue: e.oldValue,
        newValue: specEntryValue(e),
      })),
      materialItems: b.materialItems,
      notes: b.notes,
      photos: b.photos.map((p) => ({ id: p.id, name: p.name })),
    };
  }
  async function blockFromDraft(d: DraftBlock): Promise<UnitBlock> {
    const ph: LocalPhoto[] = [];
    for (const p of d.photos) {
      const blob = await getDraftPhoto(p.id);
      if (blob) ph.push({ id: p.id, name: p.name, blob });
    }
    return {
      id: d.id,
      isNewProduct: d.isNewProduct,
      unitLabel: d.unitLabel,
      unitType: d.unitType,
      specEntries: specEntriesFromChanges(d.specChanges),
      materialItems: d.materialItems,
      notes: d.notes,
      photos: ph,
    };
  }
  async function resumeDraft() {
    if (!pendingDraft) return;
    setSharedWork(pendingDraft.sharedWork || []);
    const restored = await Promise.all((pendingDraft.blocks || []).map(blockFromDraft));
    setBlocks(restored.length > 0 ? restored : [makeBlock({ isNewProduct: false, unitLabel: "" })]);
    setPendingDraft(null);
    setDraftReady(true);
  }
  async function discardDraft() {
    await clearDraft(order.orderNumber);
    setPendingDraft(null);
    setSharedWork([]);
    seedFirstBlock();
    setDraftReady(true);
  }

  /** Snapshot the current write-up as a draft (or null if truly empty). */
  function buildDraftNow(): WriteUpDraft | null {
    if (sharedWork.length === 0 && !blocks.some(blockHasContent)) return null;
    return {
      orderNumber: order.orderNumber,
      updatedAt: new Date().toISOString(),
      sharedWork,
      blocks: blocks.map(blockToDraft),
    };
  }

  // Keep a live pointer to the current flush so background/crash handlers save
  // the latest state without re-binding listeners on every keystroke.
  const flushRef = useRef<() => void>(() => {});
  flushRef.current = () => {
    if (isEditing || !draftReady || submitting) return;
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
    if (isEditing || !draftReady || submitting) return;
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
  }, [draftReady, sharedWork, blocks]);

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
    const block = blocks[0];
    if (!block) return;
    setSaving(true);
    setError("");
    const input = blockToInput(block);
    const keepPhotos: WriteUpPhoto[] = block.photos
      .filter((p) => p.path)
      .map((p) => ({ path: p.path!, name: p.name }));
    const newPhotoFiles = block.photos.filter((p) => !p.path).map((p) => p.blob);
    const res = await updateWriteUp(editWriteUp.id, {
      orderNumber: order.orderNumber || editWriteUp.orderNumber,
      unitLabel: input.unitLabel,
      lineItems: sharedWork,
      specChanges: input.specChanges,
      materialItems: block.materialItems,
      newProduct: input.newProduct,
      notes: block.notes.trim(),
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
    if (!editWriteUp || deletingWriteUp) return;
    setDeletingWriteUp(true);
    setError("");
    const res = await deleteWriteUp(
      editWriteUp.id,
      editWriteUp.photos.map((p) => p.path)
    );
    setDeletingWriteUp(false);
    if (!res.ok) {
      setError(res.error ? `Couldn't delete: ${res.error}` : "Couldn't delete the write-up — try again.");
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

  async function submitWriteUp(sendEmail: boolean) {
    if (validBlocks.length === 0) {
      setError("Add at least one unit before submitting.");
      return;
    }
    if (sharedWork.length === 0 && !validBlocks.some(blockHasContent)) {
      setError("Add some work, a spec, a photo, or a note first.");
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
    };
    const inputs: WriteUpEntryInput[] = validBlocks.map(blockToInput);

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
      const mailto = buildWriteUpMailto(ctx, inputs, docLink, autoCc);
      if (typeof window !== "undefined") window.location.href = mailto;
    }

    onSaved?.();
    onClose();
  }

  const totalUnits = validBlocks.length;

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
            if (files.length) addPhotosToBlock(photoTarget, files, true);
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
                {isEditing ? "Edit Write-Up" : "Field Write-Up"}
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
              {(pendingDraft.blocks?.length ?? 0)} unit(s)
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
          {isEditing && (
            <section>
              <SectionLabel>Status</SectionLabel>
              <div className="flex gap-2 mt-2">
                {(["open", "in_review", "closed"] as WriteUpStatus[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => changeStatus(s)}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                      status === s ? "bg-amber-500 border-amber-500 text-white" : "border-border text-muted"
                    }`}
                  >
                    {s === "in_review" ? "In review" : s === "closed" ? "Closed" : "Open"}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Work to complete — shared across every unit below */}
          <section>
            <SectionLabel step={isEditing ? undefined : 1}>What needs done?</SectionLabel>
            {!isEditing && (
              <p className="text-[11px] text-muted mt-0.5">
                Applies to every unit below. Add the units it covers underneath.
              </p>
            )}
            <div className="mt-3">
              <WorkNeeded
                presets={presets}
                items={sharedWork}
                onAdd={addWorkItem}
                onRemove={removeWorkItem}
                onNotes={setWorkItemNotes}
                allowComplete={isEditing}
                onToggleComplete={toggleWorkItemComplete}
              />
            </div>
          </section>

          {/* Units — each with its own specs / trim / photos / notes */}
          {blocks.map((block) => (
            <UnitBlockEditor
              key={block.id}
              block={block}
              unit={unitForBlock(block)}
              productTypes={options?.productTypes || []}
              catalog={catalog}
              colorOptions={trimOptions ? [...trimOptions.colors, ...trimOptions.stains] : []}
              finishOptions={options?.intFinishes || []}
              speciesOptions={trimOptions?.species || []}
              stainOptions={trimOptions?.stains || []}
              canRemove={!isEditing && blocks.length > 1}
              onChange={(patch) => updateBlock(block.id, patch)}
              onRemove={() => removeBlock(block.id)}
              onOpenCamera={() => openCameraForBlock(block.id)}
              onUpload={(files) => addPhotosToBlock(block.id, files)}
              onRemovePhoto={(pid) => removePhotoFromBlock(block.id, pid)}
            />
          ))}

          {/* Global batch-save of camera photos across all units */}
          {unsavedCameraPhotos.length > 0 && (
            <button
              onClick={() => setShowSavePrompt(true)}
              className="w-full py-3 rounded-xl border border-amber-500/50 text-amber-600 text-sm font-semibold flex items-center justify-center gap-2 active:bg-amber-500/10"
            >
              <ImagePlus className="w-4 h-4" />
              Save {unsavedCameraPhotos.length} photo{unsavedCameraPhotos.length !== 1 ? "s" : ""} to camera roll
            </button>
          )}

          {/* Add another unit (creation only) */}
          {!isEditing && (
            <AddUnitPicker
              programmedUnits={unitOptions}
              usedLabels={blocks.map((b) => b.unitLabel)}
              onAddUnit={(label) => addUnitBlock({ isNewProduct: false, unitLabel: label })}
              onAddProduct={() => addUnitBlock({ isNewProduct: true, unitLabel: "" })}
            />
          )}


          {/* Danger zone — delete the whole write-up (edit mode) */}
          {isEditing && (
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
          {isEditing ? (
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
                  onClick={() => submitWriteUp(false)}
                  disabled={submitting || totalUnits === 0}
                  className="shrink-0 px-4 py-4 rounded-xl border-2 border-amber-500 text-amber-600 font-semibold flex items-center justify-center gap-2 disabled:opacity-40 active:scale-[0.99] transition-transform"
                  title="Save the write-up without opening email"
                >
                  <Check className="w-5 h-5" />
                  Save
                </button>
                <button
                  onClick={() => submitWriteUp(true)}
                  disabled={submitting || totalUnits === 0}
                  className="flex-1 py-4 rounded-xl bg-amber-500 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.99] transition-transform"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {progress ? `Uploading ${progress.done}/${progress.total}…` : "Saving…"}
                    </>
                  ) : (
                    <>
                      <Send className="w-5 h-5" />
                      Save &amp; Email ({totalUnits})
                    </>
                  )}
                </button>
              </div>
              <p className="text-[11px] text-muted text-center mt-1.5">
                Auto-saves a draft as you go · <strong>Save</strong> posts it to Write-Ups.
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

/* ── One unit block: its own specs / trim / photos / notes ── */
function UnitBlockEditor({
  block,
  unit,
  productTypes,
  catalog,
  colorOptions,
  finishOptions,
  speciesOptions,
  stainOptions,
  canRemove,
  onChange,
  onRemove,
  onOpenCamera,
  onUpload,
  onRemovePhoto,
}: {
  block: UnitBlock;
  unit: MaterialUnit | null;
  productTypes: string[];
  catalog: CatalogPickItem[];
  colorOptions: string[];
  finishOptions: string[];
  speciesOptions: string[];
  stainOptions: string[];
  canRemove: boolean;
  onChange: (patch: Partial<UnitBlock>) => void;
  onRemove: () => void;
  onOpenCamera: () => void;
  onUpload: (files: File[]) => void;
  onRemovePhoto: (photoId: string) => void;
}) {
  const specEntries = block.specEntries;
  function addSpec(label: string) {
    const clean = label.trim();
    if (!clean || specEntries.some((e) => e.label.toLowerCase() === clean.toLowerCase())) return;
    const kind = specKindOf(clean);
    const oldValue = unit ? readCurrentSpec(unit, clean) : "";
    const seed = kind === "measure" ? parseMeasure(oldValue) : { whole: "", frac: "0" };
    onChange({
      specEntries: [
        ...specEntries,
        { id: crypto.randomUUID(), label: clean, kind, oldValue, newValue: "", whole: seed.whole, frac: seed.frac },
      ],
    });
  }
  const updateSpec = (id: string, patch: Partial<SpecEntry>) =>
    onChange({ specEntries: specEntries.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  const removeSpec = (id: string) => onChange({ specEntries: specEntries.filter((e) => e.id !== id) });

  const title = block.isNewProduct
    ? block.unitLabel.trim()
      ? `Unit ${block.unitLabel.trim()}`
      : "New product"
    : block.unitLabel || "Whole job";

  return (
    <section className="rounded-2xl border border-border bg-surface/40 p-3 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold flex items-center gap-1.5">
          <Package className="w-4 h-4 text-amber-600" /> {title}
        </span>
        {canRemove && (
          <button onClick={onRemove} className="p-1.5 rounded-lg text-muted hover:text-danger">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {block.isNewProduct && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 space-y-3">
          <StackedInput label="Unit #" value={block.unitLabel} onChange={(v) => onChange({ unitLabel: v })} placeholder="101" />
          <ComboInput
            label="Product type"
            value={block.unitType}
            onChange={(v) => onChange({ unitType: v })}
            options={productTypes}
            placeholder="Start typing… Double Hung, Storm Door…"
          />
        </div>
      )}

      {/* Spec changes */}
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
              onChange={(patch) => updateSpec(entry.id, patch)}
              onRemove={() => removeSpec(entry.id)}
            />
          ))}
        </div>
        <SpecAdder onAdd={addSpec} unitLabels={unitSpecLabels(unit)} existing={specEntries.map((e) => e.label)} />
      </div>

      {/* Trim / material */}
      <div>
        <span className="text-xs font-bold flex items-center gap-1.5 text-muted uppercase tracking-wide">
          <Package className="w-3.5 h-3.5" /> Trim / material
        </span>
        {block.materialItems.length > 0 && (
          <div className="mt-2 space-y-2">
            {block.materialItems.map((m, i) => (
              <div key={i} className="flex items-center justify-between gap-2 px-3 py-3 rounded-xl bg-surface border border-border">
                <div className="min-w-0 text-sm">
                  <span className="font-semibold">
                    {m.qty} {m.unit} · {m.item}
                  </span>
                  <span className="text-muted">
                    {[m.color, m.species, m.lengths, m.vendor].filter(Boolean).map((s) => ` · ${s}`).join("")}
                  </span>
                </div>
                <button
                  onClick={() => onChange({ materialItems: block.materialItems.filter((_, j) => j !== i) })}
                  className="p-2 rounded-lg text-muted hover:text-danger shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        <MaterialAdder
          catalog={catalog}
          colorOptions={colorOptions}
          speciesOptions={speciesOptions}
          onAdd={(m) => onChange({ materialItems: [...block.materialItems, m] })}
        />
      </div>

      {/* Photos */}
      <div>
        <span className="text-xs font-bold flex items-center gap-1.5 text-muted uppercase tracking-wide">
          <Camera className="w-3.5 h-3.5" /> Photos
        </span>
        {block.photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mt-2">
            {block.photos.map((p) => (
              <PhotoThumb key={p.id} blob={p.blob} onRemove={() => onRemovePhoto(p.id)} />
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 mt-2">
          <button
            type="button"
            onClick={onOpenCamera}
            className="flex items-center justify-center gap-2 py-4 rounded-xl border border-dashed border-border text-sm font-medium text-muted cursor-pointer active:bg-surface"
          >
            <Camera className="w-4 h-4" /> Take photos
          </button>
          <label className="flex items-center justify-center gap-2 py-4 rounded-xl border border-dashed border-border text-sm font-medium text-muted cursor-pointer active:bg-surface">
            <ImagePlus className="w-4 h-4" /> Upload
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

      {/* Notes */}
      <div>
        <span className="text-xs font-bold flex items-center gap-1.5 text-muted uppercase tracking-wide">
          <StickyNote className="w-3.5 h-3.5" /> Note
        </span>
        <textarea
          value={block.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          rows={2}
          placeholder="Anything specific to this unit…"
          className="w-full mt-2 rounded-lg border border-border bg-background px-3 py-3 text-base resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/50"
        />
      </div>
    </section>
  );
}

/* ── Add-unit picker: pick a programmed unit, whole job, or a new product ── */
function AddUnitPicker({
  programmedUnits,
  usedLabels,
  onAddUnit,
  onAddProduct,
}: {
  programmedUnits: ProgrammedUnit[];
  usedLabels: string[];
  onAddUnit: (label: string) => void;
  onAddProduct: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full py-3 rounded-xl border-2 border-dashed border-amber-500/50 text-amber-600 text-sm font-semibold flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4" />
        Add a unit
      </button>
    );
  }
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-xs text-muted mb-2">Add a unit this work applies to:</p>
      <div className="flex flex-wrap gap-2">
        <UnitChip active={false} label="Whole job" onClick={() => { onAddUnit(""); setOpen(false); }} />
        {programmedUnits.map((o) => (
          <UnitChip
            key={o.label}
            active={false}
            added={usedLabels.includes(o.label)}
            label={o.label}
            onClick={() => { onAddUnit(o.label); setOpen(false); }}
          />
        ))}
        <button
          onClick={() => { onAddProduct(); setOpen(false); }}
          className="px-3 py-2.5 rounded-lg text-sm font-medium border border-dashed border-amber-500/50 text-amber-600 flex items-center gap-1"
        >
          <Plus className="w-4 h-4" />
          Add product
        </button>
      </div>
      <button onClick={() => setOpen(false)} className="mt-2 text-xs text-muted">
        Cancel
      </button>
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
