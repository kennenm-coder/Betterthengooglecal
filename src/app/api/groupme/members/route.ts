import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import {
  getGroupMembers,
  getSharedToken,
  resolveGroupId,
  GroupMeError,
} from "@/lib/groupme";

export const runtime = "nodejs";

/**
 * Who is in one installer's group, so the composer can offer @-mentions.
 *
 * Same rule as the other routes: the client sends an installer NAME and the
 * group is resolved here, so this can never list the members of a group that
 * isn't mapped to an installer.
 */
export async function GET(request: Request) {
  const { error: authError } = await requireRole("admin");
  if (authError) return authError;

  const installer = new URL(request.url).searchParams.get("installer")?.trim();
  if (!installer) {
    return NextResponse.json({ error: "Missing installer." }, { status: 400 });
  }

  const token = await getSharedToken();
  if (!token) {
    return NextResponse.json(
      { error: "GroupMe isn't connected yet." },
      { status: 428 }
    );
  }

  const groupId = await resolveGroupId(installer);
  if (!groupId) {
    return NextResponse.json(
      { error: `No GroupMe group is linked to ${installer} yet.` },
      { status: 404 }
    );
  }

  try {
    const members = await getGroupMembers(token, groupId);
    return NextResponse.json({
      members: members
        .map((m) => ({ userId: m.user_id, nickname: m.nickname }))
        .sort((a, b) => a.nickname.localeCompare(b.nickname)),
    });
  } catch (e) {
    const status = e instanceof GroupMeError ? e.status : 500;
    const message =
      e instanceof GroupMeError ? e.message : "Could not load group members.";
    return NextResponse.json({ error: message }, { status });
  }
}
