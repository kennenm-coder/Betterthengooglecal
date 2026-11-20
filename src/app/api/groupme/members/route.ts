import { NextResponse } from "next/server";
import { getGroupMembers } from "@/lib/groupme";
import { peopleForChat } from "@/lib/groupme-office";
import { chatContext, groupmeErrorResponse } from "@/lib/groupme-route";

export const runtime = "nodejs";

/**
 * Who can be @mentioned in one chat:
 *   members  GroupMe members of the group (GroupMe notifies them itself).
 *            The office account is left out -- mentioning it would mean
 *            mentioning everyone who uses it.
 *   people   Duck Force people who can see this chat through the office
 *            account (migration 074). Mentioning one buzzes THAT Duck Force
 *            account, even though in GroupMe it's all one office account.
 */
export async function GET(request: Request) {
  const group = new URL(request.url).searchParams.get("group")?.trim();
  if (!group) {
    return NextResponse.json({ error: "Missing group." }, { status: 400 });
  }

  const ctx = await chatContext(group);
  if (!ctx.ok) return ctx.response;

  try {
    const officeId = ctx.office?.groupmeUserId ?? null;
    const [members, people] = await Promise.all([
      getGroupMembers(ctx.token, ctx.groupId!),
      peopleForChat(ctx.groupId!),
    ]);
    const me = ctx.user.email.toLowerCase();
    return NextResponse.json({
      members: members
        .filter((m) => !officeId || m.user_id !== officeId)
        .map((m) => ({ userId: m.user_id, nickname: m.nickname }))
        .sort((a, b) => a.nickname.localeCompare(b.nickname)),
      people: people
        .filter((p) => p.email !== me)
        .map((p) => ({ email: p.email, name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (e) {
    return groupmeErrorResponse(e, "Could not load group members.");
  }
}
