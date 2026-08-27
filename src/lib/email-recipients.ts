/**
 * Normalize and dedupe email recipients so no address ever lands on both the
 * To and CC lines. "To wins": an address that appears on both is kept only on
 * To and dropped from CC. Also removes duplicates within each list and any
 * blank entries. Matching is case-insensitive and ignores surrounding spaces.
 *
 * Shared by every send path (the write-up submit, the field-notes send, the
 * desktop mailto resend, and the server route) so the behavior is identical
 * everywhere. Standalone (no other imports) so it's cheap to use server-side.
 */
export function dedupeRecipients(
  to: string[],
  cc: string[]
): { to: string[]; cc: string[] } {
  const norm = (e: string) => e.trim().toLowerCase();

  const seenTo = new Set<string>();
  const outTo: string[] = [];
  for (const e of to) {
    const key = norm(e);
    if (!key || seenTo.has(key)) continue;
    seenTo.add(key);
    outTo.push(e.trim());
  }

  const seenCc = new Set<string>();
  const outCc: string[] = [];
  for (const e of cc) {
    const key = norm(e);
    // Skip blanks, addresses already on To, and CC duplicates.
    if (!key || seenTo.has(key) || seenCc.has(key)) continue;
    seenCc.add(key);
    outCc.push(e.trim());
  }

  return { to: outTo, cc: outCc };
}
