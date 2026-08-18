"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  WorkOrder,
  MaterialUnit,
  WriteUpLineItem,
  SpecChange,
  WriteUpMaterialItem,
  WriteUpNewProduct,
} from "@/lib/types";
import { useAuth } from "@/hooks/useAuth";
import {
  getWriteUpPresets,
  fetchCatalogPickItems,
  CatalogPickItem,
  fetchUnitOptions,
  UnitOptions,
  SPEC_FIELDS,
  unitLabelOf,
  submitWriteUpBatch,
  buildWriteUpMailto,
  WriteUpEntryInput,
} from "@/lib/work-order-store";
import {
  WriteUpDraft,
  DraftEntry,
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
  ChevronLeft,
  RotateCcw,
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
}

const WHOLE_JOB = "__whole_job__";

/** A photo held locally (camera/upload/restored draft), persisted in IndexedDB. */
interface LocalPhoto {
  id: string;
  name: string;
  blob: Blob;
}

/** A unit committed to the current write-up session. */
interface BuiltEntry {
  key: string;
  unitLabel: string | null;
  lineItems: WriteUpLineItem[];
  specChanges: SpecChange[];
  materialItems: WriteUpMaterialItem[];
  newProduct: WriteUpNewProduct | null;
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

export default function WriteUpModal({ order, units, initialUnit, onClose, onSaved }: Props) {
  const { user, autoCc } = useAuth();
  const [presets, setPresets] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<CatalogPickItem[]>([]);
  const [options, setOptions] = useState<UnitOptions | null>(null);
  const [entries, setEntries] = useState<BuiltEntry[]>([]);

  // Editor (one unit at a time)
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<string>(initialUnit || WHOLE_JOB);
  const [chosenPresets, setChosenPresets] = useState<Set<string>>(new Set());
  const [customItems, setCustomItems] = useState<string[]>([]);
  const [customDraft, setCustomDraft] = useState("");
  const [specDrafts, setSpecDrafts] = useState<Record<string, string>>({});
  const [materialItems, setMaterialItems] = useState<WriteUpMaterialItem[]>([]);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [notes, setNotes] = useState("");
  const [addProductMode, setAddProductMode] = useState(false);
  const [newUnitNumber, setNewUnitNumber] = useState("");
  const [newProduct, setNewProduct] = useState<WriteUpNewProduct>(emptyProduct);

  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");

  // Draft recovery
  const [pendingDraft, setPendingDraft] = useState<WriteUpDraft | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [savedTick, setSavedTick] = useState(false);

  // "Save this photo to your device?" prompt after a camera capture
  const [savePrompt, setSavePrompt] = useState<File | null>(null);

  useEffect(() => {
    getWriteUpPresets().then(setPresets);
    fetchCatalogPickItems().then(setCatalog).catch(() => setCatalog([]));
    fetchUnitOptions().then(setOptions).catch(() => setOptions(null));
  }, []);

  // On open: look for a saved draft for this job.
  useEffect(() => {
    let cancelled = false;
    loadDraft(order.orderNumber).then((d) => {
      if (cancelled) return;
      const hasContent = d && (d.entries.length > 0 || d.editor);
      if (hasContent) setPendingDraft(d);
      else setDraftReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [order.orderNumber]);

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

  const activeUnit =
    selectedUnit === WHOLE_JOB
      ? null
      : unitOptions.find((o) => o.label === selectedUnit)?.unit || null;

  useEffect(() => {
    if (addProductMode || !activeUnit) {
      if (!addProductMode) setSpecDrafts({});
      return;
    }
    const next: Record<string, string> = {};
    for (const f of SPEC_FIELDS) next[f.label] = f.read(activeUnit);
    setSpecDrafts(next);
  }, [selectedUnit]); // eslint-disable-line react-hooks/exhaustive-deps

  function togglePreset(p: string) {
    setChosenPresets((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  function addCustom() {
    const v = customDraft.trim();
    if (!v) return;
    setCustomItems((prev) => [...prev, v]);
    setCustomDraft("");
  }

  async function addPhotos(files: File[]) {
    const added: LocalPhoto[] = [];
    for (const f of files) {
      const id = crypto.randomUUID();
      added.push({ id, name: f.name || "photo", blob: f });
      putDraftPhoto(id, f); // persist immediately so an error can't lose it
    }
    setPhotos((prev) => [...prev, ...added]);
  }

  function removePhoto(id: string) {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
    deleteDraftPhoto(id);
  }

  /** Offer to save a just-taken photo to the device (camera roll via share sheet). */
  async function saveToDevice(file: File) {
    const nav = navigator as Navigator & {
      canShare?: (data?: unknown) => boolean;
      share?: (data?: unknown) => Promise<void>;
    };
    try {
      if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file] });
      } else {
        // Desktop / unsupported: download instead (goes to Downloads, not the roll)
        const url = URL.createObjectURL(file);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name || "photo.jpg";
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      // User cancelled the share sheet — nothing to do
    }
    setSavePrompt(null);
  }

  const editorSpecChanges: SpecChange[] = useMemo(() => {
    if (addProductMode || !activeUnit) return [];
    const out: SpecChange[] = [];
    for (const f of SPEC_FIELDS) {
      const oldValue = f.read(activeUnit);
      const newValue = (specDrafts[f.label] ?? "").trim();
      if (newValue && newValue !== oldValue) {
        out.push({ unitLabel: selectedUnit, field: f.label, oldValue, newValue });
      }
    }
    return out;
  }, [addProductMode, activeUnit, specDrafts, selectedUnit]);

  const editorLineItems: WriteUpLineItem[] = useMemo(() => {
    const presetItems: WriteUpLineItem[] = [...chosenPresets].map((label) => ({
      kind: "preset",
      label,
    }));
    const custom: WriteUpLineItem[] = customItems.map((label) => ({ kind: "custom", label }));
    return [...presetItems, ...custom];
  }, [chosenPresets, customItems]);

  const validNewProduct =
    addProductMode && newUnitNumber.trim().length > 0 && newProduct.type.trim().length > 0;

  const editorHasContent =
    validNewProduct ||
    editorLineItems.length > 0 ||
    editorSpecChanges.length > 0 ||
    materialItems.length > 0 ||
    photos.length > 0 ||
    notes.trim().length > 0;

  function resetEditor() {
    setEditingKey(null);
    setSelectedUnit(WHOLE_JOB);
    setChosenPresets(new Set());
    setCustomItems([]);
    setCustomDraft("");
    setSpecDrafts({});
    setMaterialItems([]);
    setPhotos([]);
    setNotes("");
    setAddProductMode(false);
    setNewUnitNumber("");
    setNewProduct(emptyProduct);
    setError("");
  }

  function editorToEntry(key: string): BuiltEntry {
    const isNew = addProductMode && validNewProduct;
    return {
      key,
      unitLabel: isNew ? newUnitNumber.trim() : selectedUnit === WHOLE_JOB ? null : selectedUnit,
      lineItems: editorLineItems,
      specChanges: isNew ? [] : editorSpecChanges,
      materialItems,
      newProduct: isNew ? { ...newProduct } : null,
      notes: notes.trim(),
      photos,
    };
  }

  function commitEntry() {
    if (!editorHasContent) {
      setError("Add work, a material, a photo, a spec fix, or a note first.");
      return;
    }
    const key = editingKey || crypto.randomUUID();
    const entry = editorToEntry(key);
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.key === key);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = entry;
        return copy;
      }
      return [...prev, entry];
    });
    resetEditor();
  }

  /** Populate the editor from an entry (edit an existing one, or restore a draft). */
  function hydrateEditor(e: BuiltEntry, key: string | null) {
    setEditingKey(key);
    setChosenPresets(new Set(e.lineItems.filter((l) => l.kind === "preset").map((l) => l.label)));
    setCustomItems(e.lineItems.filter((l) => l.kind === "custom").map((l) => l.label));
    setMaterialItems(e.materialItems);
    setPhotos(e.photos);
    setNotes(e.notes);
    if (e.newProduct) {
      setAddProductMode(true);
      setNewUnitNumber(e.unitLabel || "");
      setNewProduct(e.newProduct);
      setSelectedUnit(WHOLE_JOB);
      setSpecDrafts({});
    } else {
      setAddProductMode(false);
      setNewUnitNumber("");
      setNewProduct(emptyProduct);
      setSelectedUnit(e.unitLabel ?? WHOLE_JOB);
      const u = unitOptions.find((o) => o.label === e.unitLabel)?.unit || null;
      const drafts: Record<string, string> = {};
      if (u) for (const f of SPEC_FIELDS) drafts[f.label] = f.read(u);
      for (const c of e.specChanges) drafts[c.field] = c.newValue;
      setSpecDrafts(drafts);
    }
    setError("");
  }

  function editEntry(e: BuiltEntry) {
    hydrateEditor(e, e.key);
  }

  function removeEntry(key: string) {
    const e = entries.find((x) => x.key === key);
    if (e) for (const p of e.photos) deleteDraftPhoto(p.id);
    setEntries((prev) => prev.filter((x) => x.key !== key));
    if (editingKey === key) resetEditor();
  }

  function pickUnit(label: string) {
    setAddProductMode(false);
    const existing = entries.find((e) => (e.unitLabel ?? WHOLE_JOB) === label);
    if (existing && existing.key !== editingKey) editEntry(existing);
    else setSelectedUnit(label);
  }

  function startAddProduct() {
    setAddProductMode(true);
    setSelectedUnit(WHOLE_JOB);
    setSpecDrafts({});
  }

  // ── Draft (de)serialization ──
  function toDraftEntry(e: BuiltEntry): DraftEntry {
    return {
      key: e.key,
      unitLabel: e.unitLabel,
      lineItems: e.lineItems,
      specChanges: e.specChanges,
      materialItems: e.materialItems,
      newProduct: e.newProduct,
      notes: e.notes,
      photos: e.photos.map((p) => ({ id: p.id, name: p.name })),
    };
  }

  async function fromDraftEntry(d: DraftEntry): Promise<BuiltEntry> {
    const photos: LocalPhoto[] = [];
    for (const p of d.photos) {
      const blob = await getDraftPhoto(p.id);
      if (blob) photos.push({ id: p.id, name: p.name, blob });
    }
    return {
      key: d.key,
      unitLabel: d.unitLabel,
      lineItems: d.lineItems,
      specChanges: d.specChanges,
      materialItems: d.materialItems,
      newProduct: d.newProduct,
      notes: d.notes,
      photos,
    };
  }

  async function resumeDraft() {
    if (!pendingDraft) return;
    const restored = await Promise.all(pendingDraft.entries.map(fromDraftEntry));
    setEntries(restored);
    if (pendingDraft.editor) hydrateEditor(await fromDraftEntry(pendingDraft.editor), null);
    setPendingDraft(null);
    setDraftReady(true);
  }

  async function discardDraft() {
    await clearDraft(order.orderNumber);
    setPendingDraft(null);
    setEntries([]);
    resetEditor();
    setDraftReady(true);
  }

  // ── Auto-save (debounced) once the draft decision is made ──
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!draftReady || submitting) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const editorEntry = editorHasContent ? toDraftEntry(editorToEntry(editingKey || "editor")) : null;
      if (entries.length === 0 && !editorEntry) {
        clearDraft(order.orderNumber);
        return;
      }
      const draft: WriteUpDraft = {
        orderNumber: order.orderNumber,
        updatedAt: new Date().toISOString(),
        entries: entries.map(toDraftEntry),
        editor: editorEntry,
      };
      saveDraft(draft);
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1500);
    }, 700);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    draftReady,
    entries,
    selectedUnit,
    chosenPresets,
    customItems,
    specDrafts,
    materialItems,
    photos,
    notes,
    addProductMode,
    newUnitNumber,
    newProduct,
  ]);

  async function submitAndEmail() {
    let allEntries = entries;
    if (editorHasContent) {
      const key = editingKey || crypto.randomUUID();
      const entry = editorToEntry(key);
      const idx = entries.findIndex((e) => e.key === key);
      allEntries = idx >= 0 ? entries.map((e) => (e.key === key ? entry : e)) : [...entries, entry];
    }
    if (allEntries.length === 0) {
      setError("Add at least one unit before submitting.");
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

    const inputs: WriteUpEntryInput[] = allEntries.map((e) => ({
      unitLabel: e.unitLabel,
      lineItems: e.lineItems,
      specChanges: e.specChanges,
      materialItems: e.materialItems,
      newProduct: e.newProduct,
      notes: e.notes,
      photoFiles: e.photos.map((p) => p.blob),
    }));

    const created = await submitWriteUpBatch(ctx, inputs, (done, total) =>
      setProgress({ done, total })
    );
    setSubmitting(false);
    setProgress(null);

    if (created.length === 0) {
      setError("Could not save the write-up. It's still saved as a draft — try again.");
      return;
    }

    // Submitted — clear the local draft, then open the mail app.
    await clearDraft(order.orderNumber);

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const docLink = `${origin}/work-orders/${encodeURIComponent(order.orderNumber)}`;
    const mailto = buildWriteUpMailto(ctx, inputs, docLink, autoCc);
    if (typeof window !== "undefined") window.location.href = mailto;

    onSaved?.();
    onClose();
  }

  const totalUnits = entries.length + (editorHasContent ? 1 : 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
      {/* Save-to-device prompt (after a camera capture) */}
      {savePrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-6">
          <div className="bg-background rounded-2xl shadow-xl w-full max-w-xs p-5 text-center">
            <Camera className="w-8 h-8 text-amber-600 mx-auto mb-2" />
            <p className="font-semibold">Save photo to your device?</p>
            <p className="text-xs text-muted mt-1">
              It&apos;s already attached to the write-up. Saving also keeps a copy in your photos.
            </p>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setSavePrompt(null)}
                className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium"
              >
                Not now
              </button>
              <button
                onClick={() => saveToDevice(savePrompt)}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-background w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[94vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-amber-600" />
            <div>
              <h2 className="text-base font-semibold leading-tight">Field Write-Up</h2>
              <p className="text-xs text-muted leading-tight">
                {order.customerName} · #{order.orderNumber}
                {savedTick && <span className="text-green-600"> · draft saved</span>}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface text-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Resume-draft prompt */}
        {pendingDraft && (
          <div className="mx-4 mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 shrink-0">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <RotateCcw className="w-4 h-4 text-amber-600" />
              Unfinished write-up found
            </p>
            <p className="text-xs text-muted mt-0.5">
              Saved {new Date(pendingDraft.updatedAt).toLocaleString()} ·{" "}
              {pendingDraft.entries.length + (pendingDraft.editor ? 1 : 0)} unit(s)
            </p>
            <div className="flex gap-2 mt-2">
              <button
                onClick={resumeDraft}
                className="flex-1 py-2 rounded-lg bg-amber-500 text-white text-sm font-semibold"
              >
                Resume
              </button>
              <button
                onClick={discardDraft}
                className="flex-1 py-2 rounded-lg border border-border text-sm font-medium"
              >
                Start fresh
              </button>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {entries.length > 0 && (
            <section>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">
                Units in this write-up ({entries.length})
              </label>
              <div className="mt-2 space-y-1.5">
                {entries.map((e) => (
                  <div
                    key={e.key}
                    className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ${
                      editingKey === e.key ? "border-amber-500 bg-amber-500/5" : "border-border bg-surface"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{e.unitLabel || "Whole job"}</div>
                      <div className="text-xs text-muted truncate">{summarizeEntry(e)}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => editEntry(e)} className="p-1.5 rounded text-muted hover:text-primary">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => removeEntry(e.key)} className="p-1.5 rounded text-muted hover:text-danger">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="flex items-center gap-2 pt-1">
            {editingKey && (
              <button onClick={resetEditor} className="p-1 rounded text-muted hover:text-foreground">
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <h3 className="text-sm font-bold">
              {editingKey ? "Edit unit" : entries.length ? "Add another unit" : "Add a unit"}
            </h3>
          </div>

          {/* Unit picker */}
          <section>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">Which unit?</label>
            <div className="flex flex-wrap gap-2 mt-2">
              <UnitChip
                active={selectedUnit === WHOLE_JOB && !addProductMode}
                onClick={() => pickUnit(WHOLE_JOB)}
                label="Whole job"
              />
              {unitOptions.map((o) => {
                const added = entries.some((e) => e.unitLabel === o.label);
                return (
                  <UnitChip
                    key={o.label}
                    active={selectedUnit === o.label && !addProductMode}
                    added={added}
                    onClick={() => pickUnit(o.label)}
                    label={o.label}
                  />
                );
              })}
              <button
                onClick={startAddProduct}
                className={`px-3 py-2 rounded-lg text-sm font-medium border border-dashed transition-colors flex items-center gap-1 ${
                  addProductMode
                    ? "bg-amber-500 border-amber-500 text-white"
                    : "border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
                }`}
              >
                <Plus className="w-4 h-4" />
                Add product
              </button>
            </div>
            {unitOptions.length === 0 && !addProductMode && (
              <p className="text-[11px] text-muted mt-1.5">
                No products programmed for this job — use <strong>Add product</strong> to enter one.
              </p>
            )}
          </section>

          {/* Add-product form */}
          {addProductMode && (
            <section className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <label className="text-xs font-semibold uppercase tracking-wide text-amber-700 flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5" />
                New product
              </label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <LabeledInput label="Unit #" value={newUnitNumber} onChange={setNewUnitNumber} placeholder="101" />
                <LabeledInput
                  label="Product type"
                  value={newProduct.type}
                  onChange={(v) => setNewProduct((p) => ({ ...p, type: v }))}
                  list="wu-types"
                  placeholder="Double Hung"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <LabeledInput label="Size (W x H)" value={newProduct.size} onChange={(v) => setNewProduct((p) => ({ ...p, size: v }))} placeholder='24" x 36"' />
                <LabeledInput label="Frame" value={newProduct.frame} onChange={(v) => setNewProduct((p) => ({ ...p, frame: v }))} list="wu-frames" />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <LabeledInput label="Exterior color" value={newProduct.exteriorColor} onChange={(v) => setNewProduct((p) => ({ ...p, exteriorColor: v }))} list="wu-ext" />
                <LabeledInput label="Interior color" value={newProduct.interiorColor} onChange={(v) => setNewProduct((p) => ({ ...p, interiorColor: v }))} list="wu-int" />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <LabeledInput label="Int. finish" value={newProduct.intFinish} onChange={(v) => setNewProduct((p) => ({ ...p, intFinish: v }))} list="wu-fin" />
                <LabeledInput label="Details" value={newProduct.details} onChange={(v) => setNewProduct((p) => ({ ...p, details: v }))} list="wu-details" />
              </div>
              {options && (
                <>
                  <datalist id="wu-types">{options.productTypes.map((v) => <option key={v} value={v} />)}</datalist>
                  <datalist id="wu-ext">{options.extColors.map((v) => <option key={v} value={v} />)}</datalist>
                  <datalist id="wu-int">{options.intColors.map((v) => <option key={v} value={v} />)}</datalist>
                  <datalist id="wu-fin">{options.intFinishes.map((v) => <option key={v} value={v} />)}</datalist>
                  <datalist id="wu-details">{options.details.map((v) => <option key={v} value={v} />)}</datalist>
                  <datalist id="wu-frames">{options.frames.map((v) => <option key={v} value={v} />)}</datalist>
                </>
              )}
            </section>
          )}

          {/* Work needed */}
          <section>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">Work needed</label>
            <div className="flex flex-wrap gap-2 mt-2">
              {presets.map((p) => {
                const active = chosenPresets.has(p);
                return (
                  <button
                    key={p}
                    onClick={() => togglePreset(p)}
                    className={`px-3 py-2 rounded-full text-sm font-medium border transition-colors ${
                      active
                        ? "bg-amber-500 border-amber-500 text-white"
                        : "bg-surface border-border text-foreground hover:border-amber-400"
                    }`}
                  >
                    {active && <Check className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />}
                    {p}
                  </button>
                );
              })}
            </div>

            {customItems.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {customItems.map((c, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface border border-border text-sm">
                    <span>{c}</span>
                    <button onClick={() => setCustomItems((prev) => prev.filter((_, j) => j !== i))} className="p-1 rounded text-muted hover:text-danger">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 mt-2">
              <input
                value={customDraft}
                onChange={(e) => setCustomDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCustom()}
                placeholder="Add custom work item…"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
              />
              <button
                onClick={addCustom}
                disabled={!customDraft.trim()}
                className="px-3 py-2 rounded-lg bg-surface border border-border text-sm font-medium disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </section>

          {/* Spec corrections */}
          {activeUnit && !addProductMode && (
            <section>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted flex items-center gap-1.5">
                <Pencil className="w-3.5 h-3.5" />
                Fix a spec ({selectedUnit})
              </label>
              <p className="text-[11px] text-muted mt-0.5">
                Only edit what&apos;s wrong. Blank = leave as-is. Corrections show on the calendar.
              </p>
              <div className="mt-2 space-y-2">
                {SPEC_FIELDS.map((f) => {
                  const original = f.read(activeUnit);
                  const draft = specDrafts[f.label] ?? "";
                  const changed = draft.trim() && draft.trim() !== original;
                  return (
                    <div key={f.label} className="flex items-center gap-2">
                      <span className="w-28 shrink-0 text-xs text-muted">{f.label}</span>
                      <input
                        value={draft}
                        onChange={(e) => setSpecDrafts((prev) => ({ ...prev, [f.label]: e.target.value }))}
                        placeholder={original || "—"}
                        className={`flex-1 rounded-lg border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 ${
                          changed ? "border-amber-500" : "border-border"
                        }`}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Materials */}
          <section>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5" />
              Trim / material to order
            </label>
            <p className="text-[11px] text-muted mt-0.5">
              Pick from the catalog, then set color, qty and lengths — same as the material list.
            </p>

            {materialItems.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {materialItems.map((m, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-surface border border-border">
                    <div className="min-w-0 text-sm">
                      <span className="font-semibold">
                        {m.qty} {m.unit} · {m.item}
                      </span>
                      <span className="text-muted">
                        {m.color ? ` · ${m.color}` : ""}
                        {m.species ? ` · ${m.species}` : ""}
                        {m.lengths ? ` · ${m.lengths}` : ""}
                        {m.vendor ? ` · ${m.vendor}` : ""}
                      </span>
                    </div>
                    <button onClick={() => setMaterialItems((prev) => prev.filter((_, j) => j !== i))} className="p-1 rounded text-muted hover:text-danger shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <MaterialAdder catalog={catalog} onAdd={(m) => setMaterialItems((prev) => [...prev, m])} />
          </section>

          {/* Photos */}
          <section>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5" />
              Photos
            </label>
            {photos.length > 0 && (
              <div className="grid grid-cols-4 gap-2 mt-2">
                {photos.map((p) => (
                  <PhotoThumb key={p.id} blob={p.blob} onRemove={() => removePhoto(p.id)} />
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 mt-2">
              <label className="flex items-center justify-center gap-2 py-3 rounded-lg border border-dashed border-border text-sm font-medium text-muted cursor-pointer active:bg-surface">
                <Camera className="w-4 h-4" />
                Take photo
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length) {
                      addPhotos(files);
                      setSavePrompt(files[0]); // offer to save the shot to the device
                    }
                    e.target.value = "";
                  }}
                />
              </label>
              <label className="flex items-center justify-center gap-2 py-3 rounded-lg border border-dashed border-border text-sm font-medium text-muted cursor-pointer active:bg-surface">
                <ImagePlus className="w-4 h-4" />
                Upload
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length) addPhotos(files);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          </section>

          {/* Notes */}
          <section>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Anything else the office should know…"
              className="w-full mt-2 rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/50"
            />
          </section>

          <button
            onClick={commitEntry}
            disabled={!editorHasContent}
            className="w-full py-2.5 rounded-xl border-2 border-amber-500 text-amber-600 font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <Plus className="w-5 h-5" />
            {editingKey ? "Update unit" : "Add unit to write-up"}
          </button>

          {error && <p className="text-sm text-danger">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border shrink-0">
          <button
            onClick={submitAndEmail}
            disabled={submitting || totalUnits === 0}
            className="w-full py-3 rounded-xl bg-amber-500 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.99] transition-transform"
          >
            {submitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {progress ? `Uploading ${progress.done}/${progress.total}…` : "Saving…"}
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                Submit &amp; Email ({totalUnits} unit{totalUnits !== 1 ? "s" : ""})
              </>
            )}
          </button>
          <p className="text-[11px] text-muted text-center mt-1.5">
            Auto-saves as you go · saves the write-up, then opens your mail app with a link to send.
          </p>
        </div>
      </div>
    </div>
  );
}

function summarizeEntry(e: BuiltEntry): string {
  const parts: string[] = [];
  if (e.newProduct) parts.push(`added ${e.newProduct.type || "product"}`);
  if (e.lineItems.length) parts.push(`${e.lineItems.length} item${e.lineItems.length !== 1 ? "s" : ""}`);
  if (e.specChanges.length) parts.push(`${e.specChanges.length} spec fix`);
  if (e.materialItems.length) parts.push(`${e.materialItems.length} material`);
  if (e.photos.length) parts.push(`${e.photos.length} photo`);
  if (e.notes) parts.push("note");
  return parts.join(" · ") || "—";
}

function PhotoThumb({ blob, onRemove }: { blob: Blob; onRemove: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return (
    <div className="relative aspect-square rounded-lg overflow-hidden border border-border bg-surface">
      {url && <img src={url} alt="" className="w-full h-full object-cover" />}
      <button onClick={onRemove} className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/60 text-white">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function MaterialAdder({
  catalog,
  onAdd,
}: {
  catalog: CatalogPickItem[];
  onAdd: (m: WriteUpMaterialItem) => void;
}) {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<CatalogPickItem | null>(null);
  const [custom, setCustom] = useState(false);
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("PCS");
  const [color, setColor] = useState("");
  const [species, setSpecies] = useState("");
  const [lengths, setLengths] = useState("");
  const [vendor, setVendor] = useState("");

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
    setQty("1");
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
      qty: Math.max(1, Number(qty) || 1),
      unit: unit.trim() || "PCS",
      lengths: lengths.trim(),
      vendor: vendor.trim(),
      custom: custom || !picked,
    });
    reset();
  }

  const showEntry = picked || custom;

  return (
    <div className="mt-2 rounded-lg border border-dashed border-border p-2.5">
      <div className="relative">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPicked(null);
            setCustom(false);
          }}
          placeholder="Search catalog (e.g. 1x6 EJ, lattice, casing)…"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
        />
        {matches.length > 0 && (
          <div className="absolute z-10 left-0 right-0 mt-1 rounded-lg border border-border bg-background shadow-lg max-h-56 overflow-y-auto">
            {matches.map((c) => (
              <button
                key={c.id}
                onClick={() => choose(c)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-surface flex items-center justify-between gap-2"
              >
                <span className="font-medium truncate">{c.profile}</span>
                <span className="text-[10px] text-muted shrink-0">{c.category}</span>
              </button>
            ))}
            {search.trim() && (
              <button onClick={chooseCustom} className="w-full text-left px-3 py-2 text-sm border-t border-border text-amber-600 font-medium">
                + Use “{search.trim()}” as custom item
              </button>
            )}
          </div>
        )}
        {search.trim() && !picked && !custom && matches.length === 0 && (
          <button onClick={chooseCustom} className="mt-1 text-xs text-amber-600 font-medium">
            + Use “{search.trim()}” as custom item
          </button>
        )}
      </div>

      {showEntry && (
        <>
          <div className="grid grid-cols-3 gap-2 mt-2">
            <LabeledInput label="Qty" value={qty} onChange={setQty} type="number" />
            <LabeledInput label="Unit" value={unit} onChange={setUnit} />
            <LabeledInput label="Lengths" value={lengths} onChange={setLengths} placeholder="3 @ 8'" />
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <LabeledInput label="Color" value={color} onChange={setColor} />
            <LabeledInput
              label="Species"
              value={species}
              onChange={setSpecies}
              list={picked && picked.species.length ? "wu-species" : undefined}
            />
          </div>
          {picked && picked.species.length > 0 && (
            <datalist id="wu-species">
              {picked.species.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          )}
          <div className="grid grid-cols-2 gap-2 mt-2 items-end">
            {picked && picked.vendors.length > 1 ? (
              <div>
                <label className="text-[10px] font-medium text-muted block mb-0.5">Vendor</label>
                <select
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm"
                >
                  <option value="">—</option>
                  {picked.vendors.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <LabeledInput label="Vendor" value={vendor} onChange={setVendor} />
            )}
            <button onClick={add} className="py-2 rounded-lg bg-amber-500 text-white text-sm font-semibold flex items-center justify-center gap-1">
              <Plus className="w-4 h-4" />
              Add material
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function LabeledInput({
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
      <label className="text-[10px] font-medium text-muted block mb-0.5">{label}</label>
      <input
        type={type}
        value={value}
        list={list}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
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
      className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors flex items-center gap-1 ${
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
