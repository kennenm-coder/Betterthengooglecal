import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import {
  getLatestMessageIds,
  getReadState,
  getSharedToken,
  listMappings,
  markRead,
  GroupMeError,
} from "@/lib/groupme";

export const runtime = "nodejs";

/**
 * Which installer conversations have something this user hasn't seen.
 *
 * Per USER, not per GroupMe account: everyone sends through the one shared
 * office account, but each Duck Force login keeps its own bookmark. Kennen
 * reading Tim's chat does not clear Charlie's badge.
 *
 * Unread simply means "the newest message id in the group is not the id this
 * user last saw". No message content is fetched for this, and none is stored.
 *
 * A first-time user has no bookmark at all. That counts as READ, not as a wall
 * of unread badges on day one -- the useful signal is "something arrived since
 * you started paying attention", so the first look sets the baseline.
 */
export async function GET() {
  const { user, error: authError } = await requireRole("admin");
  if (authError) return authError;

  const token = await getSharedToken();
  if (!token) {
    // Not connected yet is not an error worth shouting about -- the nav bar
    // asks for this constantly. Just report nothing unread.
    return NextResponse.json({ total: 0, byInstaller: {} });
  }

  try {
    const [latest, mappings, read] = await Promise.all([
      getLatestMessageIds(token),
      listMappings(),
      getReadState(user!.id),
    ]);

    const byInstaller: Record<string, boolean> = {};
    let total = 0;
    const baseline: { installerName: string; messageId: string }[] = [];

    for (const { installerName, groupId } of mappings) {
      const newest = latest[groupId];
      if (!newest) continue;

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

    // Lay down first-look baselines without making the caller wait on them.
    await Promise.all(
      baseline.map((b) => markRead(user!.id, b.installerName, b.messageId))
    );

    return NextResponse.json({ total, byInstaller });
  } catch (e) {
    const status = e instanceof GroupMeError ? e.status : 500;
    return NextResponse.json(
      { error: "Could not check for new messages.", total: 0, byInstaller: {} },
      { status }
    );
  }
}
