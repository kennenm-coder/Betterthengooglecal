// Add, link, or remove the Duck Force bot on one GroupMe chat (migration 072).
//
//   GET    ?group=ID                       -> { bot: { installerName, addedByEmail, mine } | null }
//   POST   { group, installerName }        -> adds the bot (if the chat has none) and/or
//                                             sets which installer the chat is for
//   DELETE { group }                       -> removes the bot (only whoever added it)
//
// Admins + the GroupMe Chat role, and only for a chat the person ticked (their
// own GroupMe account adds the bot, so it must be in the group -- GroupMe
// refuses otherwise). One bot per group; it serves everyone who ticked it.

import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import {
  createGroupMeBot,
  deleteBotRow,
  destroyGroupMeBot,
  getBot,
  listPicks,
  saveBot,
  setBotInstaller,
} from "@/lib/groupme";
import { chatContext, groupmeErrorResponse } from "@/lib/groupme-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanInstaller(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, 80);
  return t || null;
}

export async function GET(req: Request) {
  const group = new URL(req.url).searchParams.get("group")?.trim();
  if (!group) return NextResponse.json({ error: "Missing group." }, { status: 400 });
  const ctx = await chatContext(group);
  if (!ctx.ok) return ctx.response;

  const bot = await getBot(group);
  return NextResponse.json({
    bot: bot
      ? {
          installerName: bot.installerName,
          addedByEmail: bot.addedByEmail,
          mine: bot.addedByUser === ctx.user.id,
        }
      : null,
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { group?: unknown; installerName?: unknown }
    | null;
  const group = typeof body?.group === "string" ? body.group.trim() : "";
  if (!group) return NextResponse.json({ error: "Missing group." }, { status: 400 });
  const installerName = cleanInstaller(body?.installerName);

  const ctx = await chatContext(group);
  if (!ctx.ok) return ctx.response;

  try {
    const existing = await getBot(group);
    if (existing) {
      // Already has the bot: just (re)link the installer.
      await setBotInstaller(group, installerName);
      return NextResponse.json({ ok: true, added: false });
    }

    // New bot. GroupMe will post this group's messages to this address; the
    // random key in it is how /api/groupme/bot knows the post is genuine.
    const callbackKey = randomBytes(24).toString("hex");
    const origin = new URL(req.url).origin;
    const callbackUrl = `${origin}/api/groupme/bot?k=${callbackKey}`;
    const botId = await createGroupMeBot(ctx.token, group, callbackUrl);

    const pick = (await listPicks(ctx.user.id)).find((p) => p.groupId === group);
    await saveBot({
      groupId: group,
      botId,
      callbackKey,
      groupName: pick?.groupName ?? null,
      installerName,
      addedByUser: ctx.user.id,
      addedByEmail: ctx.user.email,
    });
    return NextResponse.json({ ok: true, added: true });
  } catch (e) {
    return groupmeErrorResponse(e, "Could not add the bot.");
  }
}

export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => null)) as { group?: unknown } | null;
  const group = typeof body?.group === "string" ? body.group.trim() : "";
  if (!group) return NextResponse.json({ error: "Missing group." }, { status: 400 });

  const ctx = await chatContext(group);
  if (!ctx.ok) return ctx.response;

  const bot = await getBot(group);
  if (!bot) return NextResponse.json({ ok: true });
  if (bot.addedByUser !== ctx.user.id) {
    return NextResponse.json(
      {
        error: `Only ${bot.addedByEmail || "the person who added it"} can remove the bot, because it belongs to their GroupMe account.`,
      },
      { status: 403 }
    );
  }

  try {
    await destroyGroupMeBot(ctx.token, bot.botId);
  } catch (e) {
    // Already gone at GroupMe (404) is fine; anything else, keep our record.
    const status = (e as { status?: number }).status;
    if (status !== 404) return groupmeErrorResponse(e, "Could not remove the bot.");
  }
  await deleteBotRow(group);
  return NextResponse.json({ ok: true });
}
