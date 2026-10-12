// ─── TRIM VENDOR RESOLUTION ─────────────────────────────────────────────────
// Mirrors the material-list maker's own rules, so a vendor this app picks for a
// write-up trim line is the vendor that app would have picked for the same
// profile / color / species. Source of truth:
//
//   nwo-material-list-maker/cut-list-pro/lib/materials.js
//     resolveVendor          (~line 589)
//     resolveColorGroup      (~line 573)
//     resolveProfileNickname (~line 539)
//     IN_HOUSE_SET           (~line 22)
//
// Keep this file in step with that one. Nothing here reads the DB — callers pass
// in the already-fetched shared catalog.

import type { CatalogItem, MaterialCatalog } from "./nwo-builder";

/** Vendors that mean "we already have it" — these never reach a purchase order.
 *  Every PO builder in the material-list app filters them out. */
export const IN_HOUSE_SET = new Set(["WAREHOUSE", "RBA SHOP"]);

/** The material-list app's "no vendor assigned" sentinel. */
export const NO_VENDOR = "--";

/** True when this line is in-house stock rather than something to order. */
export function isInHouse(vendor: string | null | undefined): boolean {
  return IN_HOUSE_SET.has((vendor || "").trim().toUpperCase());
}

/** True when a line carries a real outside vendor, so it belongs on an order. */
export function isOrderable(vendor: string | null | undefined): boolean {
  const v = (vendor || "").trim();
  return v.length > 0 && v !== NO_VENDOR && !isInHouse(v);
}

/** A colorGroup name → the actual list of colors in it. */
export function resolveColorGroup(
  catalog: MaterialCatalog | null | undefined,
  groupName: string | undefined
): string[] {
  if (!catalog || !catalog.colorGroups) return [];
  if (!groupName || groupName === "none") return [];
  return catalog.colorGroups[groupName] || [];
}

/** A typed profile name → the catalog's canonical profile, via nicknames.
 *  Returns the input unchanged when nothing matches. */
export function resolveProfileNickname(
  typed: string,
  catalogItems: CatalogItem[] | null | undefined
): string {
  if (!typed) return typed;
  const items = catalogItems || [];
  if (items.find((it) => it.profile === typed)) return typed;
  const lower = typed.toLowerCase().trim();
  const match = items.find((it) =>
    (it.nicknames || []).some((n) => String(n).toLowerCase().trim() === lower)
  );
  return match ? match.profile : typed;
}

/** Every vendor that can supply this item in this species + color. `[0]` is the
 *  default, the rest are alternates — the same contract as materials.js. */
export function resolveVendor(
  catalogItem: CatalogItem | null | undefined,
  species: string,
  color: string,
  catalog: MaterialCatalog | null | undefined
): string[] | null {
  if (!catalogItem || !catalogItem.options) return null;
  for (const opt of catalogItem.options) {
    if (opt.species !== species && opt.species !== "N/A") continue;
    const colors = resolveColorGroup(catalog, opt.colorGroup);
    if (opt.colorGroup === "none" || colors.includes(color)) {
      return opt.vendors || [];
    }
  }
  return null;
}

/** The one vendor to fill in for a trim line, or "" when the catalog can't say.
 *  Needs all three of profile / species / color before it will guess, because
 *  the vendor depends on all three. */
export function autoVendorFor(
  opts: {
    profile: string;
    profileId?: string;
    species: string;
    color: string;
  },
  catalog: MaterialCatalog | null | undefined
): string {
  const { profile, profileId, species, color } = opts;
  if (!profile.trim() || !species.trim() || !color.trim()) return "";
  const items = catalog?.items || [];
  const item =
    (profileId ? items.find((it) => it.id === profileId) : undefined) ||
    items.find((it) => it.profile === resolveProfileNickname(profile.trim(), items));
  if (!item) return "";
  const vendors = resolveVendor(item, species.trim(), color.trim(), catalog);
  return (vendors && vendors[0]) || "";
}

/** The catalog's abbreviation for a vendor, used in PO numbers. Falls back the
 *  same way generatePONumber does in the material-list app. */
export function vendorAbbr(
  vendorName: string,
  catalog: MaterialCatalog | null | undefined
): string {
  const v = (catalog?.vendors || []).find((x) => x.name === vendorName);
  if (v && v.abbr) return v.abbr.replace(/\s+/g, "");
  return vendorName.replace(/\s+/g, "_").toUpperCase().slice(0, 4);
}
