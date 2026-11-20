import { NextResponse } from "next/server";
import {
  getConnection,
  getMessages,
  listPicks,
  markRead,
  setUnreadSince,
} from "@/lib/groupme";
import { chatContext } from "@/lib/groupme-route";

export const runtime = "nodejs";

/**
 * The person's chosen chats, newest activity first, and which have something
 * they haven't read.
 *
 *   chats   [{ id, name, unread, lastAt, unreadSince, preview }]
 *             - only groups they ticked AND are still in
 *             - lastAt / unreadSince are unix seconds (0 = none). unreadSince
 *               is when the FIRST unread message arrived; the list colors the
 *               chat by how long that's been (green -> red, hourly).
 *             - preview is the newest message ({ name, text }) for the list's
 *               second line. Passed through from GroupMe, never stored.
 *   total   how many chats have unread, for the nav badge and app icon
 *
 * Unread means "the newest message id in the group is not the id this user
 * last saw", and at least one of the unseen messages is from someone else --
 * your own message (sent from the GroupMe app) doesn't make a chat unread.
 *
 * A newly ticked chat has no bookmark. That counts as READ, not as a wall of
 * unread badges -- the first look sets the baseline.
 */

/** Most chats to look inside per request when working out unread-since. */
const MAX_LOOKUPS = 8;

export async function GET() {
  const ctx = await chatContext();
  if (!ctx.ok) {
    // Not connected (or GroupMe unreachable) is not worth shouting about --
    // the nav bar asks for this constantly. Just report nothing.
    return NextResponse.json({ total: 0, chats: [] });
  }

  const [picks, connection] = await Promise.all([
    listPicks(ctx.user.id),
    getConnection(ctx.user.id),
  ]);
  const me = connection?.groupmeUserId ?? null;

  const chats: {
    id: string;
    name: string;
    unread: boolean;
    lastAt: number;
    unreadSince: number;
    preview: { name: string; text: string } | null;
  }[] = [];
  const writes: Promise<void>[] = [];
  let lookups = 0;
  let total = 0;

  for (const pick of picks) {
    const group = ctx.myGroups.get(pick.groupId);
    // Left the group (or it was deleted) since ticking it: just don't show it.
    if (!group) continue;

    let unread = false;
    let unreadSince = pick.unreadSince ? Date.parse(pick.unreadSince) / 1000 : 0;

    if (group.lastId) {
      if (!pick.lastReadMessageId) {
        writes.push(markRead(ctx.user.id, pick.groupId, group.lastId));
      } else if (pick.lastReadMessageId !== group.lastId) {
        unread = true;
        // First time we see it unread: find when the first unseen message
        // from someone else arrived. One look, then it's remembered.
        if (!pick.unreadSince && lookups < MAX_LOOKUPS) {
          lookups++;
          try {
            const fresh = (
              await getMessages(ctx.token, pick.groupId, {
                sinceId: pick.lastReadMessageId,
                limit: 100,
              })
            ).filter((m) => !m.system && m.user_id !== me);
            if (fresh.length === 0) {
              // Only your own messages since you last looked: not unread.
              unread = false;
              writes.push(markRead(ctx.user.id, pick.groupId, group.lastId));
            } else {
              // GroupMe answers newest first, so the oldest is last.
              unreadSince = fresh[fresh.length - 1].created_at;
              writes.push(
                setUnreadSince(
                  ctx.user.id,
                  pick.groupId,
                  new Date(unreadSince * 1000).toISOString()
                )
              );
            }
          } catch {
            // Leave it uncolored this round; the next check tries again.
          }
        }
      }
    }
    if (unread) total++;

    chats.push({
      id: pick.groupId,
      // GroupMe's current name, so a renamed group shows its new name.
      name: group.name || pick.groupName || "GroupMe chat",
      unread,
      lastAt: group.lastAt,
      unreadSince: unread ? unreadSince : 0,
      preview: group.preview,
    });
  }

  await Promise.all(writes);

  chats.sort((a, b) => b.lastAt - a.lastAt);
  return NextResponse.json({ total, chats });
}
