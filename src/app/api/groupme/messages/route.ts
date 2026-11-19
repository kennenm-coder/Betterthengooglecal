import { NextResponse } from "next/server";
import { getConnection, getMessages, type GroupMeMessage } from "@/lib/groupme";
import { chatContext, groupmeErrorResponse } from "@/lib/groupme-route";

export const runtime = "nodejs";

/**
 * Messages for one of the person's chosen GroupMe groups, read with their own
 * GroupMe account. chatContext refuses any group they didn't tick, so their
 * other GroupMe groups stay out of this app.
 *
 * Query:
 *   group       required, the GroupMe group id
 *   before_id   load older messages (scrolling back)
 *   since_id    load only what's new (polling for replies)
 *
 * Nothing is stored. Messages are proxied live and GroupMe stays the record.
 */
function shape(m: GroupMeMessage, myGroupMeId: string | null) {
  return {
    id: m.id,
    text: m.text ?? "",
    name: m.name,
    createdAt: new Date(m.created_at * 1000).toISOString(),
    isMine: !!myGroupMeId && m.user_id === myGroupMeId,
    isSystem: !!m.system,
    avatarUrl: m.avatar_url,
    images: (m.attachments || [])
      .filter((a) => a.type === "image" && a.url)
      .map((a) => a.url as string),
  };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const group = params.get("group")?.trim();
  if (!group) {
    return NextResponse.json({ error: "Missing group." }, { status: 400 });
  }

  const ctx = await chatContext(group);
  if (!ctx.ok) return ctx.response;

  try {
    // "Mine" = sent by this person's own GroupMe account, wherever they sent
    // it from (this app or the GroupMe app itself).
    const [connection, messages] = await Promise.all([
      getConnection(ctx.user.id),
      getMessages(ctx.token, ctx.groupId!, {
        beforeId: params.get("before_id") || undefined,
        sinceId: params.get("since_id") || undefined,
        limit: Number(params.get("limit")) || 50,
      }),
    ]);

    // GroupMe returns newest-first; the UI reads oldest-first.
    return NextResponse.json({
      messages: messages
        .map((m) => shape(m, connection?.groupmeUserId ?? null))
        .reverse(),
    });
  } catch (e) {
    return groupmeErrorResponse(e, "Could not load messages.");
  }
}
