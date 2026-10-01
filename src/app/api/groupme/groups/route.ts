import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getSharedToken, listGroups, GroupMeError } from "@/lib/groupme";

export const runtime = "nodejs";

/**
 * The GroupMe groups the connected account belongs to, for the mapping screen.
 *
 * This is the ONE place the full group list is exposed, and it is admin-only.
 * It includes the person's personal groups, so it must never be used to render
 * a conversation -- only to pick which group belongs to which installer.
 */
export async function GET() {
  const { error: authError } = await requireRole("admin");
  if (authError) return authError;

  const token = await getSharedToken();
  if (!token) {
    return NextResponse.json(
      { error: "GroupMe isn't connected yet." },
      { status: 428 }
    );
  }

  try {
    const groups = await listGroups(token);
    return NextResponse.json({
      groups: groups
        .map((g) => ({ id: g.id, name: g.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (e) {
    const status = e instanceof GroupMeError ? e.status : 500;
    const message =
      e instanceof GroupMeError ? e.message : "Could not load your GroupMe groups.";
    return NextResponse.json({ error: message }, { status });
  }
}
