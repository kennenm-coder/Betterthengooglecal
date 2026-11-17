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
 * Hand the submission id to the kiosk app. It re-reads the decision itself, so
 * this call cannot be used to tell someone something that did not happen.
 */
async function notifyKiosk(submissionId: string): Promise<void> {
  const base = process.env.KIOSK_APP_URL?.replace(/\/+$/, "");
  const secret = process.env.KIOSK_INTERNAL_SECRET;
  if (!base || !secret) {
    console.warn(
      "[kiosk-inbox] KIOSK_APP_URL / KIOSK_INTERNAL_SECRET not set — the submitter is emailed on the kiosk's next sweep"
    );
    return;
  }
  try {
    const res = await fetch(`${base}/api/decisions/notify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ submissionId }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error("[kiosk-inbox] kiosk refused the decision ping", res.status);
  } catch (e) {
    console.error("[kiosk-inbox] could not reach the kiosk", e);
  }
}

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

    // Tell the person who submitted it. A denial carries the reason and a
    // one-off link to fix it and resubmit. Nominations are not emailed (the
    // nominator is often anonymous). Best-effort: the decision is already saved,
    // and the kiosk's own sweep catches a ping that does not land.
    if (row.submission_id && (row.kind === "time_card" || row.kind === "form")) {
      await notifyKiosk(row.submission_id);
    }

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
