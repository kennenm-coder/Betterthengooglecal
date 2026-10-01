import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import {
  getMessages,
  getSharedConnection,
  getSharedToken,
  resolveGroupId,
  GroupMeError,
  type GroupMeMessage,
} from "@/lib/groupme";

export const runtime = "nodejs";

/**
 * Messages for one installer's existing GroupMe group.
 *
 * The client sends an installer NAME, never a group id -- the mapping is
 * resolved here, server-side, so the browser never learns a group id and
 * cannot ask for a conversation that isn't mapped to an installer. That is
 * what keeps someone's personal GroupMe groups out of this app even though
 * the connected token can technically reach them.
 *
 * Query:
 *   installer   required, e.g. "Tim Fitzpatrick"
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
  const { error: authError } = await requireRole("admin");
  if (authError) return authError;

  const params = new URL(request.url).searchParams;
  const installer = params.get("installer")?.trim();
  if (!installer) {
    return NextResponse.json({ error: "Missing installer." }, { status: 400 });
  }

  const token = await getSharedToken();
  if (!token) {
    return NextResponse.json(
      { error: "GroupMe isn't connected yet." },
      { status: 428 }
    );
  }

  const groupId = await resolveGroupId(installer);
  if (!groupId) {
    return NextResponse.json(
      { error: `No GroupMe group is linked to ${installer} yet.` },
      { status: 404 }
    );
  }

  try {
    // "Mine" means the office account, not the individual reader -- everything
    // the app sends goes out through that one account, so all of it belongs on
    // the office side of the conversation.
    const connection = await getSharedConnection();
    const messages = await getMessages(token, groupId, {
      beforeId: params.get("before_id") || undefined,
      sinceId: params.get("since_id") || undefined,
      limit: Number(params.get("limit")) || 50,
    });

    // GroupMe returns newest-first; the UI reads oldest-first.
    return NextResponse.json({
      messages: messages
        .map((m) => shape(m, connection?.groupmeUserId ?? null))
        .reverse(),
    });
  } catch (e) {
    const status = e instanceof GroupMeError ? e.status : 500;
    const message =
      e instanceof GroupMeError ? e.message : "Could not load messages.";
    return NextResponse.json({ error: message }, { status });
  }
}
