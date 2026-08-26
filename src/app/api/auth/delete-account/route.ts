import { NextResponse } from "next/server";
import { requireAuth, getAdminClient, isLastAdmin } from "@/lib/auth";

export async function DELETE() {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  // Prevent the last admin from deleting themselves
  if (user!.roles.includes("admin")) {
    const last = await isLastAdmin(user!.email);
    if (last) {
      return NextResponse.json(
        { error: "Cannot delete the last admin account. Promote another admin first." },
        { status: 400 }
      );
    }
  }

  try {
    const admin = getAdminClient();

    // Remove from allowlist
    await admin.from("allowed_emails").delete().eq("email", user!.email);

    // Delete the auth user
    const { error } = await admin.auth.admin.deleteUser(user!.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server configuration error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
