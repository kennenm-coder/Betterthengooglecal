import { NextResponse } from "next/server";
import { getGroupMembers } from "@/lib/groupme";
import { chatContext, groupmeErrorResponse } from "@/lib/groupme-route";

export const runtime = "nodejs";

/**
 * Who is in one linked group, so the composer can offer @-mentions.
 *
 * Same rule as the other routes: the client sends a chat NAME, the group is
 * resolved here, and the signed-in person's own account must be in it.
 */
export async function GET(request: Request) {
  const installer = new URL(request.url).searchParams.get("installer")?.trim();
  if (!installer) {
    return NextResponse.json({ error: "Missing installer." }, { status: 400 });
  }

  const ctx = await chatContext(installer);
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
