import { NextResponse, type NextRequest } from "next/server";
import { requireRole, getAdminClient } from "@/lib/auth";
import { holdsApproverRole, INBOX_ROLES } from "@/lib/kiosk-inbox";
import {
  findViewRow,
  isMissingRelation,
  logKioskEvent,
  reviewerName,
} from "@/lib/kiosk-inbox-server";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Approve or deny a time card adjustment, a form that needs approval, or a
 * recognition nomination.
 *
 * Time off does NOT come through here: it keeps its own route,
 * /api/time-off/[id]/decision, which also tells the kiosk to email the
 * employee.
 *
 * The person's roles are checked against the row's own `approver_roles`
 * here, on the server. The inbox only showing someone their rows is a
 * convenience; this is the gate.
 *
 * Every update is guarded on the row still being pending, so two approvers
 * clicking at once cannot both win: zero rows updated means somebody else
 * already decided it.
 *
 * Approving a nomination does NOT crown anybody. That stays in the kiosk.
 */
export async function POST(request: NextRequest) {
  const { user, error } = await requireRole(...INBOX_ROLES);
  if (error) return error;

  let body: { table?: string; id?: string; status?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }

  const table = body.table;
  const id = String(body.id ?? "");
  const status = body.status;
  const note = (body.note ?? "").trim().slice(0, 1000) || null;

  if (table !== "kiosk_time_card_requests" && table !== "kiosk_submissions") {
    return NextResponse.json(
      { error: "Time off is decided through its own route." },
      { status: 400 }
    );
  }
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Unknown item" }, { status: 400 });
  }
  if (status !== "approved" && status !== "denied") {
    return NextResponse.json(
      { error: "Decision must be approved or denied" },
      { status: 400 }
    );
  }

  try {
    const admin = getAdminClient();

    // What the row is and who may decide it, from the same view the inbox
    // reads, so the check matches what the approver was shown.
    const { row, error: findError } = await findViewRow(admin, table, id);
    if (findError) {
      if (isMissingRelation(findError)) {
        return NextResponse.json(
          { error: "The kiosk inbox is not set up in the database yet." },
          { status: 503 }
        );
      }
      throw new Error(findError.message);
    }
    if (!row) {
      return NextResponse.json({ error: "That item no longer exists." }, { status: 404 });
    }
    if (!holdsApproverRole(user!.roles, row.approver_roles)) {
      return NextResponse.json(
        { error: "You are not one of the people who can decide this." },
        { status: 403 }
      );
    }
    if (row.status !== "pending") {
      return NextResponse.json(
        { error: "That was already decided. Reload to see where it stands." },
        { status: 409 }
      );
    }

    const name = await reviewerName(admin, user!.email);
    const now = new Date().toISOString();

    let updated: { id: string } | null = null;
    if (table === "kiosk_time_card_requests") {
      const { data, error: updateError } = await admin
        .from("kiosk_time_card_requests")
        .update({
          status,
          // This column holds the reviewer's NAME (per the kiosk's contract).
          reviewed_by: name,
          reviewed_at: now,
          review_note: note,
        })
        .eq("id", id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (updateError) throw new Error(updateError.message);
      updated = data;
    } else {
      const { data, error: updateError } = await admin
        .from("kiosk_submissions")
        .update({
          review_status: status,
          reviewed_by: user!.email,
          reviewed_by_name: name,
          reviewed_at: now,
          review_note: note,
        })
        .eq("id", id)
        .eq("review_status", "pending")
        .select("id")
        .maybeSingle();
      if (updateError) throw new Error(updateError.message);
      updated = data;
    }

    if (!updated) {
      return NextResponse.json(
        { error: "Somebody already decided this. Reload to see where it stands." },
        { status: 409 }
      );
    }

    await logKioskEvent(admin, {
      submissionId: row.submission_id,
      eventType: `${row.kind}_${status}`,
      actor: name,
      referenceCode: row.reference_code,
      note,
    });

    return NextResponse.json({
      ok: true,
      status,
      reviewed_by_name: name,
      reviewed_at: now,
      review_note: note,
    });
  } catch (e) {
    console.error("[kiosk-inbox] decision failed", e);
    return NextResponse.json(
      { error: "Could not save the decision" },
      { status: 500 }
    );
  }
}
