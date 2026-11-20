import { NextResponse } from "next/server";
import {
  getMessages,
  listBots,
  listPicks,
  markRead,
  setUnreadState,
  type MyGroup,
} from "@/lib/groupme";
import { lookupSent } from "@/lib/groupme-office";
import { chatContext } from "@/lib/groupme-route";

export const runtime = "nodejs";

/**
 * The person's chosen chats, newest activity first, and what they've missed.
 *
 *   chats   [{ id, name, imageUrl, unread, unreadCount, lastReadId, lastAt,
 *              unreadSince, preview, hasBot, installerName, source }]
 *             - only chats they ticked that they can STILL reach: an office
 *               chat must still be shared with one of their roles; a personal
 *               one (admins only) must still have their own GroupMe in it
 *             - unreadCount: messages from OTHER people since they last read
 *               it (up to 100). Their own messages never count -- including
 *               ones they sent through the office account (groupme_sent).
 *             - preview: newest message ({ name, text }); an office message
 *               shows the real sender, not "RBANWO Office". Never stored.
 *   total   how many chats have unread, for the nav badge and app icon
 *
 * A newly ticked chat has no bookmark: that counts as READ -- the first look
 * sets the baseline rather than a wall of unread.
 */

/** Most chats to (re)count per request; the rest catch up next time. */
const MAX_LOOKUPS = 8;

export async function GET() {
  const ctx = await chatContext();
  if (!ctx.ok) {
    // Not set up (or GroupMe unreachable) is not worth shouting about -- the
    // nav bar asks for this constantly. Just report nothing.
    return NextResponse.json({ total: 0, chats: [] });
  }

  const picks = await listPicks(ctx.user.id);
  const bots = new Map(
    (await listBots(picks.map((p) => p.groupId))).map((b) => [b.groupId, b])
  );
  const officeId = ctx.office?.groupmeUserId ?? null;

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
    source: "personal" | "office";
  }[] = [];
  const writes: Promise<void>[] = [];
  let lookups = 0;
  let total = 0;

  for (const pick of picks) {
    // Which account reaches this chat -- and is it still allowed?
    let group: MyGroup | undefined;
    let token: string | null = null;
    let me: string | null = null;
    if (pick.source === "office") {
      if (!ctx.office || !ctx.shared.has(pick.groupId)) continue;
      group = ctx.officeGroups.get(pick.groupId);
      token = ctx.office.token;
    } else {
      if (!ctx.personal) continue;
      group = ctx.personalGroups.get(pick.groupId);
      token = ctx.personal.token;
      me = ctx.personal.me;
    }
    if (!group || !token) continue;

    let unread = false;
    let unreadCount = pick.unreadCount;
    let unreadSince = pick.unreadSince ? Date.parse(pick.unreadSince) / 1000 : 0;

    if (group.lastId) {
      if (!pick.lastReadMessageId) {
        writes.push(markRead(ctx.user.id, pick.groupId, group.lastId));
      } else if (pick.lastReadMessageId !== group.lastId) {
        unread = true;
        const stale = pick.unreadCountedId !== group.lastId || !pick.unreadSince;
        if (stale && lookups < MAX_LOOKUPS) {
          lookups++;
          try {
            const since = await getMessages(token, pick.groupId, {
              sinceId: pick.lastReadMessageId,
              limit: 100,
            });
            // Office messages: which were sent by THIS person?
            const sent = await lookupSent(
              since.filter((m) => officeId && m.user_id === officeId).map((m) => m.source_guid)
            );
            const fresh = since.filter((m) => {
              if (m.system) return false;
              if (me && m.user_id === me) return false;
              if (officeId && m.user_id === officeId) {
                const s = sent.get(m.source_guid);
                if (s && s.userId === ctx.user.id) return false;
              }
              return true;
            });
            if (fresh.length === 0) {
              unread = false;
              writes.push(markRead(ctx.user.id, pick.groupId, group.lastId));
            } else {
              unreadCount = fresh.length;
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

    // "RBANWO Office: Kennen M: running late" -> "Kennen M: running late".
    let preview = group.preview;
    if (preview && ctx.office?.name && preview.name === ctx.office.name) {
      const m = preview.text.match(/^([^:\n]{1,40}): ([\s\S]*)$/);
      if (m) preview = { name: m[1], text: m[2] };
    }

    chats.push({
      id: pick.groupId,
      name: group.name || pick.groupName || "GroupMe chat",
      imageUrl: group.imageUrl,
      unread,
      unreadCount: unread ? unreadCount : 0,
      lastReadId: pick.lastReadMessageId,
      lastAt: group.lastAt,
      unreadSince: unread ? unreadSince : 0,
      preview,
      hasBot: !!bot,
      installerName: bot?.installerName ?? null,
      source: pick.source,
    });
  }

  await Promise.all(writes);

  chats.sort((a, b) => b.lastAt - a.lastAt);
  return NextResponse.json({ total, chats });
}
