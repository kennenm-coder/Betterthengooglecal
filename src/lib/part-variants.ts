// ─── PART VARIANTS ──────────────────────────────────────────────────────────
// How a catalog part's colour / size picks become a part number, and the words
// that go with that number. Shared by the write-up's part lines and the photo
// catalog browser, so the two can never disagree about which combinations
// exist or when a pick is settled.
//
// The rule both follow: offer only combinations that are really in the part's
// variants, and fill a part number only once the picks leave exactly ONE number
// possible. A colour picked while several sizes are still open is not a part
// number yet, and pretending it is would order the wrong piece.
//
// Pure functions, no imports beyond types, so scripts/checks can run them.

import type { PartsCatalogItem, PartVariant } from "./work-order-store";

type VariantSource = Pick<PartsCatalogItem, "variants" | "colors" | "sizes">;

const norm = (s: string | null | undefined): string => (s || "").trim();

/** Lowercase letters and digits only, so "0123-456" and "0123456" compare equal. */
const loose = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** "Category — Name · Position": the name a picked part is saved under. */
export function partLabel(c: Pick<PartsCatalogItem, "category" | "partName" | "position">): string {
  return c.position ? `${c.category} — ${c.partName} · ${c.position}` : `${c.category} — ${c.partName}`;
}

/** Each value once, first spelling kept, blanks dropped. */
function uniq(list: string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const v = norm(raw);
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** A dimension's values in catalog order: the part's own list first (how the
 *  catalog editor ordered them), then any a variant has that the list lacks. */
function ordered(listed: string[], fromVariants: string[]): string[] {
  const have = uniq(fromVariants);
  const first = uniq(listed).filter((v) => have.includes(v));
  return [...first, ...have.filter((v) => !first.includes(v))];
}

/**
 * The colours worth offering. With variants, only colours some variant has —
 * and when a size is picked, only colours that come in that size. A part with
 * no variants yet offers its plain colour list, since nothing says otherwise.
 */
export function variantColors(part: VariantSource, size?: string): string[] {
  if (part.variants.length === 0) return uniq(part.colors);
  const s = norm(size);
  const fit = part.variants.filter((v) => !s || norm(v.size) === s);
  return ordered(part.colors, fit.map((v) => v.color));
}

/** The sizes worth offering — see variantColors, the other way round. */
export function variantSizes(part: VariantSource, color?: string): string[] {
  if (part.variants.length === 0) return uniq(part.sizes);
  const c = norm(color);
  const fit = part.variants.filter((v) => !c || norm(v.color) === c);
  return ordered(part.sizes, fit.map((v) => v.size));
}

/** Variants that fit the picks so far; a blank pick fits anything. */
function candidates(part: VariantSource, color: string, size: string): PartVariant[] {
  return part.variants.filter(
    (v) => (!color || norm(v.color) === color) && (!size || norm(v.size) === size)
  );
}

/** What a set of picks comes to: the picks themselves, filled in wherever the
 *  variants leave only one choice, and the part number once there is exactly
 *  one. */
export interface VariantPick {
  color: string;
  size: string;
  /** Set only when every remaining variant carries this same number. */
  partNumber: string;
}

/**
 * Settle a colour + size pick. A pick that doesn't exist with the other one is
 * dropped (the newer pick wins: pass the dimension just changed as `changed`),
 * a dimension the variants leave only one value for is filled in, and the part
 * number is set only when the remaining variants agree on one.
 */
export function settleVariant(
  part: VariantSource,
  color: string | undefined,
  size: string | undefined,
  changed?: "color" | "size"
): VariantPick {
  let c = norm(color);
  let s = norm(size);
  if (part.variants.length === 0) return { color: c, size: s, partNumber: "" };
  // A combination no variant has: keep the pick just made, drop the other.
  if (c && s && candidates(part, c, s).length === 0) {
    if (changed === "size") c = "";
    else s = "";
  }
  // A pick no variant has at all (an old line, a catalog edit since) is dropped.
  if (c && candidates(part, c, "").length === 0) c = "";
  if (s && candidates(part, "", s).length === 0) s = "";
  const hits = candidates(part, c, s);
  const colors = uniq(hits.map((v) => v.color));
  const sizes = uniq(hits.map((v) => v.size));
  if (!c && colors.length === 1 && hits.every((v) => norm(v.color))) c = colors[0];
  if (!s && sizes.length === 1 && hits.every((v) => norm(v.size))) s = sizes[0];
  const numbers = uniq(hits.map((v) => v.partNumber));
  const blankNumber = hits.some((v) => !norm(v.partNumber));
  return { color: c, size: s, partNumber: numbers.length === 1 && !blankNumber ? numbers[0] : "" };
}

/** True when the part has a real choice to make — more than one colour or
 *  more than one size on offer. Such a part opens its detail instead of being
 *  added in one tap. */
export function needsPick(part: VariantSource): boolean {
  return variantColors(part).length > 1 || variantSizes(part).length > 1;
}

/** How many distinct part numbers the part comes in — the "N options" on a card. */
export function optionCount(part: Pick<PartsCatalogItem, "variants">): number {
  return uniq(part.variants.map((v) => v.partNumber)).length;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asText(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  return "";
}

/**
 * The catalog's description of one part number — `details.descriptions` on an
 * imported Renewal part, keyed by part number. Matched as written first, then
 * ignoring dashes and spaces. undefined when there is none.
 */
export function partDescription(
  part: Pick<PartsCatalogItem, "details"> | null | undefined,
  partNumber: string | null | undefined
): string | undefined {
  const pn = norm(partNumber);
  if (!part || !pn) return undefined;
  const map = asRecord(asRecord(part.details)?.descriptions);
  if (!map) return undefined;
  const direct = asText(map[pn]);
  if (direct) return direct;
  const want = loose(pn);
  if (!want) return undefined;
  for (const [k, v] of Object.entries(map)) {
    if (loose(k) === want) {
      const t = asText(v);
      if (t) return t;
    }
  }
  return undefined;
}

/**
 * A free-text detail of a part as lines — `details.notes`, `details.fits`,
 * `details.description`. Imports store these as a string or a list of strings;
 * anything else reads as nothing.
 */
export function partDetailLines(part: Pick<PartsCatalogItem, "details">, key: string): string[] {
  const v = asRecord(part.details)?.[key];
  if (Array.isArray(v)) return v.map(asText).filter(Boolean);
  const t = asText(v);
  return t ? [t] : [];
}

/** The description a colour (or size) chip can carry: the description of the
 *  one part number it comes to, when it comes to just one. */
export function choiceHint(
  part: Pick<PartsCatalogItem, "variants" | "colors" | "sizes" | "details">,
  color: string,
  size: string
): string | undefined {
  const hits = candidates(part, norm(color), norm(size));
  const numbers = uniq(hits.map((v) => v.partNumber));
  return numbers.length === 1 ? partDescription(part, numbers[0]) : undefined;
}
