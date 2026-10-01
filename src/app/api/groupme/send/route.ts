import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { buildMentions } from "@/lib/groupme-mentions";
import {
  getSenderName,
  getSharedToken,
  resolveGroupId,
  sendMessage,
  GroupMeError,
} from "@/lib/groupme";

export const runtime = "nodejs";

/**
 * GroupMe's documented limit for a single message. The sender prefix counts
 * toward it, so the text the user may type is capped lower (see below).
 */
const MAX_LENGTH = 1000;

/**
 * Send a message into an installer's real GroupMe group.
 *
 * Everything goes out through the shared office account, so GroupMe shows that
 * account as the sender regardless of who typed it -- their API offers no way
 * to set a per-message sender. The real author's name is therefore written
 * into the text itself:
 *
 *     Sarah Dodd: Your materials for tomorrow's job are ready.
 *
 * The installer sees the office account with a name in front, and carries on
 * using GroupMe exactly as before.
 *
 * Like the read route, the client sends an installer NAME and the group is
 * resolved here, so nothing can be posted into a group that isn't mapped.
 */
export async function POST(request: Request) {
  const { user, error: authError } = await requireRole("admin");
  if (authError) return authError;

  let payload: {
    installer?: unknown;
    text?: unknown;
    mentions?: unknown;
  };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const installer =
    typeof payload.installer === "string" ? payload.installer.trim() : "";
  const text = typeof payload.text === "string" ? payload.text.trim() : "";

  // Who the composer's @-picker selected. Validated rather than trusted: a
  // malformed entry would produce a bad character range, and a bad range means
  // a mention that looks right but notifies nobody.
  const mentions = (Array.isArray(payload.mentions) ? payload.mentions : [])
    .filter(
      (m): m is { userId: string; nickname: string } =>
        !!m &&
        typeof m === "object" &&
        typeof (m as { userId?: unknown }).userId === "string" &&
        typeof (m as { nickname?: unknown }).nickname === "string"
    )
    .map((m) => ({ userId: m.userId, nickname: m.nickname }));

  if (!installer) {
    return NextResponse.json({ error: "Missing installer." }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "Message is empty." }, { status: 400 });
  }
  const senderName = await getSenderName(user!.email);
  const prefix = `${senderName}: `;

  if (prefix.length + text.length > MAX_LENGTH) {
    return NextResponse.json(
      {
        error: `Messages are limited to ${MAX_LENGTH - prefix.length} characters.`,
      },
      { status: 400 }
    );
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
    // Build the final string FIRST, then measure the mention offsets against
    // it -- the prefix shifts every position, so measuring before prepending
    // would point each mention at the wrong characters.
    const finalText = `${prefix}${text}`;
    const mentionAttachment = buildMentions(finalText, mentions);

    await sendMessage(
      token,
      groupId,
      finalText,
      mentionAttachment ? [mentionAttachment] : []
    );
    // The caller re-polls with since_id to pick the message up, so there is
    // one code path that renders messages rather than two.
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = e instanceof GroupMeError ? e.status : 500;
    const message =
      e instanceof GroupMeError ? e.message : "Could not send the message.";
    return NextResponse.json({ error: message }, { status });
  }
}
