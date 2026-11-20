import { NextResponse } from "next/server";
import { CHAT_ROLES } from "@/lib/roles";
import { requireRole } from "@/lib/auth";
import { markRead } from "@/lib/groupme";

export const runtime = "nodejs";

/**
 * Move this user's read bookmark for one of their chosen groups.
 *
 * Called when someone opens a conversation and whenever new messages arrive
 * while they are looking at it -- so a chat you are actively watching never
 * builds up a phantom unread count.
 *
 * Stores an id and nothing else, and only on a row the user already owns
 * (markRead updates their own groupme_chat_picks row; it never creates one).
 */
export async function POST(request: Request) {
  const { user, error: authError } = await requireRole(...CHAT_ROLES);
  if (authError) return authError;

  let payload: { group?: unknown; messageId?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const group = typeof payload.group === "string" ? payload.group.trim() : "";
  const messageId =
    typeof payload.messageId === "string" ? payload.messageId.trim() : "";

  if (!group || !messageId) {
    return NextResponse.json(
      { error: "Missing group or message id." },
      { status: 400 }
    );
  }

  await markRead(user!.id, group, messageId);
  return NextResponse.json({ ok: true });
}
