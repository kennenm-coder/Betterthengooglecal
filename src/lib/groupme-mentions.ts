/**
 * Working out @-mention positions for GroupMe.
 *
 * Deliberately a standalone file with no imports: this is the one piece of the
 * GroupMe feature that fails SILENTLY when it's wrong. GroupMe does not read
 * "@Greg" out of the message text. A mention only notifies someone when the
 * message carries a mentions attachment naming their account id alongside the
 * exact character range their name occupies. Off by one and the message still
 * sends, still looks right in the group, and notifies nobody.
 *
 * Keeping it dependency-free means it can be tested on its own.
 */

export interface MentionPick {
  userId: string;
  nickname: string;
}

export interface MentionsAttachment {
  type: "mentions";
  user_ids: string[];
  /** [startIndex, length] per mention, aligned with user_ids by position.
   *  Length INCLUDES the "@". */
  loci: [number, number][];
}

/**
 * Build the attachment for a finished message.
 *
 * `finalText` must be the exact string being sent to GroupMe, INCLUDING the
 * "Sarah Dodd: " sender prefix — the prefix shifts every offset, so measuring
 * against the untouched user input would point each mention at the wrong
 * characters.
 *
 * Picks whose name no longer appears (edited out after being chosen) are
 * dropped rather than guessed at. Someone mentioned twice gets two entries; the
 * per-name cursor stops the second lookup finding the first occurrence again.
 */
export function buildMentions(
  finalText: string,
  mentions: MentionPick[]
): MentionsAttachment | null {
  const userIds: string[] = [];
  const loci: [number, number][] = [];
  const cursors = new Map<string, number>();

  for (const { userId, nickname } of mentions) {
    if (!userId || !nickname) continue;

    const needle = `@${nickname}`;
    const from = cursors.get(needle) ?? 0;
    const at = finalText.indexOf(needle, from);
    if (at === -1) continue;

    userIds.push(userId);
    loci.push([at, needle.length]);
    cursors.set(needle, at + needle.length);
  }

  if (userIds.length === 0) return null;
  return { type: "mentions", user_ids: userIds, loci };
}
