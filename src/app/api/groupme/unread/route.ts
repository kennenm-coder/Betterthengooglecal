import { NextResponse } from "next/server";
import { listPicks, markRead } from "@/lib/groupme";
import { chatContext } from "@/lib/groupme-route";

export const runtime = "nodejs";

/**
 * The person's chosen chats, newest activity first, and which have something
 * they haven't read.
 *
 *   chats   [{ id, name, unread, lastAt }] -- only groups they ticked AND are
 *           still in. lastAt is unix seconds of the newest message.
 *   total   how many chats have unread, for the nav badge and app icon
 *
 * Unread simply means "the newest message id in the group is not the id this
 * user last saw". No message content is fetched for this, and none is stored.
 *
 * A newly ticked chat has no bookmark. That counts as READ, not as a wall of
 * unread badges -- the first look sets the baseline.
 */
export async function GET() {
  const ctx = await chatContext();
  if (!ctx.ok) {
    // Not connected (or GroupMe unreachable) is not worth shouting about --
    // the nav bar asks for this constantly. Just report nothing.
    return NextResponse.json({ total: 0, chats: [] });
  }

  const picks = await listPicks(ctx.user.id);

  const chats: { id: string; name: string; unread: boolean; lastAt: number }[] = [];
  const baseline: { groupId: string; messageId: string }[] = [];
  let total = 0;

  for (const pick of picks) {
    const group = ctx.myGroups.get(pick.groupId);
    // Left the group (or it was deleted) since ticking it: just don't show it.
    if (!group) continue;

    let unread = false;
    if (group.lastId) {
      if (!pick.lastReadMessageId) {
        baseline.push({ groupId: pick.groupId, messageId: group.lastId });
      } else {
        unread = pick.lastReadMessageId !== group.lastId;
      }
    }
    if (unread) total++;

    chats.push({
      id: pick.groupId,
      // GroupMe's current name, so a renamed group shows its new name.
      name: group.name || pick.groupName || "GroupMe chat",
      unread,
      lastAt: group.lastAt,
    });
  }

  await Promise.all(
    baseline.map((b) => markRead(ctx.user.id, b.groupId, b.messageId))
  );

  chats.sort((a, b) => b.lastAt - a.lastAt);
  return NextResponse.json({ total, chats });
}
