import { NextResponse } from "next/server";
import { listGroups, listPicks, savePicks } from "@/lib/groupme";
import { chatContext, groupmeErrorResponse } from "@/lib/groupme-route";

export const runtime = "nodejs";

/**
 * GET: every GroupMe group the signed-in person's OWN account is in, each
 * marked with whether they've ticked it to show in Chat. Feeds their
 * "Choose chats" checklist and nothing else. It includes personal groups,
 * which is why it is only ever shown to the person themself, and never used
 * to render a conversation.
 */
export async function GET() {
  const ctx = await chatContext();
  if (!ctx.ok) return ctx.response;

  try {
    const [groups, picks] = await Promise.all([
      listGroups(ctx.token),
      listPicks(ctx.user.id),
    ]);
    const picked = new Set(picks.map((p) => p.groupId));
    return NextResponse.json({
      groups: groups
        .map((g) => ({ id: g.id, name: g.name, picked: picked.has(g.id) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (e) {
    return groupmeErrorResponse(e, "Could not load your GroupMe groups.");
  }
}

/**
 * PUT { groupIds: string[] }: replace the person's ticked chats.
 *
 * Every id is checked against their own GroupMe account first, so nobody can
 * save a group they aren't in. Names come from GroupMe, not the browser.
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
  if (!ids) {
    return NextResponse.json({ error: "Missing groupIds." }, { status: 400 });
  }

  const ctx = await chatContext();
  if (!ctx.ok) return ctx.response;

  const chosen = Array.from(new Set(ids))
    .map((id) => {
      const g = ctx.myGroups.get(id);
      return g ? { id, name: g.name } : null;
    })
    .filter((g): g is { id: string; name: string } => !!g);

  try {
    await savePicks(ctx.user.id, chosen);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, count: chosen.length });
}
