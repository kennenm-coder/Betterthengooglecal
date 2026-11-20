import { NextResponse } from "next/server";
import { getMessages, type GroupMeMessage } from "@/lib/groupme";
import { avatarsFor, lookupSent, stripSenderPrefix, type SentInfo } from "@/lib/groupme-office";
import { chatContext, groupmeErrorResponse } from "@/lib/groupme-route";

export const runtime = "nodejs";

/**
 * Messages for one of the person's chosen chats, read live from GroupMe through
 * whichever account reaches it (the office account, or an admin's own).
 * chatContext refuses anything they didn't tick or may no longer see.
 *
 * Messages sent through the OFFICE account all come from "RBANWO Office" with
 * the sender's name in front. Each is tagged (groupme_sent, migration 074), so
 * here the real Duck Force sender goes above the message, the name prefix is
 * taken off, and it counts as "mine" for the person who sent it.
 *
 * Query:
 *   group       required, the GroupMe group id
 *   before_id   load older messages (scrolling back)
 *   since_id    load only what's new (polling for replies)
 *
 * Nothing is stored. Messages are proxied live and GroupMe stays the record.
 */
function shape(
  m: GroupMeMessage,
  me: string | null,
  myUserId: string,
  officeId: string | null,
  sent: Map<string, SentInfo>,
  avatars: Map<string, string>
) {
  const base = {
    id: m.id,
    text: m.text ?? "",
    name: m.name,
    createdAt: new Date(m.created_at * 1000).toISOString(),
    isMine: !!me && m.user_id === me,
    isSystem: !!m.system,
    avatarUrl: m.avatar_url,
    images: (m.attachments || [])
      .filter((a) => a.type === "image" && a.url)
      .map((a) => a.url as string),
  };
  if (officeId && m.user_id === officeId) {
    const s = sent.get(m.source_guid);
    if (s) {
      return {
        ...base,
        name: s.name,
        text: stripSenderPrefix(base.text, s.name),
        isMine: s.userId === myUserId,
        // Their Duck Force profile picture (set on the Hub's Team page), not
        // the office account's, which would make everyone look the same.
        avatarUrl: (s.email && avatars.get(s.email.toLowerCase())) || null,
      };
    }
    // Typed straight into GroupMe as the office account: not anyone's here.
    return { ...base, isMine: false };
  }
  return base;
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
    const messages = await getMessages(ctx.token, ctx.groupId!, {
      beforeId: params.get("before_id") || undefined,
      sinceId: params.get("since_id") || undefined,
      limit: Number(params.get("limit")) || 50,
    });
    const officeId = ctx.office?.groupmeUserId ?? null;
    const sent = await lookupSent(
      messages.filter((m) => officeId && m.user_id === officeId).map((m) => m.source_guid)
    );
    const avatars = await avatarsFor([...sent.values()].map((s) => s.email || ""));
    // "Mine" through their own GroupMe: their account id. Through the office:
    // only what the tags say they sent (ctx.me is the office account then).
    const me = ctx.source === "personal" ? ctx.me : null;

    // GroupMe returns newest-first; the UI reads oldest-first.
    return NextResponse.json({
      messages: messages.map((m) => shape(m, me, ctx.user.id, officeId, sent, avatars)).reverse(),
    });
  } catch (e) {
    return groupmeErrorResponse(e, "Could not load messages.");
  }
}
