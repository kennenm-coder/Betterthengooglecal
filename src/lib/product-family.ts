// ─── PRODUCT FAMILIES ───────────────────────────────────────────────────────
// Two sides describe the same window in different words, and neither is tidy:
//
//   The unit, from the order:   "Double Casement", "Triple Casement",
//                               "Casement Picture", "Gliding Patio Door"
//   The part, from the catalog: a freeform Model someone typed —
//                               "Casement", "A-Series Patio Door", "" …
//
// Matching those as strings fails on the first write-up: "Double Casement"
// never equals "Casement". So both sides are reduced to a FAMILY — casement,
// patio door, double hung — and compared on that. It's what lets the write-up
// picker show a casement job casement parts without hiding the catalog.
//
// Three deliberate looseness choices, because this filters a field tool:
//   • A text can land in SEVERAL families. "Casement Picture" is both, and a
//     bay/bow pulls in casement, picture and double hung, since that is what
//     bays are built out of — a bay write-up needs the parts of its lites.
//   • A text nobody recognises falls back to sharing a significant word. An
//     unrecognised unit type then still lands somewhere sensible instead of
//     matching nothing at all.
//   • Blank, "universal" and "custom" are matched by everything on purpose.
//     Those are the parts that belong to no one model, and a field-added part
//     is stamped "Custom" — hiding those would bury real inventory.
//
// Nothing here BLOCKS anything. The picker uses it to decide what to show
// first and what to tag; the person can always reach the rest of the catalog.

/** A part type that belongs to every unit — never filtered out. */
const UNIVERSAL = /^(universal|any|all|custom|n\/?a|generic|misc\.?|miscellaneous)$/;

/**
 * Families, in the order they are tested. Order matters: "Gliding Patio Door"
 * has to be caught by patio door before "gliding" makes it a gliding window.
 */
const FAMILIES: { key: string; test: RegExp; unless?: RegExp }[] = [
  // Doors first — most door names also contain a window-ish word.
  { key: "patio door", test: /\bpatio\b|frenchwood|\bgliding\s+door\b|\bhinged\s+door\b|\bsliding\s+door\b/ },
  { key: "entry door", test: /\bentry\b|\bentrance\b|\bfront\s+door\b/ },
  { key: "storm door", test: /\bstorm\b/ },
  // Windows. Fixed casement before casement/picture: it looks like both, but
  // its parts are its own — a casement frame with picture glass, no operator.
  { key: "fixed casement", test: /\bfixed[\s-]?casement\b|\bfc\b|\bcasement[\s-]?picture\b|\bpicture[\s-]?casement\b/ },
  { key: "casement", test: /\bcasement\b|\bcasment\b|\bcsmt\b/, unless: /\bfixed[\s-]?casement\b|\bcasement[\s-]?picture\b|\bpicture[\s-]?casement\b/ },
  { key: "awning", test: /\bawning\b|\bawn\b/ },
  { key: "double hung", test: /\bdouble[\s-]?hung\b|\bsingle[\s-]?hung\b|\bdbl[\s-]?hung\b|\bd\.?h\.?\b|\bhung\b/ },
  // "Gliding" on its own is a window; on a door it is a patio door, caught
  // above. Without this, gliding-window parts would follow a patio-door unit
  // around and vice versa.
  { key: "gliding window", test: /\bglider\b|\bgliding\b|\bsliding\b|\bslider\b/, unless: /\bdoor\b|\bpatio\b|frenchwood/ },
  { key: "picture", test: /\bpicture\b|\bfixed\b|\bdirect[\s-]?set\b|\bpict\b/, unless: /\bfixed[\s-]?casement\b|\bcasement[\s-]?picture\b|\bpicture[\s-]?casement\b/ },
  { key: "specialty", test: /\bspecialty\b|\barch\b|\barched\b|\bspringline\b|\bcircle\b|\bround\s?top\b|\boctagon\b|\btrapezoid\b|\btriangle\b|\bhalf[\s-]?round\b/ },
  { key: "transom", test: /\btransom\b/ },
  { key: "skylight", test: /\bskylight\b|\broof\s+window\b/ },
];

/** A bay or bow is an assembly: its lites are casements, pictures and hungs. */
const BAY = /\bbay\b|\bbow\b|\bbay\/bow\b/;
const BAY_PARTS = ["casement", "picture", "double hung"];

/** Words that say nothing about which model this is. */
const NOISE = new Set([
  "a", "an", "the", "and", "or", "of", "with", "series", "window", "windows",
  "door", "doors", "unit", "units", "new", "old", "rba", "andersen", "left",
  "right", "center", "centre", "wide", "tall", "in", "out", "white", "canvas",
  "sandtone", "terratone", "black", "double", "triple", "single", "quad",
  "two", "three", "four", "2", "3", "4",
]);

function clean(raw: string | null | undefined): string {
  return (raw || "").toLowerCase().replace(/[_/]+/g, " ").replace(/\s+/g, " ").trim();
}

/** True for a type that belongs to every unit: blank, universal, or custom. */
export function isUniversalType(raw: string | null | undefined): boolean {
  const t = clean(raw);
  return !t || UNIVERSAL.test(t);
}

/**
 * Every family a piece of text belongs to, lowercase. Empty when nothing is
 * recognised — the caller then falls back to word overlap rather than treating
 * it as "matches nothing".
 */
export function productFamilies(raw: string | null | undefined): string[] {
  const t = clean(raw);
  if (!t || UNIVERSAL.test(t)) return [];
  const out = new Set<string>();
  for (const f of FAMILIES) {
    if (f.test.test(t) && !(f.unless && f.unless.test(t))) out.add(f.key);
  }
  if (BAY.test(t)) {
    out.add("bay/bow");
    for (const k of BAY_PARTS) out.add(k);
  }
  return [...out];
}

/** The words worth comparing when no family is recognised. */
export function significantWords(raw: string | null | undefined): string[] {
  return clean(raw)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !NOISE.has(w));
}

export interface FamilyMatcher {
  /** Nothing to narrow by — no units, or no unit carries a type. */
  readonly empty: boolean;
  /** The families the units are in, for a short "casement, picture" note. */
  readonly families: string[];
  /** Does this part / bundle type belong to the units being written up? */
  matches(type: string | null | undefined): boolean;
}

/**
 * Build a matcher for the units a write-up item affects. With no usable unit
 * types it reports `empty`, and the caller leaves the catalog alone — a filter
 * that narrows to nothing is worse than no filter.
 */
export function familyMatcher(unitTypes: (string | null | undefined)[]): FamilyMatcher {
  const families = new Set<string>();
  const words = new Set<string>();
  let anyType = false;
  for (const raw of unitTypes) {
    const t = clean(raw);
    if (!t) continue;
    anyType = true;
    for (const f of productFamilies(t)) families.add(f);
    for (const w of significantWords(t)) words.add(w);
  }
  const empty = !anyType;
  return {
    empty,
    families: [...families],
    matches(type) {
      if (empty) return true;
      // Blank / universal / custom parts belong to every unit.
      if (isUniversalType(type)) return true;
      const theirs = productFamilies(type);
      if (theirs.some((f) => families.has(f))) return true;
      // Unrecognised on either side: share a significant word and it counts.
      // "Woodwright" against a "Woodwright Double Hung" unit still lands.
      if (theirs.length === 0 || families.size === 0) {
        return significantWords(type).some((w) => words.has(w));
      }
      return false;
    },
  };
}
