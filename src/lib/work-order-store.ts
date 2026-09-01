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
    // Preferred source: the editable work-to-complete catalog (verified items).
    const { data: work } = await supabase
      .from("work_catalog")
      .select("label")
      .eq("active", true)
      .eq("verified", true)
      .order("label", { ascending: true });
    if (Array.isArray(work) && work.length) return work.map((r) => String((r as { label: string }).label));
    // Legacy fallback until migration 014 seeds the work catalog.
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

/** A color+size combination and its specific part number. */
export interface PartVariant {
  color: string;
  size: string;
  partNumber: string;
}

export interface PartsCatalogItem {
  id: string;
  productType: string;
  category: string;
  partName: string;
  position: string | null;
  colors: string[];
  sizes: string[];
  variants: PartVariant[];
  /** false = auto-added from a write-up, awaiting an admin/field-manager review. */
  verified: boolean;
}

const PART_SELECT = "id, product_type, category, part_name, position, colors, sizes, variants, verified";

function rowToPart(r: Record<string, unknown>): PartsCatalogItem {
  return {
    id: String(r.id),
    productType: String(r.product_type || ""),
    category: String(r.category || ""),
    partName: String(r.part_name || ""),
    position: (r.position as string) || null,
    colors: Array.isArray(r.colors) ? (r.colors as string[]) : [],
    sizes: Array.isArray(r.sizes) ? (r.sizes as string[]) : [],
    variants: Array.isArray(r.variants) ? (r.variants as PartVariant[]) : [],
    verified: r.verified !== false,
  };
}

let _partsCache: PartsCatalogItem[] | null = null;
export function invalidatePartsCache() {
  _partsCache = null;
}

/** Verified parts only — feeds the write-up "Parts needed" suggestions. */
export async function fetchPartsCatalog(): Promise<PartsCatalogItem[]> {
  if (_partsCache) return _partsCache;
  const supabase = getSupabase();
  if (!supabase) return [];
  const rich = await supabase
    .from("parts_catalog")
    .select(PART_SELECT)
    .eq("active", true)
    .eq("verified", true)
    .order("product_type", { ascending: true })
    .order("category", { ascending: true });
  let rows = rich.data as Record<string, unknown>[] | null;
  // Fallback for before migration 014 (new columns don't exist yet): the basic
  // columns still work, so the picker keeps suggesting parts.
  if (rich.error) {
    const basic = await supabase
      .from("parts_catalog")
      .select("id, product_type, category, part_name, position")
      .eq("active", true)
      .order("product_type", { ascending: true })
      .order("category", { ascending: true });
    rows = basic.data as Record<string, unknown>[] | null;
  }
  if (!rows) return [];
  const mapped = rows.map(rowToPart);
  // Don't cache an empty read (RLS may return 0 rows before auth resolves).
  if (mapped.length > 0) _partsCache = mapped;
  return mapped;
}

/** Every active part (verified + unverified) — for the settings catalog editor. */
export async function fetchAllParts(): Promise<PartsCatalogItem[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("parts_catalog")
    .select(PART_SELECT)
    .eq("active", true)
    .order("verified", { ascending: true })
    .order("product_type", { ascending: true })
    .order("category", { ascending: true });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(rowToPart);
}

export interface PartInput {
  id?: string;
  productType: string;
  category: string;
  partName: string;
  position?: string | null;
  colors: string[];
  sizes: string[];
  variants: PartVariant[];
  verified?: boolean;
}

export async function upsertPart(input: PartInput): Promise<{ ok: boolean; error: string | null }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Not signed in." };
  const row = {
    product_type: input.productType.trim(),
    category: input.category.trim(),
    part_name: input.partName.trim(),
    position: input.position?.trim() || null,
    colors: input.colors,
    sizes: input.sizes,
    variants: input.variants,
    verified: input.verified !== false,
    active: true,
  };
  const q = input.id
    ? supabase.from("parts_catalog").update(row).eq("id", input.id)
    : supabase.from("parts_catalog").insert(row);
  const { error } = await q;
  if (error) {
    console.error("upsertPart failed:", error);
    return { ok: false, error: error.message };
  }
  invalidatePartsCache();
  return { ok: true, error: null };
}

export async function deletePart(id: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase.from("parts_catalog").delete().eq("id", id);
  if (!error) invalidatePartsCache();
  return !error;
}

/** Auto-add a custom part typed on a write-up, as UNVERIFIED (skips duplicates). */
export async function addCustomPart(partName: string, productType?: string): Promise<void> {
  const name = partName.trim();
  if (!name) return;
  const supabase = getSupabase();
  if (!supabase) return;
  const { data } = await supabase.from("parts_catalog").select("id").ilike("part_name", name).limit(1);
  if (Array.isArray(data) && data.length) return; // already in the catalog
  await supabase.from("parts_catalog").insert({
    product_type: (productType || "").trim() || "Custom",
    category: "Custom",
    part_name: name,
    colors: [],
    sizes: [],
    variants: [],
    verified: false,
    active: true,
  });
  invalidatePartsCache();
}

// ─── Work-to-complete catalog (feeds "what needs done") ─────────────────────

export interface WorkCatalogItem {
  id: string;
  label: string;
  productType: string | null;
  /** Minutes to complete per unit (optional, informational for now). */
  minutesPerUnit: number | null;
  verified: boolean;
  active: boolean;
}

function rowToWork(r: Record<string, unknown>): WorkCatalogItem {
  return {
    id: String(r.id),
    label: String(r.label || ""),
    productType: (r.product_type as string) || null,
    minutesPerUnit: r.minutes_per_unit == null ? null : Number(r.minutes_per_unit),
    verified: r.verified !== false,
    active: r.active !== false,
  };
}

let _workCache: WorkCatalogItem[] | null = null;
export function invalidateWorkCache() {
  _workCache = null;
}

/** Verified work items only — feeds the "what needs done" preset chips. */
export async function fetchWorkCatalog(): Promise<WorkCatalogItem[]> {
  if (_workCache) return _workCache;
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("work_catalog")
    .select("id, label, product_type, minutes_per_unit, verified, active")
    .eq("active", true)
    .eq("verified", true)
    .order("label", { ascending: true });
  if (error || !data) return [];
  const mapped = (data as Record<string, unknown>[]).map(rowToWork);
  if (mapped.length > 0) _workCache = mapped;
  return mapped;
}

/** Every active work item (verified + unverified) — for the settings editor. */
export async function fetchAllWork(): Promise<WorkCatalogItem[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("work_catalog")
    .select("id, label, product_type, minutes_per_unit, verified, active")
    .eq("active", true)
    .order("verified", { ascending: true })
    .order("label", { ascending: true });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(rowToWork);
}

export interface WorkInput {
  id?: string;
  label: string;
  productType?: string | null;
  minutesPerUnit?: number | null;
  verified?: boolean;
}

export async function upsertWork(input: WorkInput): Promise<{ ok: boolean; error: string | null }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Not signed in." };
  const row = {
    label: input.label.trim(),
    product_type: input.productType?.trim() || null,
    minutes_per_unit: input.minutesPerUnit ?? null,
    verified: input.verified !== false,
    active: true,
  };
  const q = input.id
    ? supabase.from("work_catalog").update(row).eq("id", input.id)
    : supabase.from("work_catalog").insert(row);
  const { error } = await q;
  if (error) {
    console.error("upsertWork failed:", error);
    return { ok: false, error: error.message };
  }
  invalidateWorkCache();
  return { ok: true, error: null };
}

export async function deleteWork(id: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase.from("work_catalog").delete().eq("id", id);
  if (!error) invalidateWorkCache();
  return !error;
}

/** Auto-add a custom work item typed on a write-up, as UNVERIFIED (skips dupes). */
export async function addCustomWork(label: string): Promise<void> {
  const clean = label.trim();
  if (!clean) return;
  const supabase = getSupabase();
  if (!supabase) return;
  const { data } = await supabase.from("work_catalog").select("id").ilike("label", clean).limit(1);
  if (Array.isArray(data) && data.length) return; // already catalogued
  await supabase.from("work_catalog").insert({ label: clean, verified: false, active: true });
  invalidateWorkCache();
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
  batch_id: string | null;
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
    batchId: row.batch_id || null,
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
  /** Shared id tying this row to the other units in the same submission. */
  batchId?: string | null;
  /** Starting status — "draft" (saved) or "in_review" (submitted). */
  status?: WriteUpStatus;
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
      batch_id: input.batchId || null,
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
      status: input.status || "in_review",
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

/** A photo on an entry: a new blob to upload, or an already-uploaded one to keep. */
export interface EntryPhoto {
  /** New photo to upload (camera/upload/restored draft). */
  blob?: Blob;
  /** Existing photo to keep as-is when editing (already in storage). */
  path?: string;
  name: string;
}

/** One unit's worth of work inside a multi-unit write-up session. */
export interface WriteUpEntryInput {
  unitLabel: string | null;
  lineItems: WriteUpLineItem[];
  specChanges: SpecChange[];
  materialItems: WriteUpMaterialItem[];
  newProduct?: WriteUpNewProduct | null;
  notes: string;
  /** Photos on this unit — new blobs (uploaded on save) and kept existing ones. */
  photos: EntryPhoto[];
}

/** Resolve an entry's photos to storage records: keep existing, upload new. */
async function resolveEntryPhotos(orderNumber: string, unitLabel: string | null, photos: EntryPhoto[]): Promise<WriteUpPhoto[]> {
  const out: WriteUpPhoto[] = [];
  for (const p of photos) {
    if (p.path) {
      out.push({ path: p.path, name: p.name });
      continue;
    }
    if (!p.blob) continue;
    const blob = await compressImage(p.blob);
    const path = await uploadWriteUpPhoto(orderNumber, unitLabel, blob, out.length + 1);
    if (path) out.push({ path, name: p.name || `${unitLabel || "Whole job"} photo ${out.length + 1}` });
  }
  return out;
}

/** Copy reviewed / installed state from old items onto new ones by matching label. */
function carryItemState(newItems: WriteUpLineItem[], oldItems: WriteUpLineItem[]): WriteUpLineItem[] {
  const used = new Set<number>();
  return newItems.map((ni) => {
    const key = ni.label.trim().toLowerCase();
    const idx = oldItems.findIndex((oi, i) => !used.has(i) && oi.label.trim().toLowerCase() === key);
    if (idx < 0) return ni;
    used.add(idx);
    const old = oldItems[idx];
    return {
      ...ni,
      reviewed: old.reviewed,
      reviewedBy: old.reviewedBy,
      reviewedByName: old.reviewedByName,
      reviewedAt: old.reviewedAt,
      completed: old.completed,
    };
  });
}

export interface SubmitContext {
  orderNumber: string;
  workOrderNumber?: string;
  jobId?: string | null;
  customerName?: string;
  address?: string;
  createdBy?: string;
  createdByName?: string;
  /** "draft" (Save draft) or "in_review" (Submit). Defaults to in_review. */
  status?: WriteUpStatus;
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
  // One shared id for every row in this submission, so the doc/PDF can render
  // it as a single write-up section separate from other write-ups on the job.
  const batchId = crypto.randomUUID();
  let done = 0;
  for (const e of entries) {
    const photos = await resolveEntryPhotos(ctx.orderNumber, e.unitLabel, e.photos);
    const { writeUp, error } = await createWriteUp({
      orderNumber: ctx.orderNumber,
      batchId,
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
      status: ctx.status || "in_review",
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

// ─── Edit a whole write-up (guided flow, in place) ──────────────────────────

export interface EditBatchContext extends SubmitContext {
  /** The submission's shared id, reused so it stays one write-up. */
  batchId: string;
  updatedBy: string;
  updatedByName: string;
}

/**
 * Save an edited write-up submission IN PLACE, matched per unit:
 *  - a unit that still exists → its row is UPDATED (id, created_at, status, and
 *    each item's reviewed/installed state are preserved);
 *  - a newly added unit → a new row is INSERTED with the same batch id;
 *  - a removed unit → its row (and photos) are DELETED — only after every
 *    update/insert succeeds, so a failure never loses data.
 */
export async function saveWriteUpBatchEdit(
  oldRows: FieldWorkOrder[],
  ctx: EditBatchContext,
  entries: WriteUpEntryInput[],
  onProgress?: (done: number, total: number) => void
): Promise<{ ok: boolean; error: string | null }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Not signed in — could not reach the database." };
  const now = new Date().toISOString();
  // Prefer the status the editor picked; else keep the submission's current one.
  const status: WriteUpStatus = ctx.status || oldRows[0]?.status || "in_review";
  const norm = (l: string | null) => (l || "").trim().toLowerCase();
  const usedOld = new Set<string>();
  let done = 0;

  for (const e of entries) {
    const photos = await resolveEntryPhotos(ctx.orderNumber, e.unitLabel, e.photos);
    const match = oldRows.find((r) => !usedOld.has(r.id) && norm(r.unitLabel) === norm(e.unitLabel));
    const lineItems = carryItemState(e.lineItems, match?.lineItems || []);
    const shared = {
      unit_label: e.unitLabel,
      line_items: lineItems,
      spec_changes: e.specChanges,
      material_items: e.materialItems,
      photos,
      photo_count: photos.length,
      new_product: e.newProduct || null,
      notes: e.notes || "",
      status,
      updated_by: ctx.updatedBy || null,
      updated_by_name: ctx.updatedByName || null,
      updated_at: now,
    };
    if (match) {
      usedOld.add(match.id);
      const { error } = await supabase.from("field_work_orders").update(shared).eq("id", match.id);
      if (error) {
        console.error("saveWriteUpBatchEdit update failed:", error);
        return { ok: false, error: error.message };
      }
    } else {
      const { error } = await supabase.from("field_work_orders").insert({
        order_number: ctx.orderNumber,
        batch_id: ctx.batchId,
        work_order_number: ctx.workOrderNumber || null,
        job_id: ctx.jobId || null,
        customer_name: ctx.customerName || null,
        address: ctx.address || null,
        created_by: ctx.createdBy || null,
        created_by_name: ctx.createdByName || null,
        ...shared,
      });
      if (error) {
        console.error("saveWriteUpBatchEdit insert failed:", error);
        return { ok: false, error: error.message };
      }
    }
    onProgress?.(++done, entries.length);
  }

  // All writes succeeded — now remove rows for units that were dropped.
  for (const r of oldRows) {
    if (usedOld.has(r.id)) continue;
    if (r.photos.length) {
      try {
        await supabase.storage.from(PHOTO_BUCKET).remove(r.photos.map((p) => p.path));
      } catch {
        /* orphaned files are harmless; keep going */
      }
    }
    await supabase.from("field_work_orders").delete().eq("id", r.id);
  }

  invalidateWriteUpsCache();
  return { ok: true, error: null };
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

/** Default inbox a write-up email is addressed to (admin-configurable via the
 *  Dev Settings → Config → Email Defaults section; see getWriteUpEmails()). */
export const WRITEUP_EMAIL_TO = "fieldnotes@rbanwo.com";

/** Build the subject + plain-text body for a submitted write-up notification.
 *  Shared by both the in-app server send (POST /api/writeups/notify) and the
 *  legacy mailto: fallback so the two stay identical. */
export function buildWriteUpEmailContent(
  ctx: SubmitContext,
  entries: WriteUpEntryInput[],
  docLink: string
): { subject: string; body: string } {
  const subject = `Field Write-Up - ${ctx.customerName || ""} - ${ctx.orderNumber}`;
  const lines: string[] = [
    "A field write-up was completed:",
    "",
    `Customer: ${ctx.customerName || "—"}`,
    `Job #: ${ctx.orderNumber}`,
  ];
  // Log who submitted it — the send is from a generic mailbox, so the identity
  // lives in the body (and the Reply-To header the server sets).
  if (ctx.createdBy) lines.push(`Submitted by: ${ctx.createdByName || ctx.createdBy} <${ctx.createdBy}>`);
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
    if (e.photos.length) lines.push(`   - ${e.photos.length} photo(s) attached to the write-up`);
    if (e.notes) lines.push(`   - Notes: ${e.notes}`);
  }
  lines.push("", "View the full write-up (Duck Force sign-in required):", docLink);
  return { subject, body: lines.join("\n") };
}

/** Build a mailto: link with a pre-written summary + a link to the doc.
 *  Kept as a fallback path; the primary send now goes through the server.
 *  `to` is the list of default recipients (falls back to WRITEUP_EMAIL_TO);
 *  `cc` is the submitting user's per-account auto-CC list. */
export function buildWriteUpMailto(
  ctx: SubmitContext,
  entries: WriteUpEntryInput[],
  docLink: string,
  to?: string[],
  cc?: string[]
): string {
  const toList = to && to.length ? to : [WRITEUP_EMAIL_TO];
  const { subject, body } = buildWriteUpEmailContent(ctx, entries, docLink);
  const ccPart = cc && cc.length ? `&cc=${encodeURIComponent(cc.join(","))}` : "";
  return `mailto:${toList.join(",")}?subject=${encodeURIComponent(subject)}${ccPart}&body=${encodeURIComponent(
    body
  )}`;
}

export async function fetchWriteUpsForOrder(orderNumber: string): Promise<FieldWorkOrder[]> {
  const supabase = getSupabase();
  if (!supabase || !orderNumber) return [];
  // Archived write-ups are excluded so they never appear on the joined
  // doc / PDF / copied text (e.g. a test write-up superseded by a real one).
  const { data, error } = await supabase
    .from("field_work_orders")
    .select("*")
    .eq("order_number", orderNumber)
    .neq("status", "archived")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as FieldWorkOrderRow[]).map(rowToWriteUp);
}

// ─── Write-ups list cache (perceived speed + egress control) ────────────────
// The write-ups list is a full-table pull (select *). To avoid re-downloading
// it on every visit to the Write-Ups tab, we cache the un-filtered result both
// in memory (shared for the page session) and in localStorage (survives reload
// for instant paint). A short freshness window means rapid tab-switching reuses
// the cache instead of hitting the network — the actual egress win.
const WRITEUPS_CACHE_KEY = "rba-writeups-list-v1";
const WRITEUPS_TTL_MS = 2 * 60 * 1000; // 2 min: reuse without refetching
let _writeUpsCache: { data: FieldWorkOrder[]; ts: number } | null = null;

/** Cached write-ups for instant paint, or null if nothing cached yet. */
export function loadCachedWriteUps(): FieldWorkOrder[] | null {
  if (_writeUpsCache) return _writeUpsCache.data;
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(WRITEUPS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data: FieldWorkOrder[]; ts: number };
    if (!parsed?.data) return null;
    _writeUpsCache = parsed;
    return parsed.data;
  } catch {
    return null;
  }
}

/** True when the cached list is fresh enough to skip a network refetch. */
export function writeUpsCacheFresh(): boolean {
  const ts = _writeUpsCache?.ts;
  return typeof ts === "number" && Date.now() - ts < WRITEUPS_TTL_MS;
}

/** Drop the cache so the next load refetches (call after any write-up change). */
export function invalidateWriteUpsCache() {
  _writeUpsCache = null;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(WRITEUPS_CACHE_KEY);
    } catch {
      /* ignore */
    }
  }
}

function cacheWriteUps(data: FieldWorkOrder[]) {
  _writeUpsCache = { data, ts: Date.now() };
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(WRITEUPS_CACHE_KEY, JSON.stringify(_writeUpsCache));
  } catch {
    // Over quota (large photo/entry payloads) — keep the in-memory cache only.
  }
}

export async function fetchWriteUps(statuses?: WriteUpStatus[]): Promise<FieldWorkOrder[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  let query = supabase.from("field_work_orders").select("*");
  if (statuses && statuses.length) query = query.in("status", statuses);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error || !data) return [];
  const rows = (data as FieldWorkOrderRow[]).map(rowToWriteUp);
  // Only the un-filtered "all" list is cached (that's what the tab loads).
  if (!statuses || statuses.length === 0) cacheWriteUps(rows);
  return rows;
}

/** Map of order_number → count of open write-ups, for calendar-card badges. */
export async function fetchOpenWriteUpCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const supabase = getSupabase();
  if (!supabase) return counts;
  // Actionable write-ups only: submitted and not yet closed. Drafts (not
  // submitted) and closed ones don't warrant a calendar badge.
  const { data, error } = await supabase
    .from("field_work_orders")
    .select("order_number, status")
    .in("status", ["in_review", "open"]);
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
  if (!error) invalidateWriteUpsCache();
  return !error;
}

/** Persist a row's line items (used to mark work items reviewed/completed). */
export async function updateWriteUpLineItems(id: string, lineItems: WriteUpLineItem[]): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase
    .from("field_work_orders")
    .update({ line_items: lineItems, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("updateWriteUpLineItems failed:", error);
    return false;
  }
  invalidateWriteUpsCache();
  return true;
}
