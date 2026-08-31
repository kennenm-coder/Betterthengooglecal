// NWO Material List builder — ported from nwo-material-list-maker to produce
// identical install-instructions output. Fetches materialCatalog + offsets from
// the shared Supabase app_settings table.

import { getSupabase } from "./supabase";

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const MC_WINDOW_ABBREVS = new Set(["CS","CD","CT","DG","PW","FC","SPW","AN","GL","GT","DH","CAS","PIC","SLD","AWN","GLD","SN","BOW","BAY"]);
const MC_DOOR_ABBREVS = new Set(["ED","IE"]);
const MC_PATIO_ABBREVS = new Set(["PTD"]);
const MC_STOCK_LABELS: Record<number, string> = { 96:"8'", 120:"10'", 144:"12'", 168:"14'" };

const FRACTIONS = [
  { label: "0", value: 0 },
  { label: "1/16", value: 1/16 },
  { label: "1/8", value: 1/8 },
  { label: "3/16", value: 3/16 },
  { label: "1/4", value: 1/4 },
  { label: "5/16", value: 5/16 },
  { label: "3/8", value: 3/8 },
  { label: "7/16", value: 7/16 },
  { label: "1/2", value: 1/2 },
  { label: "9/16", value: 9/16 },
  { label: "5/8", value: 5/8 },
  { label: "11/16", value: 11/16 },
  { label: "3/4", value: 3/4 },
  { label: "13/16", value: 13/16 },
  { label: "7/8", value: 7/8 },
  { label: "15/16", value: 15/16 },
];

const MC_DEFAULT_STAINS = [
  "SW-1","SW-2","SW-3","SW-4","SW-5","SW-6","SW-7","SW-8","SW-9","SW-10",
  "SW-11","SW-12","SW-13","SW-14","SW-15","SW-16","SW-17","SW-18","SW-19","SW-20",
  "SW-21","SW-22","SW-23","SW-24","SW-25","SW-26","SW-27","SW-28","SW-29","SW-30",
  "SW-31","SW-32","SW-33","SW-34","SW-35","SW-36","SW-37","SW-38","SW-39","SW-40",
  "SW-41","SW-42","SW-43","SW-44","SW-45","SW-46","SW-47","SW-48","SW-49","SW-50",
  "SW-51","SW-52","SW-53","SW-54","SW-55","SW-56","SW-57","SW-58","SW-59","SW-60",
  "SW-61","SW-62","SW-63","SW-64","SW-65",
  "OM-6","OM-7","OM-28","56 Kona","Chestnut","Warm Chestnut","63 Black Base",
  "Minwax Cherry","Cognac","Walnut 224","Teak 120","RAW","Custom"
];
const MC_DEFAULT_PAINTS = [
  "White[RBA]","Snowmist","Dark Bronze","Canvas","Sandtone","Terratone",
  "Cocoa Bean","Forest Green","Black","Red Rock","Clear","Primed","RAW","Custom"
];

// ─── TYPES ──────────────────────────────────────────────────────────────────

export interface NwoRow {
  qty: number;
  unit: string;
  item: string;
  color: string;
  species: string;
  lengths: string;
  vendor: string;
  profileId?: string;
}

interface CatalogItem {
  id: string;
  profile: string;
  category: string;
  calcMethod: string;
  unit?: string;
  options?: { species: string; vendors: string[] }[];
  nicknames?: string[];
  sendExtra?: boolean;
  sendExtraRate?: number;
  hasSpecialInstructions?: boolean;
  specialInstructionsText?: string;
  requiresProfile?: boolean;
  requiresCAD?: boolean;
}

interface MaterialCatalog {
  items?: CatalogItem[];
  stains?: string[];
  paints?: string[];
  calcMethods?: { id: string; formula: string; multiplier?: number; stockLengths?: number[] }[];
}

// ─── FETCH CATALOG + OFFSETS FROM SUPABASE ──────────────────────────────────

let _catalogCache: { catalog: MaterialCatalog; offsets: any } | null = null;

export async function fetchCatalogAndOffsets(): Promise<{ catalog: MaterialCatalog; offsets: any }> {
  if (_catalogCache) return _catalogCache;

  const supabase = getSupabase();
  if (!supabase) return { catalog: { items: [] }, offsets: {} };

  const [catalogRes, offsetsRes, itemsRes] = await Promise.all([
    supabase.from("app_settings").select("value").eq("key", "material_catalog").maybeSingle(),
    supabase.from("app_settings").select("value").eq("key", "offsets").maybeSingle(),
    supabase.from("catalog_items").select("id, data"),
  ]);

  const catalog: MaterialCatalog = catalogRes.data?.value || { items: [] };
  const offsets = offsetsRes.data?.value || {};

  // catalog_items table holds individual items — merge into catalog.items
  if (itemsRes.data && itemsRes.data.length > 0) {
    catalog.items = itemsRes.data.map((row: any) => ({ id: row.id, ...row.data }));
  }

  _catalogCache = { catalog, offsets };
  return _catalogCache;
}

/**
 * Species + stain option lists from the shared material catalog, for the field
 * write-up trim adder. Species are the union across all catalog items' options;
 * stains fall back to the material app's default stain list when the catalog
 * doesn't override them — same source the material-list maker uses.
 */
export async function fetchTrimCatalogOptions(): Promise<{ species: string[]; stains: string[] }> {
  const { catalog } = await fetchCatalogAndOffsets();
  const sp = new Set<string>();
  for (const it of catalog.items || []) {
    for (const o of it.options || []) if (o.species) sp.add(String(o.species).trim());
  }
  const rawStains =
    Array.isArray(catalog.stains) && catalog.stains.length ? catalog.stains : MC_DEFAULT_STAINS;
  const stains = [...new Set(rawStains.map((s) => String(s).trim()).filter(Boolean))];
  const species = [...sp].filter(Boolean).sort((a, b) => a.localeCompare(b));
  return { species, stains };
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

function isUnitDoor(u: any): boolean {
  return MC_DOOR_ABBREVS.has(u.abbrev) || MC_PATIO_ABBREVS.has(u.abbrev)
    || u.unitType === "Entry Door" || u.unitType === "Patio Door";
}

function isUnitComplete(u: any): boolean {
  if (u.isMisc) return u.approved === true;
  return !!(u.heightWhole && u.widthWhole);
}

function buildAutoSummaryFromUnits(units: any[]) {
  const grouped = new Map<string, any>();
  for (const u of units) {
    if (u.isMisc) continue;
    const abbrev = u.abbrev || "";
    if (!abbrev) continue;
    const ext = u.exteriorColor || "";
    const int_ = u.interiorColor || "";
    const fin = u.intFinish || "";
    const frame = u.frame || "";
    const key = [abbrev, ext, int_, fin, frame].join("|").toLowerCase();
    if (!grouped.has(key)) {
      grouped.set(key, { qty: 1, abbrev, exterior: ext, interior: int_, interiorFinish: fin, frame, subType: u.subType || "" });
    } else {
      grouped.get(key)!.qty += 1;
    }
  }
  return Array.from(grouped.values());
}

// Apply send-extra buffer per consumable type
// Exterior caulk: always +1 extra tube
// Interior caulk: +1 when fractional > 0.5 or whole number (e.g. 2.5→3, 2.75→4, 3.0→4)
// Coil/Foam/Sill tape: +1 when fractional > 0.7 (e.g. 2.7→3, 2.8→4)
function applyConsumableBuffer(raw: number, profileId?: string): number {
  if (raw <= 0) return 0;
  if (profileId === "paint-caulk") return Math.ceil(raw) + 1;
  // Round fractional to 4 decimals to avoid floating-point noise (e.g. 2.7%1 = 0.70000000000002)
  const frac = Math.round((raw % 1) * 10000) / 10000;
  if (profileId === "silicone-caulk") {
    return (frac > 0.5 || frac === 0) ? Math.ceil(raw) + 1 : Math.ceil(raw);
  }
  // coil, foam, sill-tape
  return frac > 0.7 ? Math.ceil(raw) + 1 : Math.ceil(raw);
}

function calcConsumableQty(autoFormula: any, summaryRows: any[], profileId?: string): number {
  if (!autoFormula) return 0;
  if (autoFormula.fixed) return autoFormula.fixed;
  let AD3 = 0, AD4 = 0, AD5 = 0, AD6 = 0;
  for (const row of (summaryRows || [])) {
    const qty = Number(row.qty) || 0;
    const abbrev = row.abbrev || "";
    const frame = row.frame || "";
    if (MC_DOOR_ABBREVS.has(abbrev)) AD3 += qty;
    else if (MC_PATIO_ABBREVS.has(abbrev)) AD4 += qty;
    else if (MC_WINDOW_ABBREVS.has(abbrev)) {
      if (frame === "FF" || frame === "Full Frame") AD5 += qty;
      else AD6 += qty;
    }
  }
  const raw = (autoFormula.ED || 0) * AD3 +
    (autoFormula.PTD || 0) * AD4 +
    (autoFormula.FF || 0) * AD5 +
    (autoFormula.IF || 0) * AD6;
  return applyConsumableBuffer(raw, profileId);
}

function getExteriorColorQtys(autoFormula: any, summaryRows: any[], profileId?: string): { color: string; qty: number }[] {
  const colorMap: Record<string, number> = {};
  for (const row of (summaryRows || [])) {
    const qty = Number(row.qty) || 0;
    const abbrev = row.abbrev || "";
    const frame = row.frame || "";
    const color = row.exterior || "Unknown";
    let contrib = 0;
    if (MC_DOOR_ABBREVS.has(abbrev)) contrib = qty * (autoFormula.ED || 0);
    else if (MC_PATIO_ABBREVS.has(abbrev)) contrib = qty * (autoFormula.PTD || 0);
    else if (MC_WINDOW_ABBREVS.has(abbrev))
      contrib = qty * ((frame === "FF" || frame === "Full Frame") ? (autoFormula.FF || 0) : (autoFormula.IF || 0));
    if (contrib > 0) colorMap[color] = (colorMap[color] || 0) + contrib;
  }
  return Object.entries(colorMap)
    .map(([color, qty]) => ({ color, qty: applyConsumableBuffer(qty, profileId) }))
    .filter(r => r.qty > 0);
}

// Normalize color name variants (e.g. "Snow Mist" → "Snowmist")
const PAINT_NAME_MAP: Record<string, string> = {
  "white": "White[RBA]",
  "snow mist": "Snowmist",
  "snowmist": "Snowmist",
  "dark bronze": "Dark Bronze",
  "canvas": "Canvas",
  "sandtone": "Sandtone",
  "terratone": "Terratone",
  "cocoa bean": "Cocoa Bean",
  "forest green": "Forest Green",
  "black": "Black",
  "red rock": "Red Rock",
  "primed": "Primed",
  "raw": "RAW",
};

// Canonicalize a color name to its single spelling (e.g. "white"/"White" ->
// "White[RBA]", "Snow Mist" -> "Snowmist") so variants of the same color never
// appear as two separate entries. Mirrors canonicalColor in the material-list app.
function canonicalColor(c: string): string {
  return PAINT_NAME_MAP[(c || "").toLowerCase()] || c;
}

// Interior caulk takes color cues ONLY from interior trim. Exterior trim
// (e.g. J Channel) uses our color names but must not drive interior caulk color.
const CAULK_CUE_CATEGORIES = new Set([
  "Casing", "EJ", "Sill", "Door Stop", "Base Shoe", "Threshold",
]);
// Interior "Other"-category items that SHOULD still cue caulk color. They share
// the "Other" bucket with exterior J Channel, so they're allowed by id.
const CAULK_CUE_EXTRA_IDS = new Set([
  "item-1783015967148", // 1/4x1-3/4 Lattice
  "item-1783016312177", // 3" Lattice
  "item-1783015750562", // Parting stop 1/2x3/4
]);

// Three buckets per color: stain (or RAW / Pine-Oak units) -> Clear caulk;
// a real paint-list color -> that color; anything else typed -> a "Custom" line
// (caulk doesn't come in arbitrary custom colors). Only interior trim contributes
// a color — exterior parts like J Channel are ignored.
function detectTrimCaulkColors(globalMaterials: any[], materialCatalog: MaterialCatalog | null, units: any[], additionalMaterials: any[]): string[] {
  const stainSet = new Set(Array.isArray(materialCatalog?.stains) ? materialCatalog!.stains : MC_DEFAULT_STAINS);
  const paintSet = new Set(Array.isArray(materialCatalog?.paints) ? materialCatalog!.paints : MC_DEFAULT_PAINTS);
  const items = Array.isArray(materialCatalog?.items) ? materialCatalog!.items! : [];
  const catById = new Map(items.map(it => [it.id, it]));
  const catByProfile = new Map(items.map(it => [it.profile, it]));

  let hasStain = false;
  let hasCustom = false;
  const paintColors = new Set<string>();

  // Normalize color names so variants like "Snow Mist" / "Snowmist" merge
  const normColor = canonicalColor;

  // Unknown/freeform items (no catalog match) are included — they're manually
  // entered interior trim.
  const cuesCaulk = (catItem?: CatalogItem) => !catItem
    || CAULK_CUE_CATEGORIES.has(catItem.category)
    || CAULK_CUE_EXTRA_IDS.has(catItem.id);

  const classify = (rawColor: string) => {
    const nc = normColor(rawColor);
    if (!nc) return;
    if (nc === "Custom") { hasCustom = true; return; }
    if (stainSet.has(nc) || nc === "RAW") { hasStain = true; return; }
    if (paintSet.has(nc)) { paintColors.add(nc); return; }
    hasCustom = true; // typed color that's on neither the paint nor stain list
  };

  for (const m of (globalMaterials || []).filter(m => !m.autoFormula && m.color)) {
    if (!cuesCaulk(catById.get(m.profileId))) continue;
    classify(m.color);
  }
  for (const m of (additionalMaterials || [])) {
    if (!m.color) continue;
    if (!cuesCaulk(catByProfile.get(m.profile))) continue;
    classify(m.color);
  }
  for (const u of (units || [])) {
    if (u.isMisc) continue;
    if ((u.interiorColor || "").match(/pine|oak/i)) hasStain = true;
  }

  const out: string[] = [];
  if (hasStain) out.push("Clear");
  [...paintColors].forEach(c => out.push(c));
  if (hasCustom) out.push("Custom");
  return out.length ? out : ["White[RBA]"];
}

function resolveProfileNickname(typed: string, catalogItems: CatalogItem[] | undefined): string {
  if (!typed) return typed;
  if ((catalogItems || []).find(it => it.profile === typed)) return typed;
  const lower = typed.toLowerCase().trim();
  const match = (catalogItems || []).find(it => (it.nicknames || []).some(n => n.toLowerCase().trim() === lower));
  return match ? match.profile : typed;
}

// Get display name for a catalog item — appends special instructions in parentheses if set
export function getDisplayName(catItem: CatalogItem | null | undefined): string {
  if (!catItem) return "";
  const base = catItem.profile || "";
  if (catItem.hasSpecialInstructions && catItem.specialInstructionsText) {
    return `${base} (${catItem.specialInstructionsText})`;
  }
  return base;
}

// Look up a catalog item by profile name and return its display name
export function getDisplayNameByProfile(profile: string, catalogItems: CatalogItem[] | undefined): string {
  if (!profile || !catalogItems) return profile || "";
  const catItem = catalogItems.find(it => it.profile === profile);
  return catItem ? getDisplayName(catItem) : profile;
}

// ─── MULL CUTS ──────────────────────────────────────────────────────────────

const MULL_GAP = 0.75;

function computeMullCuts(layout: any[], unitsByLabel: Record<string, { W: number; H: number }>, buf: number, isEJ: boolean, deepEJ: boolean, isDoor: boolean) {
  if (!layout || !layout.length) return null;

  const positioned = layout.map((t: any) => {
    const u = unitsByLabel[t.label];
    if (!u) return null;
    return { ...t, W: u.W, H: u.H };
  }).filter(Boolean) as any[];
  if (!positioned.length) return null;

  const groupLabel = layout.map((t: any) => t.label).sort().join("+");
  const cuts: any[] = [];

  const uniqueY = [...new Set(positioned.map((p: any) => p.gridY))];
  const uniqueX = [...new Set(positioned.map((p: any) => p.gridX))];

  if (uniqueY.length === 1) {
    const sorted = [...positioned].sort((a, b) => a.gridX - b.gridX);
    const mullJoints = sorted.length - 1;
    const totalW = sorted.reduce((s: number, u: any) => s + u.W, 0) + MULL_GAP * mullJoints;
    const leftH = sorted[0].H;
    const rightH = sorted[sorted.length - 1].H;

    cuts.push({ length: leftH + buf, rawLength: leftH, source: groupLabel, cutName: `Left side (${sorted[0].label})` });
    cuts.push({ length: rightH + buf, rawLength: rightH, source: groupLabel, cutName: `Right side (${sorted[sorted.length - 1].label})` });
    cuts.push({ length: totalW + buf, rawLength: totalW, source: groupLabel, cutName: `Top (${sorted.map((u: any) => u.label).join("+")})` });
    if (!isDoor) {
      cuts.push({ length: totalW + buf, rawLength: totalW, source: groupLabel, cutName: `Bottom (${sorted.map((u: any) => u.label).join("+")})` });
    }
  } else if (uniqueX.length === 1) {
    const sorted = [...positioned].sort((a, b) => a.gridY - b.gridY);
    const mullJoints = sorted.length - 1;
    const totalH = sorted.reduce((s: number, u: any) => s + u.H, 0) + MULL_GAP * mullJoints;
    const topW = sorted[0].W;
    const bottomW = sorted[sorted.length - 1].W;

    cuts.push({ length: topW + buf, rawLength: topW, source: groupLabel, cutName: `Top (${sorted[0].label})` });
    if (!isDoor) {
      cuts.push({ length: bottomW + buf, rawLength: bottomW, source: groupLabel, cutName: `Bottom (${sorted[sorted.length - 1].label})` });
    }
    cuts.push({ length: totalH + buf, rawLength: totalH, source: groupLabel, cutName: `Left side (${sorted.map((u: any) => u.label).join("+")})` });
    cuts.push({ length: totalH + buf, rawLength: totalH, source: groupLabel, cutName: `Right side (${sorted.map((u: any) => u.label).join("+")})` });
  } else {
    // COMPLEX SHAPE (L, T, etc.) — find exposed edges, then merge collinear adjacent ones
    const near = (a: number, b: number) => Math.abs(a - b) < 1;
    const leftEdges: any[] = [], rightEdges: any[] = [], topEdges: any[] = [], bottomEdges: any[] = [];
    positioned.forEach((p: any) => {
      const hasLeft = positioned.some((q: any) => q.label !== p.label &&
        near(q.gridX + q.W, p.gridX) &&
        Math.max(q.gridY, p.gridY) < Math.min(q.gridY + q.H, p.gridY + p.H));
      const hasRight = positioned.some((q: any) => q.label !== p.label &&
        near(p.gridX + p.W, q.gridX) &&
        Math.max(q.gridY, p.gridY) < Math.min(q.gridY + q.H, p.gridY + p.H));
      const hasAbove = positioned.some((q: any) => q.label !== p.label &&
        near(q.gridY + q.H, p.gridY) &&
        Math.max(q.gridX, p.gridX) < Math.min(q.gridX + q.W, p.gridX + p.W));
      const hasBelow = positioned.some((q: any) => q.label !== p.label &&
        near(p.gridY + p.H, q.gridY) &&
        Math.max(q.gridX, p.gridX) < Math.min(q.gridX + q.W, p.gridX + p.W));
      if (!hasLeft)  leftEdges.push({ pos: p.gridX, start: p.gridY, len: p.H, label: p.label });
      if (!hasRight) rightEdges.push({ pos: p.gridX + p.W, start: p.gridY, len: p.H, label: p.label });
      if (!hasAbove) topEdges.push({ pos: p.gridY, start: p.gridX, len: p.W, label: p.label });
      if (!hasBelow) bottomEdges.push({ pos: p.gridY + p.H, start: p.gridX, len: p.W, label: p.label });
    });
    const mergeEdges = (edges: any[]) => {
      const groups: any[][] = [];
      for (const e of edges) {
        const g = groups.find(gr => near(gr[0].pos, e.pos));
        if (g) g.push(e); else groups.push([e]);
      }
      const merged: any[] = [];
      for (const g of groups) {
        g.sort((a: any, b: any) => a.start - b.start);
        let cur = { len: g[0].len, labels: [g[0].label], start: g[0].start };
        for (let i = 1; i < g.length; i++) {
          if (near(cur.start + cur.len, g[i].start)) {
            cur.len += g[i].len + MULL_GAP;
            cur.labels.push(g[i].label);
          } else {
            merged.push(cur);
            cur = { len: g[i].len, labels: [g[i].label], start: g[i].start };
          }
        }
        merged.push(cur);
      }
      return merged;
    };
    mergeEdges(leftEdges).forEach(e =>
      cuts.push({ length: e.len + buf, rawLength: e.len, source: groupLabel, cutName: `Left side (${e.labels.join("+")})` }));
    mergeEdges(rightEdges).forEach(e =>
      cuts.push({ length: e.len + buf, rawLength: e.len, source: groupLabel, cutName: `Right side (${e.labels.join("+")})` }));
    mergeEdges(topEdges).forEach(e =>
      cuts.push({ length: e.len + buf, rawLength: e.len, source: groupLabel, cutName: `Top (${e.labels.join("+")})` }));
    if (!isDoor) mergeEdges(bottomEdges).forEach(e =>
      cuts.push({ length: e.len + buf, rawLength: e.len, source: groupLabel, cutName: `Bottom (${e.labels.join("+")})` }));
  }

  return cuts;
}

function computeMullLatticeCuts(layout: any[], unitsByLabel: Record<string, { W: number; H: number }>, buf: number) {
  if (!layout || !layout.length) return null;
  const positioned = layout.map((t: any) => {
    const u = unitsByLabel[t.label];
    if (!u) return null;
    return { ...t, W: u.W, H: u.H };
  }).filter(Boolean) as any[];
  if (positioned.length < 2) return null;
  const near = (a: number, b: number) => Math.abs(a - b) < 1;
  const groupLabel = layout.map((t: any) => t.label).sort().join("+");
  const cuts: any[] = [];
  for (let i = 0; i < positioned.length; i++) {
    for (let j = i + 1; j < positioned.length; j++) {
      const a = positioned[i], b = positioned[j];
      if (near(a.gridX + a.W, b.gridX) || near(b.gridX + b.W, a.gridX)) {
        const overlapV = Math.min(a.gridY + a.H, b.gridY + b.H) - Math.max(a.gridY, b.gridY);
        if (overlapV > 0) {
          cuts.push({ length: overlapV + buf, rawLength: overlapV, source: groupLabel, cutName: `Mull lattice (${a.label}|${b.label})` });
        }
      }
      if (near(a.gridY + a.H, b.gridY) || near(b.gridY + b.H, a.gridY)) {
        const overlapH = Math.min(a.gridX + a.W, b.gridX + b.W) - Math.max(a.gridX, b.gridX);
        if (overlapH > 0) {
          cuts.push({ length: overlapH + buf, rawLength: overlapH, source: groupLabel, cutName: `Mull lattice (${a.label}|${b.label})` });
        }
      }
    }
  }
  return cuts.length ? cuts : null;
}

// ─── BOARD PACKING (buildGlobalMaterialBoards) ──────────────────────────────

function buildGlobalMaterialBoards(globalMaterials: any[], units: any[], materialCatalog: MaterialCatalog | null, boardWaste: number, mullLayouts: any, options?: { doors3pc?: boolean; summaryOverrides?: any }) {
  const doors3pc = options?.doors3pc ?? false;
  const buf = boardWaste ?? 5;
  const MIN_BOARD_REMAINING = 8;
  const DEFAULT_STOCK = [96, 120, 144, 168];
  const allBoards: any[] = [];
  const customCalcMethods = materialCatalog?.calcMethods || [];

  // ── Section 4 per-unit board overrides (mirrors cut-list-pro/lib/boardCalc.js) ──
  // Re-designate a unit+material's board set from the Section 4 Material Summary
  // (stored as per-length deltas, e.g. { "8'": -2, "10'": +2 }) so the tally,
  // boards-by-unit, and cut list all agree. Applied in the override pass below.
  const summaryOverrides = options?.summaryOverrides || {};
  const hasOverrides = Object.keys(summaryOverrides).length > 0;
  const SL_INCH_TO_LABEL: Record<number, string> = { 96: "8'", 120: "10'", 144: "12'", 168: "14'", 192: "16'", 216: "18'", 240: "20'" };
  const SL_LABEL_TO_INCH: Record<string, number> = Object.fromEntries(Object.entries(SL_INCH_TO_LABEL).map(([i, l]) => [l, Number(i)]));
  const inchToLabel = (inch: number) => SL_INCH_TO_LABEL[inch] || (Math.round(Number(inch) / 12) + "'");
  const _mullCount: Record<string, number> = {};
  (units || []).forEach((u: any) => {
    const mm = String(u.label || "").trim().match(/^(\d+)\s*([a-zA-Z]+)$/);
    if (mm) _mullCount[mm[1]] = (_mullCount[mm[1]] || 0) + 1;
  });
  const labelToMullBase: Record<string, string> = {};
  (units || []).forEach((u: any) => {
    const raw = String(u.label || "").trim();
    const mm = raw.match(/^(\d+)\s*([a-zA-Z]+)$/);
    if (mm && _mullCount[mm[1]] >= 2) labelToMullBase[raw] = mm[1];
  });
  const overrideUnitKey = (source: any) => {
    const label = String(source || "").replace(/\s*\(.*\)\s*$/, "");
    if (!label) return "";
    const first = label.split("+")[0];
    if (labelToMullBase[first]) return `mull-${labelToMullBase[first]}`;
    return label;
  };

  const isWphMethod = (method: string) => {
    if (method === "wph" || method === "1w") return true;
    const custom = customCalcMethods.find(m => m.id === method);
    return custom && (custom.formula === "WH" || custom.formula === "W" || custom.formula === "H" || custom.formula === "2W" || custom.formula === "2H" || custom.formula === "P");
  };

  const getStock = (method: string) => {
    if (method === "wph" || method === "1w") return DEFAULT_STOCK;
    const custom = customCalcMethods.find(m => m.id === method);
    if (custom && custom.stockLengths && custom.stockLengths.length) return [...custom.stockLengths].sort((a, b) => a - b);
    return DEFAULT_STOCK;
  };

  const getCuts = (method: string, H: number, W: number, sillW: number, stoolW: number, isEJ: boolean, deepEJ: boolean, src: string, isDoor: boolean, topBottomOnly?: boolean) => {
    if (method === "1w") return [{ length: W + buf, rawLength: W, source: src, cutName: "1 pc @ width" }];
    if (method === "wph" || method === "WH") {
      if (isEJ) {
        return [
          { length: H + buf, rawLength: H, source: src, cutName: "EJ Left" },
          { length: H + buf, rawLength: H, source: src, cutName: "EJ Right" },
          { length: W + buf, rawLength: W, source: src, cutName: "EJ Head" },
          { length: sillW + buf, rawLength: sillW, source: src, cutName: `EJ Sill${sillW !== W ? " (override)" : ""}` },
        ];
      }
      if (topBottomOnly) {
        if (isDoor) return [{ length: W + buf, rawLength: W, source: src, cutName: "Top" }];
        return [
          { length: stoolW + buf, rawLength: stoolW, source: src, cutName: `Top${stoolW !== W ? " (override)" : ""}` },
          { length: stoolW + buf, rawLength: stoolW, source: src, cutName: `Bottom${stoolW !== W ? " (override)" : ""}` },
        ];
      }
      if (isDoor) return [
        { length: H + buf, rawLength: H, source: src, cutName: "Left" },
        { length: H + buf, rawLength: H, source: src, cutName: "Right" },
        { length: W + buf, rawLength: W, source: src, cutName: "Top" },
      ];
      return [
        { length: H + buf, rawLength: H, source: src, cutName: "Left" },
        { length: H + buf, rawLength: H, source: src, cutName: "Right" },
        { length: stoolW + buf, rawLength: stoolW, source: src, cutName: `Top${stoolW !== W ? " (override)" : ""}` },
        { length: stoolW + buf, rawLength: stoolW, source: src, cutName: `Bottom${stoolW !== W ? " (override)" : ""}` },
      ];
    }
    const custom = customCalcMethods.find(m => m.id === method);
    const mult = custom?.multiplier || 1;
    if (!custom) return [];
    if (custom.formula === "W") return [{ length: W * mult + buf, rawLength: W * mult, source: src, cutName: "Width cut" }];
    if (custom.formula === "H") return [{ length: H * mult + buf, rawLength: H * mult, source: src, cutName: "Height cut" }];
    if (custom.formula === "2W") return [
      { length: W + buf, rawLength: W, source: src, cutName: "Top" },
      { length: W + buf, rawLength: W, source: src, cutName: "Bottom" },
    ];
    if (custom.formula === "2H") return [
      { length: H + buf, rawLength: H, source: src, cutName: "Left" },
      { length: H + buf, rawLength: H, source: src, cutName: "Right" },
    ];
    if (custom.formula === "P") return [
      { length: W + buf, rawLength: W, source: src, cutName: "Top" },
      { length: W + buf, rawLength: W, source: src, cutName: "Bottom" },
      { length: H + buf, rawLength: H, source: src, cutName: "Left" },
      { length: H + buf, rawLength: H, source: src, cutName: "Right" },
    ];
    return [];
  };

  const trimMats = (globalMaterials || []).filter(m => !m.autoFormula && m.profileId);
  for (const mat of trimMats) {
    const catItem = (materialCatalog?.items || []).find(it => it.id === mat.profileId);
    if (!catItem || !isWphMethod(catItem.calcMethod)) continue;
    const STOCK = getStock(catItem.calcMethod);

    const cuts: any[] = [];
    const mullHandled = new Set<string>();
    const mullGroupsByLabel: Record<string, string> = {};
    if (mullLayouts) {
      Object.entries(mullLayouts).forEach(([gk, layout]: [string, any]) => {
        if (!layout || !layout.length) return;
        layout.forEach((t: any) => { mullGroupsByLabel[t.label] = gk; mullHandled.add(t.label); });
      });
    }
    const mullGroupsProcessed = new Set<string>();

    for (const u of units) {
      if (u.isMisc || !isUnitComplete(u)) continue;
      const H = (u.heightWhole || 0) + (u.heightFrac || 0);
      const W = (u.widthWhole || 0) + (u.widthFrac || 0);
      if (!H || !W) continue;
      const unitLabel = String(u.label || u.id);
      const excl = mat.excludeUnits || [];
      const incl = mat.includeUnits || [];
      if (excl.length && excl.includes(unitLabel)) continue;
      if (incl.length && !incl.includes(unitLabel)) continue;
      const isEJ = catItem.category === "EJ";
      const isCasing = catItem.category === "Casing";
      const isLattice = catItem.profile === '1/4x1-3/4 Lattice';
      const deepEJ = (u.materialOverrides?.[mat.id]?.deepEJ) ?? mat.deepEJ;
      const topBottomOnly = (u.materialOverrides?.[mat.id]?.topBottomOnly) ?? mat.topBottomOnly;
      const isDoor = isUnitDoor(u);

      const mullGk = mullGroupsByLabel[unitLabel];
      if (mullGk && (isCasing || isEJ || isLattice)) {
        if (mullGroupsProcessed.has(mullGk)) continue;
        mullGroupsProcessed.add(mullGk);
        const layout = mullLayouts[mullGk];
        const unitsByLabel: Record<string, { W: number; H: number }> = {};
        // If any unit in the group is a door, skip bottom cut for the whole group
        let groupHasDoor = false;
        units.forEach((gu: any) => {
          const gl = String(gu.label || gu.id);
          if (mullHandled.has(gl)) {
            unitsByLabel[gl] = { W: (gu.widthWhole || 0) + (gu.widthFrac || 0), H: (gu.heightWhole || 0) + (gu.heightFrac || 0) };
            if (isUnitDoor(gu)) groupHasDoor = true;
          }
        });
        if (isLattice) {
          const latticeCuts = computeMullLatticeCuts(layout, unitsByLabel, buf);
          if (latticeCuts && latticeCuts.length) cuts.push(...latticeCuts);
        } else {
          const mullCuts = computeMullCuts(layout, unitsByLabel, buf, isEJ, deepEJ, groupHasDoor);
          if (mullCuts && mullCuts.length) {
            if (isEJ && !deepEJ) mullCuts.forEach((c: any) => { c._nonDeepEJ = true; });
            cuts.push(...mullCuts);
          }
        }
        continue;
      }

      const src = unitLabel + (u.location ? ` (${u.location})` : "");
      const sillW = (u.sillOverrideWhole || 0) + (u.sillOverrideFrac || 0) || W;
      const stoolW = (u.stoolOverrideWhole || 0) + (u.stoolOverrideFrac || 0) || W;
      const newCuts = getCuts(catItem.calcMethod, H, W, sillW, stoolW, isEJ, deepEJ, src, isDoor, topBottomOnly);
      if (isEJ && !deepEJ) newCuts.forEach((c: any) => { c._nonDeepEJ = true; });
      if (doors3pc && isDoor) newCuts.forEach((c: any) => { c._doors3pc = true; });
      cuts.push(...newCuts);
    }
    if (!cuts.length) continue;

    // ── Splice pass: cuts exceeding the longest available stock ──────────
    // When a cut won't fit on any single board, split it into N pieces of
    // the next size down. Each piece gets its own waste buffer since it's a
    // separate physical board. E.g. a 170" cut (175" with buffer) that
    // exceeds 14' (168") becomes 2 pieces @ ~85" each → 2×8' boards.
    const maxStock = STOCK[STOCK.length - 1];
    for (let i = cuts.length - 1; i >= 0; i--) {
      if (cuts[i].length > maxStock) {
        const cut = cuts.splice(i, 1)[0];
        const n = Math.ceil(cut.rawLength / (maxStock - buf));
        let remainingRaw = cut.rawLength;
        for (let j = 0; j < n; j++) {
          const segmentsLeft = n - j;
          const segRaw = remainingRaw / segmentsLeft;
          remainingRaw -= segRaw;
          cuts.push({
            ...cut,
            rawLength: segRaw,
            length: segRaw + buf,
            cutName: `${cut.cutName} (splice ${j + 1}/${n})`,
            _spliced: true,
          });
        }
      }
    }

    // Pack per-unit: group cuts by source so each board belongs to one unit
    const bySource: Record<string, any[]> = {};
    for (const cut of cuts) {
      if (!bySource[cut.source]) bySource[cut.source] = [];
      bySource[cut.source].push(cut);
    }
    const packed: any[] = [];
    for (const group of Object.values(bySource)) {
      group.sort((a, b) => b.length - a.length);
      for (const cut of group) {
        // When adding to an existing board, use raw length — the board's first cut
        // already reserved the waste buffer for the bad end.
        const fitLen = cut.rawLength || (cut.length - buf);
        const minRem = cut._nonDeepEJ ? 0 : MIN_BOARD_REMAINING;
        const board = !cut._doors3pc && packed.find(b => b.cuts.length && b.cuts[0].source === cut.source && b.remaining - fitLen >= minRem);
        if (board) {
          board.cuts.push(cut);
          board.remaining -= fitLen;
        } else {
          const stockLen = STOCK.find(s => s >= cut.length) || 168;
          packed.push({ stockLength: stockLen, profile: mat.profile || catItem.profile, species: mat.species || "", color: mat.color || "", vendor: mat.vendor || "", category: catItem.category || "Casing", cuts: [cut], remaining: stockLen - cut.length });
        }
      }
    }
    // Merge orphan single-cut boards (same source only, may upsize)
    for (let i = packed.length - 1; i >= 1; i--) {
      if (packed[i].cuts.length !== 1) continue;
      if (packed[i].cuts[0]._doors3pc) continue;
      if (packed[i].cuts[0]._nonDeepEJ) continue;
      if (packed[i].cuts[0]._spliced) continue;
      const iSource = packed[i].cuts[0].source;
      for (let j = 0; j < i; j++) {
        if (!packed[j].cuts.some((c: any) => c.source === iSource)) continue;
        const usedJ = packed[j].stockLength - packed[j].remaining;
        // Use raw length for the absorbed cut — target board already has a waste buffer
        const iCut = packed[i].cuts[0];
        const usedI = iCut.rawLength || (iCut.length - buf);
        const mergeStock = STOCK.find(s => s - usedJ - usedI >= MIN_BOARD_REMAINING);
        if (mergeStock) {
          packed[j].stockLength = mergeStock;
          packed[j].remaining = mergeStock - usedJ - usedI;
          packed[j].cuts.push(...packed[i].cuts);
          packed.splice(i, 1);
          break;
        }
      }
    }
    // Bump boards with too little remaining
    for (let i = packed.length - 1; i >= 0; i--) {
      const board = packed[i];
      if (board.cuts.some((c: any) => c._nonDeepEJ || c._spliced)) continue;
      if (board.remaining > 0 && board.remaining < MIN_BOARD_REMAINING) {
        const nextStock = STOCK.find(s => s > board.stockLength);
        if (nextStock) {
          board.remaining += nextStock - board.stockLength;
          board.stockLength = nextStock;
        } else if (board.cuts.length > 1) {
          const toMove = board.cuts.pop();
          board.remaining += toMove.length;
          const usedBoard = board.stockLength - board.remaining;
          const downStock = STOCK.find(s => s - usedBoard >= MIN_BOARD_REMAINING) || board.stockLength;
          board.remaining = downStock - usedBoard;
          board.stockLength = downStock;
          const newStock = STOCK.find(s => s - toMove.length >= MIN_BOARD_REMAINING) || STOCK[0];
          packed.push({ stockLength: newStock, profile: board.profile, species: board.species, color: board.color, vendor: board.vendor, category: board.category, cuts: [toMove], remaining: newStock - toMove.length });
        }
      }
    }

    // Send-extra logic
    if (catItem.sendExtra) {
      const excl = mat.excludeUnits || [];
      const incl = mat.includeUnits || [];
      const appliedUnitCount = units.filter((u: any) => {
        if (u.isMisc) return false;
        const lbl = String(u.label || u.id);
        if (excl.length && excl.includes(lbl)) return false;
        if (incl.length && !incl.includes(lbl)) return false;
        return true;
      }).length;
      if (appliedUnitCount > 0) {
        const rate = catItem.sendExtraRate || 10;
        const sendExtraQty = Math.max(1, Math.round(appliedUnitCount / rate));
        if (Object.keys(packed[0]?.stockLength ? { [packed[0].stockLength]: 1 } : {}).length) {
          const longestStock = Math.max(...packed.map(b => b.stockLength));
          const targetBoard = packed.find(b => b.stockLength === longestStock) || packed[packed.length - 1];
          if (targetBoard) {
            for (let i = 0; i < sendExtraQty; i++) {
              packed.push({ stockLength: longestStock, profile: mat.profile || catItem.profile, species: mat.species || "", color: mat.color || "", vendor: mat.vendor || "", category: catItem.category, cuts: [], remaining: longestStock });
            }
          }
        }
      }
    }

    // Non-deep EJ rip: merge pairs of boards (ripping gives 2 halves per board)
    const ejRipBoards = packed.filter((b: any) => b.cuts.some((c: any) => c._nonDeepEJ));
    if (ejRipBoards.length > 0) {
      const otherBoards = packed.filter((b: any) => !b.cuts.some((c: any) => c._nonDeepEJ));
      const byKey: Record<string, any[]> = {};
      ejRipBoards.forEach((b: any) => {
        const src = b.cuts[0]?.source || '';
        const key = src + '|' + b.stockLength;
        if (!byKey[key]) byKey[key] = [];
        byKey[key].push(b);
      });
      Object.values(byKey).forEach(group => {
        for (let i = 0; i < group.length; i += 2) {
          const a = group[i];
          const b = group[i + 1];
          if (b) {
            a.cuts.push(...b.cuts);
            a.remaining = Math.min(a.remaining, b.remaining);
          }
          a._ejRip = true;
          otherBoards.push(a);
        }
      });
      packed.length = 0;
      packed.push(...otherBoards);
    }

    // ── Section 4 override pass ──────────────────────────────────────────
    if (hasOverrides && packed.length) {
      const profileName = mat.profile || catItem.profile;
      const matColor = mat.color || "";
      const matSpecies = mat.species || "";
      const groups = new Map<string, any[]>();
      packed.forEach((b: any) => {
        const k = overrideUnitKey(b.cuts[0]?.source);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(b);
      });
      const replacements: any[] = [];
      let mutated = false;
      groups.forEach((boards, unitKey) => {
        const ovKey = `unit|${unitKey}|${profileName}|${matColor}|${matSpecies}`;
        const delta = summaryOverrides[ovKey];
        if (!delta || typeof delta !== "object") { replacements.push(...boards); return; }
        const target: Record<string, number> = {};
        boards.forEach((b: any) => { const lab = inchToLabel(b.stockLength); target[lab] = (target[lab] || 0) + 1; });
        Object.entries(delta).forEach(([lab, d]) => { target[lab] = Math.max(0, (target[lab] || 0) + (Number(d) || 0)); });
        const targetInches: number[] = [];
        Object.entries(target).forEach(([lab, n]) => {
          const inch = SL_LABEL_TO_INCH[lab];
          if (inch && n > 0) for (let i = 0; i < n; i++) targetInches.push(inch);
        });
        targetInches.sort((a, b) => a - b);
        const unitCuts = boards.flatMap((b: any) => b.cuts);
        const template = boards[0];
        const _srcCounts: Record<string, number> = {};
        unitCuts.forEach((c: any) => { if (c.source) _srcCounts[c.source] = (_srcCounts[c.source] || 0) + 1; });
        const repSource = Object.entries(_srcCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
          || boards[0]?.cuts[0]?.source || "";
        if (!targetInches.length) {
          if (unitCuts.length) { boards.forEach((b: any) => { b._overrideUnfit = true; }); replacements.push(...boards); mutated = true; }
          return;
        }
        const bins = targetInches.map((len: number) => ({
          stockLength: len, profile: template.profile, species: template.species,
          color: template.color, vendor: template.vendor, category: template.category,
          cuts: [] as any[], remaining: len, _overrideDesignated: true, source: repSource,
        }));
        let unfit = false;
        [...unitCuts].sort((a: any, b: any) => b.length - a.length).forEach((cut: any) => {
          const bin = bins.find((bn: any) => (bn.remaining - (bn.cuts.length ? (cut.rawLength || (cut.length - buf)) : cut.length)) >= 0);
          if (bin) { bin.remaining -= bin.cuts.length ? (cut.rawLength || (cut.length - buf)) : cut.length; bin.cuts.push(cut); }
          else { unfit = true; bins[bins.length - 1].cuts.push(cut); }
        });
        if (unfit) bins.forEach((bn: any) => { (bn as any)._overrideUnfit = true; });
        replacements.push(...bins);
        mutated = true;
      });
      if (mutated) { packed.length = 0; packed.push(...replacements); }
    }

    allBoards.push(...packed);
  }

  return { boards: allBoards };
}

// ─── buildNWOMaterialList (trim rows from board packing) ────────────────────

function buildNWOMaterialList(globalMaterials: any[], units: any[], materialCatalog: MaterialCatalog | null, boardWaste: number, mullLayouts: any, options?: { doors3pc?: boolean; summaryOverrides?: any }) {
  if (!globalMaterials || !globalMaterials.length) return [];
  const { boards } = buildGlobalMaterialBoards(globalMaterials, units, materialCatalog, boardWaste, mullLayouts, options);

  const byMat = new Map<string, any>();
  for (const b of boards) {
    const key = [b.profile, b.species, b.color].join("|");
    if (!byMat.has(key)) byMat.set(key, { profile: b.profile, species: b.species, color: b.color, vendor: b.vendor, category: b.category, stockTotals: {} as Record<number, number> });
    const entry = byMat.get(key)!;
    entry.stockTotals[b.stockLength] = (entry.stockTotals[b.stockLength] || 0) + 1;
  }

  // Exact and w+casing materials
  for (const mat of (globalMaterials || [])) {
    if (!mat.profileId) continue;
    const catItem = (materialCatalog?.items || []).find(it => it.id === mat.profileId);
    if (!catItem) continue;
    if (catItem.calcMethod === "count") continue;
    if (catItem.calcMethod === "exact") {
      const unitLengthMap = mat.unitLengths || {};
      for (const u of units) {
        if (u.isMisc) continue;
        const lbl = String(u.label || u.id);
        const excl = mat.excludeUnits || [];
        const incl = mat.includeUnits || [];
        if (excl.length && excl.includes(lbl)) continue;
        if (incl.length && !incl.includes(lbl)) continue;
        const manualEntry = unitLengthMap[lbl];
        let sillW;
        if (manualEntry && (manualEntry.whole !== "" && manualEntry.whole !== undefined)) {
          sillW = (Number(manualEntry.whole) || 0) + (Number(manualEntry.frac) || 0);
        } else {
          sillW = (u.sillOverrideWhole || 0) + (u.sillOverrideFrac || 0) || (u.widthWhole || 0) + (u.widthFrac || 0);
        }
        if (!sillW) continue;
        const key = [mat.profile || catItem.profile, mat.species || "", mat.color || "", "exact"].join("|");
        if (!byMat.has(key)) byMat.set(key, { profile: mat.profile || catItem.profile, species: mat.species || "", color: mat.color || "", vendor: mat.vendor || "", category: catItem.category, stockTotals: {}, exactLengths: [] });
        byMat.get(key)!.exactLengths = [...(byMat.get(key)!.exactLengths || []), sillW];
      }
    }
    if (catItem.calcMethod === "archWidth") {
      for (const u of units) {
        if (u.isMisc) continue;
        const lbl = String(u.label || u.id);
        const excl = mat.excludeUnits || [];
        const incl = mat.includeUnits || [];
        if (excl.length && excl.includes(lbl)) continue;
        if (incl.length && !incl.includes(lbl)) continue;
        const unitW = (u.widthWhole || 0) + (u.widthFrac || 0);
        if (!unitW) continue;
        const key = [mat.profile || catItem.profile, mat.species || "", mat.color || "", "archWidth"].join("|");
        if (!byMat.has(key)) byMat.set(key, { profile: mat.profile || catItem.profile, species: mat.species || "", color: mat.color || "", vendor: mat.vendor || "", category: catItem.category, stockTotals: {}, exactLengths: [] });
        byMat.get(key)!.exactLengths = [...(byMat.get(key)!.exactLengths || []), unitW];
      }
    }
    if (catItem.calcMethod === "w+casing") {
      const casingOffset = (Number(mat.casingOffsetWhole) || 0) + (Number(mat.casingOffsetFrac) || 0);
      const casingOverrides = mat.casingUnitOverrides || {};
      for (const u of units) {
        if (u.isMisc) continue;
        const lbl = String(u.label || u.id);
        const excl = mat.excludeUnits || [];
        const incl = mat.includeUnits || [];
        if (excl.length && excl.includes(lbl)) continue;
        if (incl.length && !incl.includes(lbl)) continue;
        let cutLen;
        if (lbl in casingOverrides) {
          const ov = casingOverrides[lbl];
          cutLen = (Number(ov.whole) || 0) + (Number(ov.frac) || 0);
        } else {
          const unitW = (u.widthWhole || 0) + (u.widthFrac || 0);
          if (!unitW) continue;
          cutLen = unitW + casingOffset * 2;
        }
        if (!cutLen) continue;
        const key = [mat.profile || catItem.profile, mat.species || "", mat.color || "", "w+casing"].join("|");
        if (!byMat.has(key)) byMat.set(key, { profile: mat.profile || catItem.profile, species: mat.species || "", color: mat.color || "", vendor: mat.vendor || "", category: catItem.category, stockTotals: {}, exactLengths: [] });
        byMat.get(key)!.exactLengths = [...(byMat.get(key)!.exactLengths || []), cutLen];
      }
    }
  }

  return Array.from(byMat.values()).map(m => {
    let lengths = "—";
    if (m.exactLengths && m.exactLengths.length) {
      const fmtLen = (l: number) => {
        const whole = Math.floor(l);
        const fracVal = Math.round((l - whole) * 16) / 16;
        const fracLabel = FRACTIONS.find(f => Math.abs(f.value - fracVal) < 0.001);
        const fracStr = fracVal > 0 ? `-${fracLabel ? fracLabel.label : Math.round(fracVal * 16) + "/16"}` : "";
        return `${whole}${fracStr}"`;
      };
      const counts: Record<number, { l: number; n: number }> = {};
      m.exactLengths.forEach((l: number) => { const k = Math.round(l * 16); counts[k] = counts[k] || { l, n: 0 }; counts[k].n++; });
      lengths = Object.values(counts)
        .sort((a, b) => a.l - b.l)
        .map(({ l, n }) => `${n}@${fmtLen(l)}`)
        .join("  ");
    } else if (Object.keys(m.stockTotals).length) {
      lengths = Object.entries(m.stockTotals)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([in_, n]) => `${n}@${MC_STOCK_LABELS[Number(in_)] || Math.round(Number(in_) / 12) + "'"}`)
        .join(" ");
    }
    const qty = m.exactLengths ? m.exactLengths.length : Object.values(m.stockTotals as Record<number, number>).reduce((a, b) => a + b, 0);
    const catItem = (materialCatalog?.items || []).find(it => it.profile === m.profile);
    const displayItem = catItem ? getDisplayName(catItem) : m.profile;
    return { qty, unit: catItem?.unit || "PCS", item: displayItem, color: m.color, species: m.species, lengths, vendor: m.vendor, profileId: catItem?.id };
  });
}

// ─── MAIN ENTRY: buildNwoRows ───────────────────────────────────────────────

export function buildNwoRows(job: any, units: any[], materialCatalog: MaterialCatalog | null, offsets: any): NwoRow[] {
  const gmItems = job.globalMaterials || [];
  const _allRows = [...buildAutoSummaryFromUnits(units), ...(job.unitSummaryRows || [])];
  const vendorAssignments = job.vendorAssignments || {};

  // 1. Consumable rows
  const consumableRows: NwoRow[] = [];
  for (const mat of gmItems.filter((m: any) => m.autoFormula)) {
    const baseQty = mat.qtyOverride != null ? mat.qtyOverride : calcConsumableQty(mat.autoFormula, _allRows, mat.profileId);
    if (mat.customOverride) {
      if (baseQty > 0) consumableRows.push({ qty: baseQty, unit: mat.unit || "PCS", item: mat.profile, color: (mat.colorOverride != null ? mat.colorOverride : mat.color) || "—", species: "—", lengths: "—", vendor: mat.vendor || "WAREHOUSE" });
    } else if (mat.profileId === "coil" || mat.profileId === "paint-caulk") {
      const colorQtys = getExteriorColorQtys(mat.autoFormula, _allRows, mat.profileId);
      if (colorQtys.length > 0) {
        for (const { color, qty } of colorQtys) {
          if (qty > 0) consumableRows.push({ qty, unit: mat.unit || "PCS", item: mat.profile, color, species: "—", lengths: "—", vendor: mat.vendor || "WAREHOUSE" });
        }
      } else if (baseQty > 0) {
        consumableRows.push({ qty: baseQty, unit: mat.unit || "PCS", item: mat.profile, color: mat.color || "—", species: "—", lengths: "—", vendor: mat.vendor || "WAREHOUSE" });
      }
    } else if (mat.profileId === "silicone-caulk") {
      const caulkColors = detectTrimCaulkColors(gmItems, materialCatalog, units, job.additionalMaterials);
      for (const color of caulkColors) {
        if (baseQty > 0) consumableRows.push({ qty: baseQty, unit: mat.unit || "Tubes", item: mat.profile, color, species: "—", lengths: "—", vendor: mat.vendor || "WAREHOUSE" });
      }
    } else if (baseQty > 0) {
      consumableRows.push({ qty: baseQty, unit: mat.unit || "PCS", item: mat.profile, color: mat.color || "—", species: "—", lengths: "—", vendor: mat.vendor || "WAREHOUSE" });
    }
    if (!mat.customOverride && (mat.extraColors || []).length > 0) {
      const autoColors = new Set<string>();
      if (mat.profileId === "coil" || mat.profileId === "paint-caulk") {
        getExteriorColorQtys(mat.autoFormula, _allRows, mat.profileId).forEach(c => autoColors.add(canonicalColor(c.color)));
      } else if (mat.profileId === "silicone-caulk") {
        detectTrimCaulkColors(gmItems, materialCatalog, units, job.additionalMaterials).forEach(c => autoColors.add(canonicalColor(c)));
      }
      for (const color of (mat.extraColors as string[]).filter(c => !autoColors.has(canonicalColor(c)))) {
        consumableRows.push({ qty: baseQty, unit: mat.unit || "PCS", item: mat.profile, color: canonicalColor(color), species: "—", lengths: "—", vendor: mat.vendor || "WAREHOUSE" });
      }
    }
  }

  // 2. Trim rows (board-packing)
  const trimRows = buildNWOMaterialList(
    gmItems.filter((m: any) => !m.autoFormula),
    units,
    materialCatalog,
    offsets?.boardWaste,
    job.mullLayouts,
    { doors3pc: job.doors3pc !== false, summaryOverrides: job.materialSummaryOverrides }
  );

  // 3. Additional materials
  const addlRows: NwoRow[] = (job.additionalMaterials || [])
    .filter((m: any) => m.profile)
    .map((m: any) => {
      const canonical = resolveProfileNickname(m.profile, materialCatalog?.items);
      const ci = (materialCatalog?.items || []).find(it => it.profile === canonical);
      let vendor = m.vendor || "";
      if (!vendor) {
        const opt = ci ? ((ci.options || []).find(o => !m.species || o.species === m.species) || ci.options?.[0]) : null;
        if (opt?.vendors?.length) vendor = opt.vendors[0];
      }
      const displayItem = ci ? getDisplayName(ci) : canonical;
      return { qty: m.qty || 1, unit: m.unit || "PCS", item: displayItem, color: m.color || "", species: m.species || "", lengths: m.lengths || "—", vendor, profileId: ci?.id };
    });

  // 4. Merge + length consolidation
  const mergeLengths = (a: string, b: string) => {
    if (!a || a === "—") return b;
    if (!b || b === "—") return a;
    const parse = (s: string) => {
      const map: Record<string, number> = {};
      (s.match(/(\d+)@(\S+)/g) || []).forEach(tok => {
        const m = tok.match(/^(\d+)@(.+)$/);
        if (m) map[m[2]] = (map[m[2]] || 0) + Number(m[1]);
      });
      return map;
    };
    const combined = parse(a);
    Object.entries(parse(b)).forEach(([len, n]) => { combined[len] = (combined[len] || 0) + n; });
    if (!Object.keys(combined).length) return [a, b].join(" ");
    const sortKey = (s: string) => { const n = parseFloat(s); return isNaN(n) ? 0 : n; };
    return Object.entries(combined)
      .sort((a, b) => sortKey(a[0]) - sortKey(b[0]))
      .map(([len, n]) => `${n}@${len}`)
      .join(" ");
  };

  const raw = [...consumableRows, ...trimRows, ...addlRows];
  const mergeMap = new Map<string, NwoRow>();
  const merged: NwoRow[] = [];
  for (const r of raw) {
    const key = [r.item, r.color, r.species].join("|");
    if (mergeMap.has(key)) {
      const existing = mergeMap.get(key)!;
      existing.qty += r.qty;
      existing.lengths = mergeLengths(existing.lengths, r.lengths);
    } else {
      const copy = { ...r };
      mergeMap.set(key, copy);
      merged.push(copy);
    }
  }

  // 5. Apply Material Summary overrides (±qty adjustments from JobEditor Section 4).
  // Per-unit board overrides (unit|...) are already baked into the boards by
  // buildGlobalMaterialBoards (via summaryOverrides) — do NOT re-apply them.
  // Only aggregate qty adjustments (consumables, additional materials, extra
  // boards, section-1 items) are applied to the merged rows here.
  const summaryOv = job.materialSummaryOverrides || {};
  if (Object.keys(summaryOv).length) {
    const norm = (s: string) => (!s || s === "--" || s === "—") ? "" : s;
    // Keep per-length deltas (from the Section 4 length picker, e.g. { "8'": 1 })
    // separate from any plain numeric delta so stock rows update BOTH qty and the
    // Lengths column — matching JobEditor's Section 4 table. Summing to a single
    // number here would bump qty but leave Lengths stale in the install PDF.
    const deltaMap: Record<string, { perLen: Record<string, number>; numeric: number }> = {};
    const ensure = (nk: string) => (deltaMap[nk] = deltaMap[nk] || { perLen: {}, numeric: 0 });
    for (const k of Object.keys(summaryOv)) {
      const d = summaryOv[k];
      const p = k.split("|");
      let nk: string | undefined;
      if (p[0] === "cons") nk = p[1] + "|" + norm(p[2]) + "|";
      else if (p[0] === "addl") nk = p[1] + "|" + norm(p[2]) + "|" + norm(p[3]);
      else if (p[0] === "extra") nk = p[1] + "|" + norm(p[2]) + "|" + norm(p[3]);
      else if (p[0] === "secone") nk = p[1] + "|" + norm(p[2]) + "|";
      // unit|... intentionally skipped — handled by the packer.
      if (!nk) continue;
      const acc = ensure(nk);
      if (d && typeof d === "object") {
        for (const len of Object.keys(d)) acc.perLen[len] = (acc.perLen[len] || 0) + (Number(d[len]) || 0);
      } else {
        acc.numeric += Number(d) || 0;
      }
    }
    const sk = (s: string) => { const n = parseFloat(s); return isNaN(n) ? 0 : n; };
    for (const r of merged) {
      const key = r.item + "|" + norm(r.color) + "|" + norm(r.species);
      const acc = deltaMap[key];
      if (!acc) continue;
      const perLenKeys = Object.keys(acc.perLen);
      const stockParts = (r.lengths || "").match(/(\d+)@(\S+)/g) || [];
      const isStockRow = stockParts.length > 0 && stockParts.every((t: string) => t.indexOf("'") !== -1);
      if (isStockRow) {
        const entries = stockParts
          .map((t: string) => { const m = t.match(/^(\d+)@(.+)$/); return m ? { count: Number(m[1]), length: m[2] } : null; })
          .filter(Boolean) as { count: number; length: string }[];
        for (const len of perLenKeys) {
          const dl = Number(acc.perLen[len]) || 0;
          const ex = entries.find((e) => e.length === len);
          if (ex) ex.count = Math.max(0, ex.count + dl);
          else if (dl > 0) entries.push({ count: dl, length: len });
        }
        if (acc.numeric) {
          const target = [...entries].sort((a, b) => b.count - a.count)[0];
          if (target) target.count = Math.max(0, target.count + acc.numeric);
        }
        const live = entries.filter((e) => e.count > 0).sort((a, b) => sk(a.length) - sk(b.length));
        r.lengths = live.length ? live.map((e) => `${e.count}@${e.length}`).join(" ") : "—";
        r.qty = entries.reduce((s, e) => s + Math.max(0, e.count), 0);
      } else {
        const totalDelta = acc.numeric + perLenKeys.reduce((s, len) => s + (Number(acc.perLen[len]) || 0), 0);
        if (totalDelta) r.qty = Math.max(0, r.qty + totalDelta);
      }
    }
  }

  // 6. Vendor assignment overrides
  for (const row of merged) {
    const vaKey = `${row.item}|${row.color || ""}|${row.species || ""}`;
    if (vendorAssignments[vaKey]) row.vendor = vendorAssignments[vaKey];
    if (!row.vendor) row.vendor = "—";
  }

  return merged;
}

// ─── Board Summary by Unit (owner-based assignment) ────────────────────────

export interface BoardSummaryEntry {
  sig: string;
  unitLabels: string[];
}

export function buildBoardSummaryByUnit(
  job: any,
  units: any[],
  materialCatalog: MaterialCatalog | null,
  offsets: any
): BoardSummaryEntry[] {
  const gmNonAuto = (job.globalMaterials || []).filter((m: any) => !m.autoFormula && m.profileId);

  const boards = gmNonAuto.length
    ? buildGlobalMaterialBoards(
        (job.globalMaterials || []).filter((m: any) => !m.autoFormula),
        units, materialCatalog, offsets?.boardWaste, job.mullLayouts,
        { doors3pc: job.doors3pc !== false, summaryOverrides: job.materialSummaryOverrides }
      ).boards
    : [];

  const SL: Record<number, string> = { 96:"8'", 120:"10'", 144:"12'", 168:"14'", 192:"16'", 216:"18'", 240:"20'" };

  // Assign each board to the unit with the most cuts (owner logic)
  const byUnit: Record<string, Record<string, Record<number, number>>> = {};
  for (const b of boards) {
    const cutCounts: Record<string, number> = {};
    for (const c of b.cuts) {
      const label = (c.source || "").replace(/\s*\(.*\)\s*$/, "");
      if (label) cutCounts[label] = (cutCounts[label] || 0) + 1;
    }
    const entries = Object.entries(cutCounts);
    // Empty designated boards (from a Section 4 override) carry no cuts — fall
    // back to the stamped source so they still attribute to their unit.
    let owner = entries.length ? entries.sort((a, b) => b[1] - a[1])[0][0] : "";
    if (!owner && (b as any).source) owner = String((b as any).source).replace(/\s*\(.*\)\s*$/, "");
    if (!owner) continue;
    if (!byUnit[owner]) byUnit[owner] = {};
    if (!byUnit[owner][b.profile]) byUnit[owner][b.profile] = {};
    byUnit[owner][b.profile][b.stockLength] = (byUnit[owner][b.profile][b.stockLength] || 0) + 1;
  }

  // Per-unit "extra" materials: non-consumable Additional Materials (using their
  // per-unit allocation m.unitQtys) + approved misc items. Consumables (catalog
  // category "Consumable") are excluded. Mirrors buildUnitExtras in the material-list
  // app's ReportView.jsx.
  const items = materialCatalog?.items || [];
  const extras: Record<string, string[]> = {};
  const pushExtra = (label: string, str: string) => {
    if (!label || !str) return;
    (extras[label] = extras[label] || []).push(str);
  };
  for (const m of (job.additionalMaterials || [])) {
    if (!m.profile) continue;
    const canon = resolveProfileNickname(m.profile, items) || m.profile;
    const catItem = items.find((it) => it.profile === canon);
    if (catItem && (catItem as any).category === "Consumable") continue;
    const qtys = m.unitQtys || {};
    for (const lbl of (m.includeUnits || [])) {
      const raw = qtys[lbl];
      const hasQ = raw !== undefined && raw !== null && String(raw).trim() !== "" && !isNaN(Number(raw));
      pushExtra(String(lbl), hasQ ? `${Number(raw)} ${canon}` : canon);
    }
  }
  for (const u of (units || [])) {
    if (!u.isMisc || !u.approved) continue;
    const desc = u.description || "Misc item";
    const q = u.qty ?? 1;
    pushExtra(desc, `${q} pcs`);
  }

  if (!boards.length && !Object.keys(extras).length) return [];

  // Group units with identical (boards + extras) breakdown
  const sigMap: Record<string, string[]> = {};
  const allLabels = new Set([...Object.keys(byUnit), ...Object.keys(extras)]);
  for (const label of allLabels) {
    const profiles = byUnit[label] || {};
    const parts = Object.entries(profiles)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([prof, stocks]) => {
        const stockStr = Object.entries(stocks)
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(([sl, n]) => `${n}@${SL[Number(sl)] || Math.round(Number(sl) / 12) + "'"}`)
          .join(" ");
        const displayProf = getDisplayNameByProfile(prof, materialCatalog?.items);
        return `${stockStr} ${displayProf}`;
      });
    const sig = [...parts, ...(extras[label] || [])].join(", ");
    if (!sig) continue;
    if (!sigMap[sig]) sigMap[sig] = [];
    sigMap[sig].push(label);
  }

  return Object.entries(sigMap)
    .sort((a, b) => {
      const an = parseInt(a[1][0]);
      const bn = parseInt(b[1][0]);
      const aFirst = isNaN(an) ? Number.MAX_SAFE_INTEGER : an;
      const bFirst = isNaN(bn) ? Number.MAX_SAFE_INTEGER : bn;
      return aFirst - bFirst;
    })
    .map(([sig, labels]) => ({ sig, unitLabels: labels }));
}

// ─── PO TRACKING (reads from shared trim_purchase_orders table) ─────────────

export interface PurchaseOrder {
  id: string;
  job_id: string | null;
  vendor: string;
  customer_name: string | null;
  job_po_number: string | null;
  status: string; // 'ordered' | 'partial' | 'received' | 'cancelled'
  ordered_at: string;
  received_at: string | null;
  estimated_arrival_min: string | null;
  estimated_arrival_max: string | null;
  line_items: any[];
  notes: string | null;
  homeowner: string | null;
  source: string; // 'job' | 'standalone'
}

/** Fetch all POs for a specific job */
export async function fetchPOsForJob(jobId: string): Promise<PurchaseOrder[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("trim_purchase_orders")
      .select("*")
      .eq("job_id", jobId)
      .neq("status", "cancelled")
      .order("ordered_at", { ascending: false });
    if (error) throw error;
    return (data || []) as PurchaseOrder[];
  } catch (e) {
    console.warn("fetchPOsForJob failed:", e);
    return [];
  }
}

/** Fetch all open (ordered/partial) POs across all jobs */
export async function fetchOpenPOs(): Promise<PurchaseOrder[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("trim_purchase_orders")
      .select("*")
      .in("status", ["ordered", "partial"])
      .order("ordered_at", { ascending: true });
    if (error) throw error;
    return (data || []) as PurchaseOrder[];
  } catch (e) {
    console.warn("fetchOpenPOs failed:", e);
    return [];
  }
}
