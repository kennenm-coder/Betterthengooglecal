import { getSupabase } from "./supabase";
import { fetchCatalogAndOffsets, fetchTrimCatalogOptions } from "./nwo-builder";
import {
  FieldWorkOrder,
  WriteUpLineItem,
  SpecChange,
  WriteUpMaterialItem,
  WriteUpPhoto,
  WriteUpNewProduct,
  WriteUpStatus,
  MaterialUnit,
} from "./types";

const PHOTO_BUCKET = "writeup-photos";

// ─── Preset work-order items ────────────────────────────────────────────────
// Stored in the existing action_settings table (allowlisted read, admin write)
// under key "writeup_presets" so the list is editable without a deploy.

const PRESETS_KEY = "writeup_presets";

export const DEFAULT_WRITEUP_PRESETS = [
  "Redo caulking",
  "Recoil",
  "Window closes poorly",
  "Adjust / align hardware",
  "Reseal exterior",
  "Replace screen",
  "Touch-up paint",
  "Missing / damaged part",
];

export async function getWriteUpPresets(): Promise<string[]> {
  const supabase = getSupabase();
  if (supabase) {
    const { data } = await supabase
      .from("action_settings")
      .select("value")
      .eq("key", PRESETS_KEY)
      .maybeSingle();
    if (Array.isArray(data?.value) && data.value.length) return data.value as string[];
  }
  return DEFAULT_WRITEUP_PRESETS;
}

export async function setWriteUpPresets(presets: string[]): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase
    .from("action_settings")
    .upsert({ key: PRESETS_KEY, value: presets, updated_at: new Date().toISOString() });
}

// ─── Editable spec fields ───────────────────────────────────────────────────
// The overlay and the write-up editor share this list so a correction always
// maps back to the same unit properties the display reads.

export interface SpecField {
  label: string;
  read: (u: MaterialUnit) => string;
  write: (u: MaterialUnit, value: string) => void;
}

export const SPEC_FIELDS: SpecField[] = [
  {
    label: "Exterior Color",
    read: (u) => u.exteriorColor || u.summaryExterior || u.extColor || "",
    write: (u, v) => {
      u.exteriorColor = v;
      u.summaryExterior = v;
      u.extColor = v;
    },
  },
  {
    label: "Interior Color",
    read: (u) => u.interiorColor || u.summaryInterior || u.intColor || "",
    write: (u, v) => {
      u.interiorColor = v;
      u.summaryInterior = v;
      u.intColor = v;
    },
  },
  {
    label: "Interior Finish",
    read: (u) => u.intFinish || "",
    write: (u, v) => {
      u.intFinish = v;
    },
  },
  {
    label: "Details / Sub Type",
    read: (u) => u.subType || u.summarySubType || "",
    write: (u, v) => {
      u.subType = v;
      u.summarySubType = v;
    },
  },
  {
    label: "Frame",
    read: (u) => u.frame || u.summaryFrameType || "",
    write: (u, v) => {
      u.frame = v;
      u.summaryFrameType = v;
    },
  },
];

/** Best-effort label for a unit, matching how the app refers to it. */
export function unitLabelOf(u: MaterialUnit): string {
  return String(u.label || u.location || u.description || "").trim();
}

// ─── Unit option catalog (data-driven from submitted jobs) ──────────────────
// So field managers adding a product to an old job pick from the same product
// types / colors / finishes that really appear in submitted material jobs.

export interface UnitOptions {
  productTypes: string[];
  extColors: string[];
  intColors: string[];
  intFinishes: string[];
  details: string[];
  frames: string[];
}

// Seeds (from the material app's constants) so the lists are never empty.
const SEED_PRODUCT_TYPES = [
  "Double Hung", "Casement", "Double Casement", "Triple Casement", "Picture",
  "Awning", "Gliding", "Bay", "Bow", "Specialty", "Entry Door", "Patio Door",
  "Storm Door", "Screen",
];
const SEED_EXT_COLORS = [
  "White[RBA]", "Dark Bronze", "Canvas", "Sandtone", "Terratone", "Cocoa Bean",
  "Forest Green", "Black", "Red Rock",
];
const SEED_INT_COLORS = [
  "White[RBA]", "Dark Bronze", "Canvas", "Sandtone", "Terratone", "Cocoa Bean",
  "Forest Green", "Black", "Red Rock", "Walnut", "Oak", "Pine", "Birch", "Unfinished",
];

let _unitOptionsCache: UnitOptions | null = null;

export async function fetchUnitOptions(): Promise<UnitOptions> {
  if (_unitOptionsCache) return _unitOptionsCache;
  const types = new Set(SEED_PRODUCT_TYPES);
  const ext = new Set(SEED_EXT_COLORS);
  const int = new Set(SEED_INT_COLORS);
  const fin = new Set<string>(["Stain", "Paint", "Unfinished"]);
  const details = new Set<string>();
  const frames = new Set<string>();

  const supabase = getSupabase();
  if (supabase) {
    const { data } = await supabase.from("jobs").select("data");
    for (const row of data || []) {
      const units = (row as any).data?.units;
      if (!Array.isArray(units)) continue;
      for (const u of units) {
        if (u.isMisc) continue;
        const t = u.type || u.unitType || u.subType || u.summarySubType;
        if (t) types.add(String(t).trim());
        const e = u.exteriorColor || u.summaryExterior || u.extColor;
        if (e) ext.add(String(e).trim());
        const i = u.interiorColor || u.summaryInterior || u.intColor;
        if (i) int.add(String(i).trim());
        if (u.intFinish) fin.add(String(u.intFinish).trim());
        const d = u.subType || u.summarySubType;
        if (d) details.add(String(d).trim());
        const fr = u.frame || u.summaryFrameType;
        if (fr) frames.add(String(fr).trim());
      }
    }
  }

  const sort = (s: Set<string>) => [...s].filter(Boolean).sort((a, b) => a.localeCompare(b));
  _unitOptionsCache = {
    productTypes: sort(types),
    extColors: sort(ext),
    intColors: sort(int),
    intFinishes: sort(fin),
    details: sort(details),
    frames: sort(frames),
  };
  return _unitOptionsCache;
}

/**
 * Overlay field spec corrections (from write-ups) onto a copy of the units so
 * the calendar always shows the field-verified value. Non-destructive — the
 * source `jobs` blob is never touched.
 */
export function applySpecChangesToUnits(
  units: MaterialUnit[],
  writeUps: FieldWorkOrder[]
): MaterialUnit[] {
  const changes: SpecChange[] = writeUps
    .filter((w) => w.status !== "closed")
    .flatMap((w) => w.specChanges || []);
  if (!changes.length) return units;

  const byLabel = new Map<string, SpecChange[]>();
  for (const c of changes) {
    const key = c.unitLabel.trim().toLowerCase();
    if (!byLabel.has(key)) byLabel.set(key, []);
    byLabel.get(key)!.push(c);
  }

  return units.map((u) => {
    const key = unitLabelOf(u).toLowerCase();
    const unitChanges = byLabel.get(key);
    if (!unitChanges || !unitChanges.length) return u;
    const copy: MaterialUnit = { ...u, _fieldCorrected: true };
    for (const c of unitChanges) {
      const field = SPEC_FIELDS.find((f) => f.label === c.field);
      if (field) field.write(copy, c.newValue);
    }
    return copy;
  });
}

// ─── Catalog picker ─────────────────────────────────────────────────────────
// Reuses the shared material catalog (catalog_items / app_settings) that the
// install-instructions builder already reads, so field-ordered trim matches
// exactly what the material-list app produces.

export interface CatalogPickItem {
  id: string;
  profile: string;
  category: string;
  unit: string;
  nicknames: string[];
  species: string[];
  vendors: string[];
}

let _pickCache: CatalogPickItem[] | null = null;

export async function fetchCatalogPickItems(): Promise<CatalogPickItem[]> {
  if (_pickCache) return _pickCache;
  const { catalog } = await fetchCatalogAndOffsets();
  const items = (catalog.items || []).map((it: any) => {
    const options = Array.isArray(it.options) ? it.options : [];
    const species = [...new Set(options.map((o: any) => o.species).filter(Boolean))] as string[];
    const vendors = [
      ...new Set(options.flatMap((o: any) => (Array.isArray(o.vendors) ? o.vendors : []))),
    ] as string[];
    return {
      id: it.id,
      profile: it.profile || "",
      category: it.category || "",
      unit: it.unit || "PCS",
      nicknames: Array.isArray(it.nicknames) ? it.nicknames : [],
      species,
      vendors,
    };
  });
  items.sort((a: CatalogPickItem, b: CatalogPickItem) => a.profile.localeCompare(b.profile));
  _pickCache = items;
  return items;
}

// ─── Trim option lists (colors / species / stains) ──────────────────────────
// Feeds the write-up trim adder's type-ahead so color, species and stain are
// picked from the same catalog the material-list maker uses (custom text still
// allowed).

export interface TrimOptions {
  /** RbA exterior + interior colors seen across jobs. */
  colors: string[];
  /** Wood species offered by catalog profiles. */
  species: string[];
  /** Stain colors from the material catalog. */
  stains: string[];
}

let _trimOptsCache: TrimOptions | null = null;

export async function fetchTrimOptions(): Promise<TrimOptions> {
  if (_trimOptsCache) return _trimOptsCache;
  const [{ species, stains }, unit] = await Promise.all([
    fetchTrimCatalogOptions(),
    fetchUnitOptions(),
  ]);
  const colors = [...new Set([...unit.extColors, ...unit.intColors])]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  _trimOptsCache = { colors, species, stains };
  return _trimOptsCache;
}

// ─── Parts catalog (Andersen replacement parts) ─────────────────────────────

export interface PartsCatalogItem {
  id: string;
  productType: string;
  category: string;
  partName: string;
  position: string | null;
}

let _partsCache: PartsCatalogItem[] | null = null;

export async function fetchPartsCatalog(): Promise<PartsCatalogItem[]> {
  if (_partsCache) return _partsCache;
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("parts_catalog")
    .select("id, product_type, category, part_name, position")
    .eq("active", true)
    .order("product_type", { ascending: true })
    .order("category", { ascending: true });
  if (error || !data) return [];
  const mapped = (data as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    productType: String(r.product_type || ""),
    category: String(r.category || ""),
    partName: String(r.part_name || ""),
    position: (r.position as string) || null,
  }));
  // Only cache a non-empty result. An empty read (e.g. fetched before the
  // session/role is ready → RLS returns 0 rows with no error) must NOT be
  // cached, or the catalog stays blank for the whole page load. Returning it
  // uncached lets the next open retry once auth is resolved.
  if (mapped.length > 0) _partsCache = mapped;
  return mapped;
}

/**
 * Count total pieces from a trim "lengths" entry so quantity isn't double-typed
 * — matches the material-list maker's `N@len` format.
 *   "5"                 → 5   (plain count)
 *   "5@8'"              → 5
 *   "5@8' 10@10' 2@12'" → 17  (sum of the counts before each @)
 *   "8' 10'"            → 2   (bare lengths, no counts → one piece each)
 */
export function lengthsToQty(input: string): number {
  const s = (input || "").trim();
  if (!s) return 0;
  if (s.includes("@")) {
    let total = 0;
    for (const m of s.matchAll(/(\d+)\s*@/g)) total += Number(m[1]) || 0;
    return total;
  }
  if (/^\d+$/.test(s)) return Number(s);
  return s.split(/[\s,]+/).filter(Boolean).length;
}

// ─── Photos ─────────────────────────────────────────────────────────────────

/** Downscale + JPEG-compress a phone photo in-browser so uploads are fast. */
export async function compressImage(file: Blob, maxDim = 2000, quality = 0.7): Promise<Blob> {
  if (typeof document === "undefined") return file;
  const dataUrl: string = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, w, h);
  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
  );
  return blob || file;
}

function slugify(s: string): string {
  return (s || "unit").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unit";
}

/** Upload one already-compressed photo; returns its storage path or null. */
export async function uploadWriteUpPhoto(
  orderNumber: string,
  unitLabel: string | null,
  blob: Blob,
  index: number
): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const path = `${slugify(orderNumber)}/${slugify(unitLabel || "whole-job")}/${Date.now()}-${index}.jpg`;
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) return null;
  return path;
}

/** Signed URL for viewing a private photo (default 1 week). */
export async function getSignedPhotoUrl(path: string, expiresIn = 604800): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data) return null;
  return data.signedUrl;
}

// ─── Row mapping ────────────────────────────────────────────────────────────

interface FieldWorkOrderRow {
  id: string;
  order_number: string;
  work_order_number: string | null;
  job_id: string | null;
  customer_name: string | null;
  address: string | null;
  unit_label: string | null;
  line_items: WriteUpLineItem[] | null;
  spec_changes: SpecChange[] | null;
  material_items: WriteUpMaterialItem[] | null;
  photos: WriteUpPhoto[] | null;
  new_product: WriteUpNewProduct | null;
  notes: string | null;
  status: string;
  photo_count: number | null;
  photos_uploaded: boolean | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  updated_by_name: string | null;
}

function rowToWriteUp(row: FieldWorkOrderRow): FieldWorkOrder {
  return {
    id: row.id,
    orderNumber: row.order_number || "",
    workOrderNumber: row.work_order_number || "",
    jobId: row.job_id,
    customerName: row.customer_name || "",
    address: row.address || "",
    unitLabel: row.unit_label,
    lineItems: Array.isArray(row.line_items) ? row.line_items : [],
    specChanges: Array.isArray(row.spec_changes) ? row.spec_changes : [],
    materialItems: Array.isArray(row.material_items) ? row.material_items : [],
    photos: Array.isArray(row.photos) ? row.photos : [],
    newProduct: row.new_product || null,
    notes: row.notes || "",
    status: (row.status as WriteUpStatus) || "open",
    photoCount: row.photo_count || 0,
    photosUploaded: !!row.photos_uploaded,
    createdBy: row.created_by || "",
    createdByName: row.created_by_name || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by || "",
    updatedByName: row.updated_by_name || "",
  };
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export interface NewWriteUp {
  orderNumber: string;
  workOrderNumber?: string;
  jobId?: string | null;
  customerName?: string;
  address?: string;
  unitLabel: string | null;
  lineItems: WriteUpLineItem[];
  specChanges: SpecChange[];
  materialItems: WriteUpMaterialItem[];
  photos: WriteUpPhoto[];
  newProduct?: WriteUpNewProduct | null;
  notes: string;
  createdBy?: string;
  createdByName?: string;
}

export interface CreateWriteUpResult {
  writeUp: FieldWorkOrder | null;
  error: string | null;
}

export async function createWriteUp(input: NewWriteUp): Promise<CreateWriteUpResult> {
  const supabase = getSupabase();
  if (!supabase) {
    return { writeUp: null, error: "Not signed in — could not reach the database." };
  }

  const { data, error } = await supabase
    .from("field_work_orders")
    .insert({
      order_number: input.orderNumber,
      work_order_number: input.workOrderNumber || null,
      job_id: input.jobId || null,
      customer_name: input.customerName || null,
      address: input.address || null,
      unit_label: input.unitLabel,
      line_items: input.lineItems,
      spec_changes: input.specChanges,
      material_items: input.materialItems,
      photos: input.photos,
      photo_count: input.photos.length,
      new_product: input.newProduct || null,
      notes: input.notes || "",
      status: "open",
      created_by: input.createdBy || null,
      created_by_name: input.createdByName || null,
    })
    .select("*")
    .single();

  if (error || !data) {
    // Surface the real reason (RLS denial, missing table/column, etc.) instead
    // of failing silently — the modal shows this to the field manager.
    console.error("createWriteUp insert failed:", error);
    return { writeUp: null, error: error?.message || "Unknown database error." };
  }
  return { writeUp: rowToWriteUp(data as FieldWorkOrderRow), error: null };
}

// ─── Batch submit (multi-unit write-up) ─────────────────────────────────────

/** One unit's worth of work inside a multi-unit write-up session. */
export interface WriteUpEntryInput {
  unitLabel: string | null;
  lineItems: WriteUpLineItem[];
  specChanges: SpecChange[];
  materialItems: WriteUpMaterialItem[];
  newProduct?: WriteUpNewProduct | null;
  notes: string;
  /** Local photo blobs (from camera/upload or a restored draft), uploaded during submit. */
  photoFiles: Blob[];
}

export interface SubmitContext {
  orderNumber: string;
  workOrderNumber?: string;
  jobId?: string | null;
  customerName?: string;
  address?: string;
  createdBy?: string;
  createdByName?: string;
}

export interface SubmitBatchResult {
  created: FieldWorkOrder[];
  /** First database error encountered, if any — surfaced to the user. */
  error: string | null;
}

/**
 * Upload photos and create one row per unit entry. Returns the created
 * write-ups plus the first error (if any). Photo upload failures are skipped so
 * the write-up still saves; a row-insert failure stops the batch and reports.
 */
export async function submitWriteUpBatch(
  ctx: SubmitContext,
  entries: WriteUpEntryInput[],
  onProgress?: (done: number, total: number) => void
): Promise<SubmitBatchResult> {
  const created: FieldWorkOrder[] = [];
  let done = 0;
  for (const e of entries) {
    const photos: WriteUpPhoto[] = [];
    const total = e.photoFiles.length;
    for (let i = 0; i < total; i++) {
      const blob = await compressImage(e.photoFiles[i]);
      const path = await uploadWriteUpPhoto(ctx.orderNumber, e.unitLabel, blob, i + 1);
      if (path) {
        photos.push({ path, name: `${e.unitLabel || "Whole job"} photo ${i + 1} of ${total}` });
      }
    }
    const { writeUp, error } = await createWriteUp({
      orderNumber: ctx.orderNumber,
      workOrderNumber: ctx.workOrderNumber,
      jobId: ctx.jobId,
      customerName: ctx.customerName,
      address: ctx.address,
      unitLabel: e.unitLabel,
      lineItems: e.lineItems,
      specChanges: e.specChanges,
      materialItems: e.materialItems,
      photos,
      newProduct: e.newProduct || null,
      notes: e.notes,
      createdBy: ctx.createdBy,
      createdByName: ctx.createdByName,
    });
    if (writeUp) {
      created.push(writeUp);
    } else {
      // Stop on the first insert failure and report it — the draft is kept so
      // nothing is lost.
      return { created, error: error || "Could not save the write-up." };
    }
    onProgress?.(++done, entries.length);
  }
  return { created, error: null };
}

// ─── Edit an existing write-up ──────────────────────────────────────────────

export interface UpdateWriteUpInput {
  /** Order number, used for the storage path of any newly-added photos. */
  orderNumber: string;
  unitLabel: string | null;
  lineItems: WriteUpLineItem[];
  specChanges: SpecChange[];
  materialItems: WriteUpMaterialItem[];
  newProduct?: WriteUpNewProduct | null;
  notes: string;
  status: WriteUpStatus;
  /** Existing photos to keep (already uploaded — have a storage path). */
  keepPhotos: WriteUpPhoto[];
  /** New photo blobs to upload and append. */
  newPhotoFiles: Blob[];
  updatedBy: string;
  updatedByName: string;
}

/**
 * Update a submitted write-up in place. Uploads any new photos, keeps the ones
 * the editor retained, and stamps who edited it (updated_by / updated_at).
 */
export async function updateWriteUp(
  id: string,
  input: UpdateWriteUpInput
): Promise<{ ok: boolean; error: string | null }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Not signed in." };

  const photos: WriteUpPhoto[] = [...input.keepPhotos];
  for (let i = 0; i < input.newPhotoFiles.length; i++) {
    const blob = await compressImage(input.newPhotoFiles[i]);
    const path = await uploadWriteUpPhoto(input.orderNumber, input.unitLabel, blob, photos.length + 1);
    if (path) photos.push({ path, name: `${input.unitLabel || "Whole job"} photo ${photos.length + 1}` });
  }

  const { error } = await supabase
    .from("field_work_orders")
    .update({
      unit_label: input.unitLabel,
      line_items: input.lineItems,
      spec_changes: input.specChanges,
      material_items: input.materialItems,
      photos,
      photo_count: photos.length,
      new_product: input.newProduct || null,
      notes: input.notes || "",
      status: input.status,
      updated_by: input.updatedBy || null,
      updated_by_name: input.updatedByName || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("updateWriteUp failed:", error);
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}

/**
 * Plain-text version of a job's write-ups — for pasting into the internal
 * system's details tab (what the service tech reads on their phone). Work items
 * show done/not-done so partial completion carries over.
 */
export function writeUpsToPlainText(writeUps: FieldWorkOrder[]): string {
  if (!writeUps.length) return "";
  const first = writeUps[0];
  const lines: string[] = [];
  lines.push(`FIELD WRITE-UP — ${first.customerName || ""} (#${first.orderNumber})`.trim());
  if (first.address) lines.push(first.address);
  lines.push("");

  for (const w of writeUps) {
    lines.push(`${w.unitLabel || "Whole job"}${w.status === "closed" ? "  [CLOSED]" : ""}`);
    if (w.newProduct) {
      lines.push(
        `  Added product: ${w.newProduct.type || "—"}${w.newProduct.size ? ` ${w.newProduct.size}` : ""}`
      );
    }
    if (w.lineItems.length) {
      lines.push("  Work to complete:");
      for (const li of w.lineItems) {
        lines.push(`   [${li.completed ? "x" : " "}] ${li.label}${li.notes ? ` — ${li.notes}` : ""}`);
      }
    }
    if (w.specChanges.length) {
      lines.push("  Spec corrections:");
      for (const c of w.specChanges) {
        lines.push(`   - ${c.field}: ${c.oldValue || "—"} -> ${c.newValue}`);
      }
    }
    if (w.materialItems.length) {
      lines.push("  Materials:");
      for (const m of w.materialItems) {
        lines.push(
          `   - ${m.qty} ${m.unit} ${m.item}${m.color ? ` ${m.color}` : ""}${m.lengths ? ` (${m.lengths})` : ""}${m.vendor ? ` [${m.vendor}]` : ""}`
        );
      }
    }
    if (w.notes) lines.push(`  Notes: ${w.notes}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

/**
 * Delete all photos for a write-up: remove the files from the private bucket
 * and clear the row's photo list. Admin/field-manager only (enforced by RLS).
 */
export async function deleteWriteUpPhotos(
  id: string,
  paths: string[]
): Promise<{ ok: boolean; error: string | null }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Not signed in." };

  if (paths.length > 0) {
    const { error: rmErr } = await supabase.storage.from(PHOTO_BUCKET).remove(paths);
    if (rmErr) {
      console.error("deleteWriteUpPhotos storage remove failed:", rmErr);
      return { ok: false, error: rmErr.message };
    }
  }

  const { error } = await supabase
    .from("field_work_orders")
    .update({ photos: [], photo_count: 0, photos_uploaded: false })
    .eq("id", id);
  if (error) {
    console.error("deleteWriteUpPhotos row update failed:", error);
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}

/**
 * Delete a whole write-up (its photos from storage, then the row). Photo
 * removal is best-effort so a storage hiccup doesn't strand the row.
 * Admin/field-manager only (enforced by RLS).
 */
export async function deleteWriteUp(
  id: string,
  photoPaths: string[]
): Promise<{ ok: boolean; error: string | null }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Not signed in." };

  if (photoPaths.length > 0) {
    try {
      await supabase.storage.from(PHOTO_BUCKET).remove(photoPaths);
    } catch {
      /* best-effort — still delete the row */
    }
  }

  const { error } = await supabase.from("field_work_orders").delete().eq("id", id);
  if (error) {
    console.error("deleteWriteUp failed:", error);
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}

/** Field-notes inbox the write-up email is addressed to. */
export const WRITEUP_EMAIL_TO = "fieldnotes@rbanwo.com";

/** Build a mailto: link with a pre-written summary + a link to the doc. */
export function buildWriteUpMailto(
  ctx: SubmitContext,
  entries: WriteUpEntryInput[],
  docLink: string,
  cc?: string[]
): string {
  const subject = `Field Write-Up - ${ctx.customerName || ""} - ${ctx.orderNumber}`;
  const lines: string[] = [
    "A field write-up was completed:",
    "",
    `Customer: ${ctx.customerName || "—"}`,
    `Job #: ${ctx.orderNumber}`,
  ];
  if (ctx.address) lines.push(`Address: ${ctx.address}`);
  lines.push("", "Work:");
  for (const e of entries) {
    lines.push(`• ${e.unitLabel || "Whole job"}`);
    if (e.newProduct)
      lines.push(
        `   - ADDED PRODUCT: ${e.newProduct.type}${e.newProduct.size ? ` ${e.newProduct.size}` : ""}${
          e.newProduct.exteriorColor ? ` / ext ${e.newProduct.exteriorColor}` : ""
        }${e.newProduct.interiorColor ? ` / int ${e.newProduct.interiorColor}` : ""}`
      );
    for (const li of e.lineItems) lines.push(`   - ${li.label}`);
    for (const c of e.specChanges) lines.push(`   - Spec: ${c.field} -> ${c.newValue}`);
    for (const m of e.materialItems)
      lines.push(
        `   - Material: ${m.qty} ${m.unit} ${m.item}${m.color ? ` ${m.color}` : ""}${
          m.lengths ? ` ${m.lengths}` : ""
        }${m.vendor ? ` (${m.vendor})` : ""}`
      );
    if (e.photoFiles.length) lines.push(`   - ${e.photoFiles.length} photo(s) attached to the write-up`);
    if (e.notes) lines.push(`   - Notes: ${e.notes}`);
  }
  lines.push("", "View the full write-up (Duck Force sign-in required):", docLink);

  const ccPart = cc && cc.length ? `&cc=${encodeURIComponent(cc.join(","))}` : "";
  return `mailto:${WRITEUP_EMAIL_TO}?subject=${encodeURIComponent(subject)}${ccPart}&body=${encodeURIComponent(
    lines.join("\n")
  )}`;
}

export async function fetchWriteUpsForOrder(orderNumber: string): Promise<FieldWorkOrder[]> {
  const supabase = getSupabase();
  if (!supabase || !orderNumber) return [];
  const { data, error } = await supabase
    .from("field_work_orders")
    .select("*")
    .eq("order_number", orderNumber)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as FieldWorkOrderRow[]).map(rowToWriteUp);
}

export async function fetchWriteUps(statuses?: WriteUpStatus[]): Promise<FieldWorkOrder[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  let query = supabase.from("field_work_orders").select("*");
  if (statuses && statuses.length) query = query.in("status", statuses);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as FieldWorkOrderRow[]).map(rowToWriteUp);
}

/** Map of order_number → count of open write-ups, for calendar-card badges. */
export async function fetchOpenWriteUpCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const supabase = getSupabase();
  if (!supabase) return counts;
  const { data, error } = await supabase
    .from("field_work_orders")
    .select("order_number, status")
    .neq("status", "closed");
  if (error || !data) return counts;
  for (const row of data as { order_number: string }[]) {
    counts.set(row.order_number, (counts.get(row.order_number) || 0) + 1);
  }
  return counts;
}

export async function updateWriteUpStatus(id: string, status: WriteUpStatus): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase
    .from("field_work_orders")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  return !error;
}
