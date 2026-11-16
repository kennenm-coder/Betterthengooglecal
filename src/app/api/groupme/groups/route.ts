import { NextResponse } from "next/server";
import { listGroups } from "@/lib/groupme";
import { chatContext, groupmeErrorResponse } from "@/lib/groupme-route";

export const runtime = "nodejs";

/**
 * The GroupMe groups the signed-in person's OWN account belongs to, for the
 * linking screen.
 *
 * This is the ONE place the full group list is exposed, and it is admin-only.
 * It includes the person's personal groups, so it must never be used to render
 * a conversation -- only to pick which group belongs to which installer. A
 * group can only be linked by someone who is in it.
 */
export async function GET() {
  const ctx = await chatContext();
  if (!ctx.ok) return ctx.response;

  try {
    const groups = await listGroups(ctx.token);
    return NextResponse.json({
      groups: groups
        .map((g) => ({ id: g.id, name: g.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (e) {
    return groupmeErrorResponse(e, "Could not load your GroupMe groups.");
  }
}
