import { NextResponse, type NextRequest } from "next/server";
import { requireRole, getAdminClient } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Approve or deny a time-off request.
 *
 * Server-side rather than a client update, for three reasons:
 *
 *   1. The approver's display NAME is recorded alongside their email, and the
 *      name comes from the roster, which a browser should not have to read.
 *   2. The decision is guarded on `status = 'pending'`, so two managers
 *      clicking at the same moment cannot both appear to have won.
 *   3. The kiosk is told immediately afterwards, so it can email the employee
 *      while they still remember asking.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireRole(
    "admin",
    "payroll-admin",
    "payroll-approver"
  );
  if (error) return error;

  const { id } = await params;

  let body: { status?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }

  const status = body.status;
  const note = (body.note ?? "").trim().slice(0, 1000);

  if (status !== "approved" && status !== "denied") {
    return NextResponse.json(
      { error: "Decision must be approved or denied" },
      { status: 400 }
    );
  }

  // A denial without a reason is the thing people complain about, and the
  // note is what the employee actually receives. Required.
  if (status === "denied" && note.length < 3) {
    return NextResponse.json(
      { error: "Say why it was denied — the employee is sent this note." },
      { status: 400 }
    );
  }

  try {
    const admin = getAdminClient();

    // The display name as it is right now, stored on the row. Someone who
    // later leaves or is renamed must still be the name on this decision.
    const { data: approver } = await admin
      .from("allowed_emails")
      .select("name")
      .eq("email", user!.email.toLowerCase())
      .maybeSingle();

    const reviewedByName =
      String(approver?.name || "").trim() || user!.email;

    const { data, error: updateError } = await admin
      .from("time_off_requests")
      .update({
        status,
        reviewed_by: user!.email,
        reviewed_by_name: reviewedByName,
        reviewed_at: new Date().toISOString(),
        review_note: note || null,
      })
      .eq("id", id)
      .eq("status", "pending")
      .select()
      .maybeSingle();

    if (updateError) throw new Error(updateError.message);

    if (!data) {
      return NextResponse.json(
        {
          error:
            "That request was already decided. Reload to see where it stands.",
        },
        { status: 409 }
      );
    }

    // Tell the kiosk so it can email the employee. Best-effort on purpose:
    // the decision is already saved, and the kiosk's own cron sweep picks up
    // anything this call fails to deliver. A mail problem must never make an
    // approval look like it failed.
    void notifyKiosk(id);

    return NextResponse.json({ request: data });
  } catch (e) {
    console.error("[time-off] decision failed", e);
    return NextResponse.json(
      { error: "Could not save the decision" },
      { status: 500 }
    );
  }
}

/**
 * Hand the request id to the kiosk app. It re-reads the decision itself, so
 * this call cannot be used to tell an employee something that did not happen.
 */
async function notifyKiosk(requestId: string): Promise<void> {
  const base = process.env.KIOSK_APP_URL?.replace(/\/+$/, "");
  const secret = process.env.KIOSK_INTERNAL_SECRET;

  if (!base || !secret) {
    // Not an error worth failing on: the kiosk's cron sweep is the fallback.
    console.warn(
      "[time-off] KIOSK_APP_URL / KIOSK_INTERNAL_SECRET not set — the employee email waits for the kiosk's next sweep"
    );
    return;
  }

  try {
    const res = await fetch(`${base}/api/time-off/decision`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requestId }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error("[time-off] kiosk refused the decision ping", res.status);
    }
  } catch (e) {
    console.error("[time-off] could not reach the kiosk", e);
  }
}
