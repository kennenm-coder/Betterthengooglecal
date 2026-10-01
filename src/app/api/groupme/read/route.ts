import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { markRead } from "@/lib/groupme";

export const runtime = "nodejs";

/**
 * Move this user's read bookmark for one installer.
 *
 * Called when someone opens a conversation and whenever new messages arrive
 * while they are looking at it -- so a chat you are actively watching never
 * builds up a phantom unread count.
 *
 * Stores an id and nothing else. See migration 026 for why that distinction
 * matters.
 */
export async function POST(request: Request) {
  const { user, error: authError } = await requireRole("admin");
  if (authError) return authError;

  let payload: { installer?: unknown; messageId?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const installer =
    typeof payload.installer === "string" ? payload.installer.trim() : "";
  const messageId =
    typeof payload.messageId === "string" ? payload.messageId.trim() : "";

  if (!installer || !messageId) {
    return NextResponse.json(
      { error: "Missing installer or message id." },
      { status: 400 }
    );
  }

  await markRead(user!.id, installer, messageId);
  return NextResponse.json({ ok: true });
}
