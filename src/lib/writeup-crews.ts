// The "who could do this work" note on a write-up.
//
// It started life as a list of tagged crew names plus an "all of them
// together" flag. The office writes more than names in it — "Tim or Jose,
// any time after the 20th" — so it is a free-text note now. It still lives
// in the suggested_crews jsonb column, as a one-line list, so nothing had to
// move; write-ups tagged under the old picker read back as a sentence.
//
// Office-only, same as before: the Write-Ups tile shows it, the PDF and the
// email never do.

/** Stored list (old tags or the new single note) → what to show / edit. */
export function crewsToText(crews: string[] | null | undefined, allNeeded?: boolean | null): string {
  const list = (crews || []).map((c) => c.trim()).filter(Boolean);
  if (list.length <= 1) return list[0] || "";
  return list.join(allNeeded ? " + " : " or ");
}

/** Typed note → the stored list: one entry, or nothing when blank. */
export function textToCrews(text: string): string[] {
  const t = text.trim();
  return t ? [t] : [];
}
