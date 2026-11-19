import { NextResponse } from "next/server";
import { buildMentions } from "@/lib/groupme-mentions";
import { sendMessage } from "@/lib/groupme";
import { chatContext, groupmeErrorResponse } from "@/lib/groupme-route";

export const runtime = "nodejs";

/** GroupMe's documented limit for a single message. */
const MAX_LENGTH = 1000;

/**
 * Send a message into one of the person's chosen GroupMe groups, AS them.
 *
 * It goes out on their own GroupMe account, so the installer sees it from that
 * person exactly as if they had typed it in the GroupMe app -- no name prefix,
 * no shared office account.
 *
 * chatContext refuses a group they didn't tick or aren't in, so nothing can be
 * posted anywhere else.
 */
export async function POST(request: Request) {
  let payload: {
    group?: unknown;
    text?: unknown;
    mentions?: unknown;
  };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const group = typeof payload.group === "string" ? payload.group.trim() : "";
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

  if (!group) {
    return NextResponse.json({ error: "Missing group." }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "Message is empty." }, { status: 400 });
  }
  if (text.length > MAX_LENGTH) {
    return NextResponse.json(
      { error: `Messages are limited to ${MAX_LENGTH} characters.` },
      { status: 400 }
    );
  }

  const ctx = await chatContext(group);
  if (!ctx.ok) return ctx.response;

  try {
    // Mention offsets are measured against the exact string being sent.
    const mentionAttachment = buildMentions(text, mentions);

    await sendMessage(
      ctx.token,
      ctx.groupId!,
      text,
      mentionAttachment ? [mentionAttachment] : []
    );
    // The caller re-polls with since_id to pick the message up, so there is
    // one code path that renders messages rather than two.
    return NextResponse.json({ ok: true });
  } catch (e) {
    return groupmeErrorResponse(e, "Could not send the message.");
  }
}
