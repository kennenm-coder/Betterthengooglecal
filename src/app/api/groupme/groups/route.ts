import { NextResponse } from "next/server";
import { listPicks, savePicks } from "@/lib/groupme";
import { chatContext } from "@/lib/groupme-route";

export const runtime = "nodejs";

/**
 * GET: the chats this person may add to their Chat list, each marked with
 * whether it's ticked and how it's reached:
 *   - "office": office-account chats shared with one of their roles
 *     (migration 074) -- everyone with Chat access;
 *   - "personal": groups their OWN GroupMe is in -- admins who connected one.
 *     These include personal groups, which is why they're only ever shown to
 *     the person themself.
 * A group reachable both ways is offered as "personal", so an admin sends as
 * themselves there.
 */
export async function GET() {
  const ctx = await chatContext();
  if (!ctx.ok) return ctx.response;

  const picked = new Set((await listPicks(ctx.user.id)).map((p) => p.groupId));
  const out = new Map<string, { id: string; name: string; picked: boolean; source: "personal" | "office" }>();

  for (const [id, g] of ctx.personalGroups) {
    out.set(id, { id, name: g.name, picked: picked.has(id), source: "personal" });
  }
  for (const [id, chat] of ctx.shared) {
    if (out.has(id)) continue;
    const g = ctx.officeGroups.get(id);
    if (!g && !ctx.office) continue;
    out.set(id, {
      id,
      name: g?.name || chat.groupName || "GroupMe chat",
      picked: picked.has(id),
      source: "office",
    });
  }

  return NextResponse.json({
    groups: [...out.values()].sort((a, b) => a.name.localeCompare(b.name)),
  });
}

/**
 * PUT { groupIds: string[] }: replace the person's ticked chats. Each id is
 * checked here -- it must be one of THEIR personal groups or an office chat
 * shared with their roles -- and names come from GroupMe, not the browser.
 */
export async function PUT(request: Request) {
  let payload: { groupIds?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const ids = Array.isArray(payload.groupIds)
    ? payload.groupIds.filter((x): x is string => typeof x === "string")
    : null;
  if (!ids) return NextResponse.json({ error: "Missing groupIds." }, { status: 400 });

  const ctx = await chatContext();
  if (!ctx.ok) return ctx.response;

  const chosen: { id: string; name: string; source: "personal" | "office" }[] = [];
  for (const id of new Set(ids)) {
    const mine = ctx.personalGroups.get(id);
    if (mine) {
      chosen.push({ id, name: mine.name, source: "personal" });
      continue;
    }
    const shared = ctx.shared.get(id);
    if (shared && ctx.office) {
      const g = ctx.officeGroups.get(id);
      chosen.push({ id, name: g?.name || shared.groupName || "GroupMe chat", source: "office" });
    }
  }

  try {
    await savePicks(ctx.user.id, chosen);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, count: chosen.length });
}
