import { NextResponse } from "next/server";
import { getReadState, listMappings, markRead } from "@/lib/groupme";
import { chatContext } from "@/lib/groupme-route";

export const runtime = "nodejs";

/**
 * Which linked chats this person can see, and which have something they
 * haven't read.
 *
 *   available   chat names whose group THIS person's GroupMe account is in.
 *               The Chat list shows only these; a linked group they're not in
 *               simply isn't offered to them.
 *   byInstaller chat name -> has unread
 *   total       how many have unread, for the nav badge
 *
 * Unread simply means "the newest message id in the group is not the id this
 * user last saw". No message content is fetched for this, and none is stored.
 *
 * A first-time user has no bookmark at all. That counts as READ, not as a wall
 * of unread badges on day one -- the useful signal is "something arrived since
 * you started paying attention", so the first look sets the baseline.
 */
export async function GET() {
  const ctx = await chatContext();
  if (!ctx.ok) {
    // Not connected (or GroupMe unreachable) is not worth shouting about --
    // the nav bar asks for this constantly. Just report nothing.
    return NextResponse.json({ total: 0, byInstaller: {}, available: [] });
  }

  const [mappings, read] = await Promise.all([
    listMappings(),
    getReadState(ctx.user.id),
  ]);

  const byInstaller: Record<string, boolean> = {};
  const available: string[] = [];
  let total = 0;
  const baseline: { installerName: string; messageId: string }[] = [];

  for (const { installerName, groupId } of mappings) {
    if (!ctx.myGroups.has(groupId)) continue;
    available.push(installerName);

    const newest = ctx.myGroups.get(groupId);
    if (!newest) {
      byInstaller[installerName] = false;
      continue;
    }

    const seen = read[installerName];
    if (!seen) {
      // No bookmark yet -- set one now rather than crying unread.
      baseline.push({ installerName, messageId: newest });
      byInstaller[installerName] = false;
      continue;
    }

    const unread = seen !== newest;
    byInstaller[installerName] = unread;
    if (unread) total++;
  }

  await Promise.all(
    baseline.map((b) => markRead(ctx.user.id, b.installerName, b.messageId))
  );

  return NextResponse.json({ total, byInstaller, available });
}
