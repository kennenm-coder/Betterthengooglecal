import { NextResponse } from "next/server";
import {
  getConnection,
  getMessages,
  listBots,
  listPicks,
  markRead,
  setUnreadState,
} from "@/lib/groupme";
import { chatContext } from "@/lib/groupme-route";

export const runtime = "nodejs";

/**
 * The person's chosen chats, newest activity first, and what they've missed.
 *
 *   chats   [{ id, name, imageUrl, unread, unreadCount, lastReadId, lastAt,
 *              unreadSince, preview, hasBot, installerName }]
 *             - only groups they ticked AND are still in
 *             - unreadCount: messages from OTHER people since they last read
 *               it (up to 100). Counted by the bot when the chat has one;
 *               otherwise counted here whenever the chat's newest message
 *               changes, and saved (migration 073) so it isn't redone.
 *             - lastReadId: the last message they'd seen, so an opened chat
 *               can draw a "New messages" line above the first unread one
 *             - lastAt / unreadSince: unix seconds (0 = none). unreadSince is
 *               when the FIRST unread message arrived (drives the colors)
 *             - preview: newest message ({ name, text }), passed through from
 *               GroupMe, never stored. imageUrl: the group's GroupMe picture.
 *   total   how many chats have unread, for the nav badge and app icon
 *
 * Your own messages (sent from the GroupMe app) never count as unread.
 * A newly ticked chat has no bookmark: that counts as READ -- the first look
 * sets the baseline rather than a wall of unread.
 */

/** Most chats to (re)count per request; the rest catch up next time. */
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
  // Chats with the Duck Force bot: which installer each is for.
  const bots = new Map(
    (await listBots(picks.map((p) => p.groupId))).map((b) => [b.groupId, b])
  );

  const chats: {
    id: string;
    name: string;
    imageUrl: string | null;
    unread: boolean;
    unreadCount: number;
    lastReadId: string | null;
    lastAt: number;
    unreadSince: number;
    preview: { name: string; text: string } | null;
    hasBot: boolean;
    installerName: string | null;
  }[] = [];
  const writes: Promise<void>[] = [];
  let lookups = 0;
  let total = 0;

  for (const pick of picks) {
    const group = ctx.myGroups.get(pick.groupId);
    // Left the group (or it was deleted) since ticking it: just don't show it.
    if (!group) continue;

    let unread = false;
    let unreadCount = pick.unreadCount;
    let unreadSince = pick.unreadSince ? Date.parse(pick.unreadSince) / 1000 : 0;

    if (group.lastId) {
      if (!pick.lastReadMessageId) {
        writes.push(markRead(ctx.user.id, pick.groupId, group.lastId));
      } else if (pick.lastReadMessageId !== group.lastId) {
        unread = true;
        // Something arrived since the last count: count again -- messages from
        // others since they last read it. One GroupMe call, then remembered.
        const stale = pick.unreadCountedId !== group.lastId || !pick.unreadSince;
        if (stale && lookups < MAX_LOOKUPS) {
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
              unreadCount = fresh.length;
              // GroupMe answers newest first, so the oldest is last.
              if (!unreadSince) unreadSince = fresh[fresh.length - 1].created_at;
              writes.push(
                setUnreadState(ctx.user.id, pick.groupId, {
                  count: unreadCount,
                  countedId: group.lastId,
                  since: pick.unreadSince ? null : new Date(unreadSince * 1000).toISOString(),
                })
              );
            }
          } catch {
            // Keep the last known count this round; the next check tries again.
          }
        }
      }
    }
    if (unread) total++;
    const bot = bots.get(pick.groupId);

    chats.push({
      id: pick.groupId,
      // GroupMe's current name, so a renamed group shows its new name.
      name: group.name || pick.groupName || "GroupMe chat",
      imageUrl: group.imageUrl,
      unread,
      unreadCount: unread ? unreadCount : 0,
      lastReadId: pick.lastReadMessageId,
      lastAt: group.lastAt,
      unreadSince: unread ? unreadSince : 0,
      preview: group.preview,
      hasBot: !!bot,
      installerName: bot?.installerName ?? null,
    });
  }

  await Promise.all(writes);

  chats.sort((a, b) => b.lastAt - a.lastAt);
  return NextResponse.json({ total, chats });
}
