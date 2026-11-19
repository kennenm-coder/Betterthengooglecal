import { NextResponse } from "next/server";
import { getGroupMembers } from "@/lib/groupme";
import { chatContext, groupmeErrorResponse } from "@/lib/groupme-route";

export const runtime = "nodejs";

/**
 * Who is in one of the person's chosen groups, so the composer can offer
 * @-mentions. chatContext checks they ticked it and are in it.
 */
export async function GET(request: Request) {
  const group = new URL(request.url).searchParams.get("group")?.trim();
  if (!group) {
    return NextResponse.json({ error: "Missing group." }, { status: 400 });
  }

  const ctx = await chatContext(group);
  if (!ctx.ok) return ctx.response;

  try {
    const members = await getGroupMembers(ctx.token, ctx.groupId!);
    return NextResponse.json({
      members: members
        .map((m) => ({ userId: m.user_id, nickname: m.nickname }))
        .sort((a, b) => a.nickname.localeCompare(b.nickname)),
    });
  } catch (e) {
    return groupmeErrorResponse(e, "Could not load group members.");
  }
}
