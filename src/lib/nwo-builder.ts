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

// ─── TYPES ──────────────────────────────────────────────────────────────────

export interface NwoRow {
  qty: number;
  unit: string;
  item: string;
  color: string;
  species: string;
  lengths: string;
  vendor: string;
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
}

interface MaterialCatalog {
  items?: CatalogItem[];
  stains?: string[];
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

function calcConsumableQty(autoFormula: any, summaryRows: any[]): number {
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
  return Math.ceil(
    (autoFormula.ED || 0) * AD3 +
    (autoFormula.PTD || 0) * AD4 +
    (autoFormula.FF || 0) * AD5 +
    (autoFormula.IF || 0) * AD6
  );
}

function getExteriorColorQtys(autoFormula: any, summaryRows: any[]): { color: string; qty: number }[] {
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
    .map(([color, qty]) => ({ color, qty: Math.ceil(qty) }))
    .filter(r => r.qty > 0);
}

function detectTrimCaulkColors(globalMaterials: any[], materialCatalog: MaterialCatalog | null, units: any[], additionalMaterials: any[]): string[] {
  const stainSet = new Set(Array.isArray(materialCatalog?.stains) ? materialCatalog!.stains : MC_DEFAULT_STAINS);
  let hasStain = false;
  const paintColors = new Set<string>();

  for (const m of (globalMaterials || []).filter(m => !m.autoFormula && m.color)) {
    if (stainSet.has(m.color) || m.color === "RAW") hasStain = true;
    else paintColors.add(m.color);
  }
  for (const m of (additionalMaterials || [])) {
    if (!m.color) continue;
    if (stainSet.has(m.color) || m.color === "RAW") hasStain = true;
    else paintColors.add(m.color);
  }
  for (const u of (units || [])) {
    if (u.isMisc) continue;
    if ((u.interiorColor || "").match(/pine|oak/i)) hasStain = true;
  }

  const paintList = [...paintColors];
  if (hasStain && paintList.length) return ["Clear", ...paintList];
  if (hasStain) return ["Clear"];
  return paintList.length ? paintList : ["White[RBA]"];
}

function resolveProfileNickname(typed: string, catalogItems: CatalogItem[] | undefined): string {
  if (!typed) return typed;
  if ((catalogItems || []).find(it => it.profile === typed)) return typed;
  const lower = typed.toLowerCase().trim();
  const match = (catalogItems || []).find(it => (it.nicknames || []).some(n => n.toLowerCase().trim() === lower));
  return match ? match.profile : typed;
}

// ─── MULL CUTS ──────────────────────────────────────────────────────────────

function computeMullCuts(layout: any[], unitsByLabel: Record<string, { W: number; H: number }>, buf: number, isEJ: boolean, deepEJ: boolean, isDoor: boolean) {
  if (!layout || !layout.length) return null;
  const grid: Record<string, any> = {};
  layout.forEach((t: any) => {
    const u = unitsByLabel[t.label];
    if (!u) return;
    grid[`${t.gridX},${t.gridY}`] = { ...t, W: u.W, H: u.H };
  });

  const cuts: any[] = [];
  const groupLabel = layout.map((t: any) => t.label).join("+");

  layout.forEach((t: any) => {
    const cell = grid[`${t.gridX},${t.gridY}`];
    if (!cell) return;
    if (!grid[`${t.gridX - 1},${t.gridY}`])
      cuts.push({ length: cell.H + buf, rawLength: cell.H, source: groupLabel, cutName: `Left side (${cell.label})` });
    if (!grid[`${t.gridX + 1},${t.gridY}`])
      cuts.push({ length: cell.H + buf, rawLength: cell.H, source: groupLabel, cutName: `Right side (${cell.label})` });
    if (!grid[`${t.gridX},${t.gridY - 1}`])
      cuts.push({ length: cell.W + buf, rawLength: cell.W, source: groupLabel, cutName: `Top (${cell.label})` });
    if (!grid[`${t.gridX},${t.gridY + 1}`] && !isDoor)
      cuts.push({ length: cell.W + buf, rawLength: cell.W, source: groupLabel, cutName: `Bottom (${cell.label})` });
  });

  if (isEJ && !deepEJ) {
    const halfCount = Math.ceil(cuts.length / 2);
    const maxLen = Math.max(...cuts.map(c => c.length));
    return Array.from({ length: halfCount }, (_, i) => ({
      length: maxLen, rawLength: maxLen - buf, source: groupLabel, cutName: `EJ piece ${i + 1}`
    }));
  }
  return cuts;
}

// ─── BOARD PACKING (buildGlobalMaterialBoards) ──────────────────────────────

function buildGlobalMaterialBoards(globalMaterials: any[], units: any[], materialCatalog: MaterialCatalog | null, boardWaste: number, mullLayouts: any, options?: { doors3pc?: boolean }) {
  const doors3pc = options?.doors3pc ?? false;
  const buf = boardWaste ?? 5;
  const MIN_BOARD_REMAINING = 8;
  const DEFAULT_STOCK = [96, 120, 144, 168];
  const allBoards: any[] = [];
  const customCalcMethods = materialCatalog?.calcMethods || [];

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

  const getCuts = (method: string, H: number, W: number, sillW: number, stoolW: number, isEJ: boolean, deepEJ: boolean, src: string, isDoor: boolean) => {
    if (method === "1w") return [{ length: W + buf, rawLength: W, source: src, cutName: "1 pc @ width" }];
    if (method === "wph" || method === "WH") {
      if (isEJ) {
        const c = [
          { length: H + buf, rawLength: H, source: src, cutName: "EJ Left" },
          { length: H + buf, rawLength: H, source: src, cutName: "EJ Right" },
          { length: W + buf, rawLength: W, source: src, cutName: "EJ Head" },
        ];
        if (deepEJ) c.push({ length: sillW + buf, rawLength: sillW, source: src, cutName: `EJ Sill${sillW !== W ? " (override)" : ""}` });
        return c;
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
      const deepEJ = (u.materialOverrides?.[mat.id]?.deepEJ) ?? mat.deepEJ;
      const isDoor = isUnitDoor(u);

      const mullGk = mullGroupsByLabel[unitLabel];
      if (mullGk && (isCasing || isEJ) && !isDoor) {
        if (mullGroupsProcessed.has(mullGk)) continue;
        mullGroupsProcessed.add(mullGk);
        const layout = mullLayouts[mullGk];
        const unitsByLabel: Record<string, { W: number; H: number }> = {};
        units.forEach((gu: any) => {
          const gl = String(gu.label || gu.id);
          if (mullHandled.has(gl)) {
            unitsByLabel[gl] = { W: (gu.widthWhole || 0) + (gu.widthFrac || 0), H: (gu.heightWhole || 0) + (gu.heightFrac || 0) };
          }
        });
        const mullCuts = computeMullCuts(layout, unitsByLabel, buf, isEJ, deepEJ, isDoor);
        if (mullCuts && mullCuts.length) cuts.push(...mullCuts);
        continue;
      }

      const src = unitLabel + (u.location ? ` (${u.location})` : "");
      const sillW = (u.sillOverrideWhole || 0) + (u.sillOverrideFrac || 0) || W;
      const stoolW = (u.stoolOverrideWhole || 0) + (u.stoolOverrideFrac || 0) || W;
      const newCuts = getCuts(catItem.calcMethod, H, W, sillW, stoolW, isEJ, deepEJ, src, isDoor);
      if (doors3pc && isDoor) newCuts.forEach((c: any) => { c._doors3pc = true; });
      cuts.push(...newCuts);
    }
    if (!cuts.length) continue;

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
        const board = !cut._doors3pc && packed.find(b => b.cuts.length && b.cuts[0].source === cut.source && b.remaining - cut.length >= MIN_BOARD_REMAINING);
        if (board) {
          board.cuts.push(cut);
          board.remaining -= cut.length;
        } else {
          const stockLen = STOCK.find(s => s >= cut.length) || 168;
          packed.push({ stockLength: stockLen, profile: mat.profile || catItem.profile, species: mat.species || "", color: mat.color || "", vendor: mat.vendor || "", category: catItem.category || "Casing", cuts: [cut], remaining: stockLen - cut.length });
        }
      }
    }
    // Merge orphan single-cut boards (same source only, no upsizing)
    for (let i = packed.length - 1; i >= 1; i--) {
      if (packed[i].cuts.length !== 1) continue;
      if (packed[i].cuts[0]._doors3pc) continue;
      const iSource = packed[i].cuts[0].source;
      for (let j = 0; j < i; j++) {
        if (!packed[j].cuts.some((c: any) => c.source === iSource)) continue;
        if (packed[j].remaining - packed[i].cuts[0].length >= MIN_BOARD_REMAINING) {
          packed[j].cuts.push(...packed[i].cuts);
          packed[j].remaining -= packed[i].cuts[0].length;
          packed.splice(i, 1);
          break;
        }
      }
    }
    // Bump boards with too little remaining
    for (let i = packed.length - 1; i >= 0; i--) {
      const board = packed[i];
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

    allBoards.push(...packed);
  }

  return { boards: allBoards };
}

// ─── buildNWOMaterialList (trim rows from board packing) ────────────────────

function buildNWOMaterialList(globalMaterials: any[], units: any[], materialCatalog: MaterialCatalog | null, boardWaste: number, mullLayouts: any, options?: { doors3pc?: boolean }) {
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
        .map(({ l, n }) => `${n > 1 ? n + "@" : ""}${fmtLen(l)}`)
        .join("  ");
    } else if (Object.keys(m.stockTotals).length) {
      lengths = Object.entries(m.stockTotals)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([in_, n]) => `${n}@${MC_STOCK_LABELS[Number(in_)] || Math.round(Number(in_) / 12) + "'"}`)
        .join(" ");
    }
    const qty = m.exactLengths ? m.exactLengths.length : Object.values(m.stockTotals as Record<number, number>).reduce((a, b) => a + b, 0);
    return { qty, unit: "PCS", item: m.profile, color: m.color, species: m.species, lengths, vendor: m.vendor };
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
    const baseQty = mat.qtyOverride != null ? mat.qtyOverride : calcConsumableQty(mat.autoFormula, _allRows);
    if (mat.customOverride) {
      if (baseQty > 0) consumableRows.push({ qty: baseQty, unit: mat.unit || "PCS", item: mat.profile, color: (mat.colorOverride != null ? mat.colorOverride : mat.color) || "—", species: "—", lengths: "—", vendor: mat.vendor || "WAREHOUSE" });
    } else if (mat.profileId === "coil" || mat.profileId === "paint-caulk") {
      const colorQtys = getExteriorColorQtys(mat.autoFormula, _allRows);
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
        getExteriorColorQtys(mat.autoFormula, _allRows).forEach(c => autoColors.add(c.color));
      } else if (mat.profileId === "silicone-caulk") {
        detectTrimCaulkColors(gmItems, materialCatalog, units, job.additionalMaterials).forEach(c => autoColors.add(c));
      }
      for (const color of (mat.extraColors as string[]).filter(c => !autoColors.has(c))) {
        consumableRows.push({ qty: baseQty, unit: mat.unit || "PCS", item: mat.profile, color, species: "—", lengths: "—", vendor: mat.vendor || "WAREHOUSE" });
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
    { doors3pc: job.doors3pc !== false }
  );

  // 3. Additional materials
  const addlRows: NwoRow[] = (job.additionalMaterials || [])
    .filter((m: any) => m.profile)
    .map((m: any) => {
      const canonical = resolveProfileNickname(m.profile, materialCatalog?.items);
      let vendor = m.vendor || "";
      if (!vendor) {
        const ci = (materialCatalog?.items || []).find(it => it.profile === canonical);
        const opt = ci ? ((ci.options || []).find(o => !m.species || o.species === m.species) || ci.options?.[0]) : null;
        if (opt?.vendors?.length) vendor = opt.vendors[0];
      }
      return { qty: m.qty || 1, unit: m.unit || "PCS", item: canonical, color: m.color || "", species: m.species || "", lengths: m.lengths || "—", vendor };
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

  // 5. Vendor assignment overrides
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
  if (!gmNonAuto.length) return [];

  const { boards } = buildGlobalMaterialBoards(
    (job.globalMaterials || []).filter((m: any) => !m.autoFormula),
    units, materialCatalog, offsets?.boardWaste, job.mullLayouts,
    { doors3pc: job.doors3pc !== false }
  );
  if (!boards.length) return [];

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
    if (!entries.length) continue;
    const owner = entries.sort((a, b) => b[1] - a[1])[0][0];
    if (!byUnit[owner]) byUnit[owner] = {};
    if (!byUnit[owner][b.profile]) byUnit[owner][b.profile] = {};
    byUnit[owner][b.profile][b.stockLength] = (byUnit[owner][b.profile][b.stockLength] || 0) + 1;
  }

  // Group units with identical board breakdowns
  const sigMap: Record<string, string[]> = {};
  for (const [label, profiles] of Object.entries(byUnit)) {
    const parts = Object.entries(profiles)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([prof, stocks]) => {
        const stockStr = Object.entries(stocks)
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(([sl, n]) => `${n}@${SL[Number(sl)] || Math.round(Number(sl) / 12) + "'"}`)
          .join(" ");
        return `${stockStr} ${prof}`;
      });
    const sig = parts.join(", ");
    if (!sigMap[sig]) sigMap[sig] = [];
    sigMap[sig].push(label);
  }

  return Object.entries(sigMap)
    .sort((a, b) => {
      const aFirst = parseInt(a[1][0]) || 0;
      const bFirst = parseInt(b[1][0]) || 0;
      return aFirst - bFirst;
    })
    .map(([sig, labels]) => ({ sig, unitLabels: labels }));
}
