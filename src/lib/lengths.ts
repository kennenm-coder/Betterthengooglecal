// Combining two trim "lengths" entries into one, for when a compiled list
// merges rows that were entered separately.
//
// Same `N@len` format the material-list maker uses (see the mergeLengths
// closure in nwo-builder.ts, which merges the install PDF's rows the same way),
// plus the two cases a write-up needs: its lengths box doubles as the quantity
// source (lengthsToQty), so a plain count has to add up rather than sit there
// twice as "2 2".

/**
 * Merge two lengths entries, summing the counts per length.
 *   "4@8'"  + "10@10'" → "4@8' 10@10'"
 *   "4@10'" + "2@10'"  → "6@10'"
 *   "2"     + "2"      → "4"      (a whole number is a count, so it adds)
 *   ".5"    + ".5"     → ".5"     (not a count — a size, so it's kept as-is)
 *   "N/A"   + "N/A"    → "N/A"    (identical, so keep the one)
 */
export function mergeLengths(a: string, b: string): string {
  const left = (a || "").trim();
  const right = (b || "").trim();
  if (!left || left === "—") return right;
  if (!right || right === "—") return left;

  const parse = (s: string): Record<string, number> => {
    const map: Record<string, number> = {};
    for (const tok of s.match(/(\d+)@(\S+)/g) || []) {
      const m = tok.match(/^(\d+)@(.+)$/);
      if (m) map[m[2]] = (map[m[2]] || 0) + Number(m[1]);
    }
    return map;
  };
  const combined = parse(left);
  for (const [len, n] of Object.entries(parse(right))) combined[len] = (combined[len] || 0) + n;
  if (Object.keys(combined).length > 0) {
    const sortKey = (s: string) => {
      const n = parseFloat(s);
      return isNaN(n) ? 0 : n;
    };
    return Object.entries(combined)
      .sort((x, y) => sortKey(x[0]) - sortKey(y[0]))
      .map(([len, n]) => `${n}@${len}`)
      .join(" ");
  }

  // No lengths, just a count — "2" + "2" is 4 tubes, not "2 2". Whole numbers
  // only, because that is what lengthsToQty reads as a count; anything else
  // (".5" on a roll) is an amount per line, so it stays as it was written.
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) return String(Number(left) + Number(right));
  if (left === right) return left;

  return `${left} ${right}`;
}
