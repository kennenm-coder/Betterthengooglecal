// Where GroupMe posts every new message in a group that has the Duck Force bot
// (migration 071), the moment it is sent. No sign-in here -- GroupMe is the
// caller -- so instead the address carries a random secret (?k=...) saved with
// the bot; a post without the right one is ignored. That's what stops anyone
// faking a message to make phones buzz.
//
// For each real message from a person:
//   1. everyone who ticked this chat (except the sender) gets +1 unread, and
//      the chat's "waiting since" clock starts if it wasn't running
//   2. each of them with "Buzz me" on gets an instant buzz (notify() still
//      skips anyone in their quiet hours)
// The message text goes into the buzz and is then dropped -- never stored.

import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getBot, recordBotMessage } from "@/lib/groupme";
import { notify } from "@/lib/notify-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BotPost {
  id?: string;
  group_id?: string;
  user_id?: string;
  sender_id?: string;
  sender_type?: string;
  name?: string;
  text?: string | null;
  system?: boolean;
  created_at?: number;
  attachments?: { type?: string }[];
}

function sameKey(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function clip(text: string, max = 120): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export async function POST(req: Request) {
  const key = new URL(req.url).searchParams.get("k") || "";
  const post = (await req.json().catch(() => null)) as BotPost | null;

  // Always answer 200 quickly; GroupMe doesn't need to know why we skipped.
  const ok = NextResponse.json({ ok: true });
  if (!post?.group_id || !post.id || !key) return ok;

  const bot = await getBot(post.group_id);
  if (!bot || !sameKey(key, bot.callbackKey)) return ok;

  // Only people's messages: not system notices, not bots (ours included).
  if (post.system || (post.sender_type && post.sender_type !== "user")) return ok;

  const sender = post.user_id || post.sender_id || "";
  const at = post.created_at ? new Date(post.created_at * 1000) : new Date();

  let people: Awaited<ReturnType<typeof recordBotMessage>>;
  try {
    people = await recordBotMessage(post.group_id, post.id, sender, at);
  } catch (e) {
    console.error("groupme bot:", (e as Error).message);
    return ok;
  }

  const text = post.text?.trim()
    ? clip(post.text)
    : post.attachments?.some((a) => a.type === "image")
      ? "sent a photo"
      : "sent a message";
  const line = `${post.name || "Someone"}: ${text}`;
  const title = bot.groupName || "GroupMe";

  await Promise.all(
    people
      .filter((p) => p.notify && p.email)
      .map((p) =>
        notify({
          emails: [p.email],
          kind: "groupme_message",
          title,
          body: p.unreadCount > 1 ? `${p.unreadCount} new messages · ${line}` : line,
          url: `/chat?open=${encodeURIComponent(post.group_id!)}`,
          tag: `groupme-${post.group_id}`,
          pushOnly: true,
        }).catch(() => undefined)
      )
  );

  return ok;
}
