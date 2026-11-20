import { NextResponse } from "next/server";
import { buildMentions } from "@/lib/groupme-mentions";
import { sendMessage } from "@/lib/groupme";
import {
  nameFor,
  peopleForChat,
  recordSent,
  setSentMessageId,
  shortName,
} from "@/lib/groupme-office";
import { chatContext, groupmeErrorResponse } from "@/lib/groupme-route";
import { notify } from "@/lib/notify-server";

export const runtime = "nodejs";

/** GroupMe's documented limit for a single message. */
const MAX_LENGTH = 1000;

/**
 * Send a message into one of the person's chosen chats.
 *
 *   - Through the OFFICE account (migration 074): GroupMe shows it from
 *     "RBANWO Office", so the text starts with the sender's name ("Kennen M:
 *     ...") for the installers, and it's tagged in groupme_sent with who sent
 *     it, so Duck Force shows their name above it and treats it as theirs.
 *   - Through an admin's OWN GroupMe: goes out under their own name, as is.
 *
 * @mentions:
 *   - `mentions`: GroupMe members -- GroupMe itself notifies them.
 *   - `people`: Duck Force people (by email) -- Duck Force buzzes THAT Duck
 *     Force account, even though in GroupMe it's all one office account. Only
 *     people who can see this chat are notified; anyone else is ignored.
 *
 * chatContext refuses a chat they didn't tick or may no longer see.
 */
export async function POST(request: Request) {
  let payload: {
    group?: unknown;
    text?: unknown;
    mentions?: unknown;
    people?: unknown;
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
  const mentionedEmails = new Set(
    (Array.isArray(payload.people) ? payload.people : [])
      .filter((e): e is string => typeof e === "string")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );

  if (!group) {
    return NextResponse.json({ error: "Missing group." }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "Message is empty." }, { status: 400 });
  }

  const ctx = await chatContext(group);
  if (!ctx.ok) return ctx.response;

  const senderName = await nameFor(ctx.user.email);
  const viaOffice = ctx.source === "office";
  // The name in front, so installers in GroupMe can tell who wrote it.
  const finalText = viaOffice ? `${shortName(senderName)}: ${text}` : text;
  if (finalText.length > MAX_LENGTH) {
    return NextResponse.json(
      { error: `Messages are limited to ${MAX_LENGTH - (finalText.length - text.length)} characters.` },
      { status: 400 }
    );
  }

  try {
    // Mention offsets are measured against the exact string being sent.
    const mentionAttachment = buildMentions(finalText, mentions);
    const sourceGuid = crypto.randomUUID();

    // Tag it BEFORE sending, so the bot's instant notice (which can arrive
    // before GroupMe even answers us) already knows who sent it.
    if (viaOffice) {
      await recordSent({
        sourceGuid,
        groupId: ctx.groupId!,
        userId: ctx.user.id,
        email: ctx.user.email,
        name: senderName,
      });
    }

    const sent = await sendMessage(
      ctx.token,
      ctx.groupId!,
      finalText,
      mentionAttachment ? [mentionAttachment] : [],
      sourceGuid
    );
    if (viaOffice && sent?.id) await setSentMessageId(sourceGuid, sent.id);

    // Buzz each @mentioned Duck Force person who can see this chat.
    if (mentionedEmails.size > 0) {
      const allowed = await peopleForChat(ctx.groupId!);
      const targets = allowed
        .filter((p) => mentionedEmails.has(p.email) && p.email !== ctx.user.email.toLowerCase())
        .map((p) => p.email);
      if (targets.length > 0) {
        await notify({
          emails: targets,
          kind: "groupme_message",
          title: `${senderName} mentioned you`,
          body: text.length > 140 ? `${text.slice(0, 139)}…` : text,
          url: `/chat?open=${encodeURIComponent(ctx.groupId!)}`,
          tag: `groupme-mention-${ctx.groupId}`,
          pushOnly: true,
        }).catch(() => undefined);
      }
    }

    // The caller re-polls with since_id to pick the message up, so there is
    // one code path that renders messages rather than two.
    return NextResponse.json({ ok: true });
  } catch (e) {
    return groupmeErrorResponse(e, "Could not send the message.");
  }
}
