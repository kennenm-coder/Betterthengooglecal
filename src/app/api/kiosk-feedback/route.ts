import { NextResponse, type NextRequest } from "next/server";
import { requireRole, getAdminClient } from "@/lib/auth";
import { isMissingRelation, reviewerName } from "@/lib/kiosk-inbox-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUMNS =
  "id, feedback_number, category, message, anonymous, submitter_name, wants_discussion, contact, status, handled_by_name, handled_at, created_at";

/**
 * The kiosk's feedback, for the Feedback tab on the Payroll Admin page.
 *
 * Narrower than the rest of that page on purpose: admins and the `feedback`
 * role only. Feedback can be about anyone, payroll included, so being a payroll
 * admin is not enough. Read from the kiosk's kiosk_feedback table with the
 * service role AFTER this role check; the table has no browser access at all.
 *
 *   GET             the newest 200, any status (the tab filters).
 *   GET ?id=<uuid>  just that one, for the link in a notification email.
 *   PATCH           { id, status: "handled" | "new" } marks it handled, or
 *                   reopens it, recording who did.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireRole("admin", "feedback");
  if (error) return error;

  try {
    const id = request.nextUrl.searchParams.get("id");
    let query = getAdminClient()
      .from("kiosk_feedback")
      .select(COLUMNS)
      .order("created_at", { ascending: false })
      .limit(200);
    if (id) {
      if (!UUID.test(id)) return NextResponse.json({ items: [], tableMissing: false });
      query = query.eq("id", id);
    }

    const { data, error: queryError } = await query;
    if (queryError) {
      if (isMissingRelation(queryError)) {
        return NextResponse.json({ items: [], tableMissing: true });
      }
      throw new Error(queryError.message);
    }
    return NextResponse.json({ items: data ?? [], tableMissing: false });
  } catch (e) {
    console.error("[kiosk-feedback] load failed", e);
    return NextResponse.json({ error: "Could not load the feedback" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const { user, error } = await requireRole("admin", "feedback");
  if (error) return error;

  let body: { id?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }
  const id = String(body.id ?? "");
  if (!UUID.test(id) || (body.status !== "handled" && body.status !== "new")) {
    return NextResponse.json({ error: "Expected an id and a status" }, { status: 400 });
  }

  try {
    const admin = getAdminClient();
    const handled = body.status === "handled";
    const name = handled ? await reviewerName(admin, user!.email) : null;

    const { data, error: updateError } = await admin
      .from("kiosk_feedback")
      .update({
        status: body.status,
        // Who marked it, by login and by name, so there is never a question.
        handled_by: handled ? user!.email.toLowerCase() : null,
        handled_by_name: name,
        handled_at: handled ? new Date().toISOString() : null,
      })
      .eq("id", id)
      .select(COLUMNS)
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (!data) return NextResponse.json({ error: "That feedback no longer exists." }, { status: 404 });

    return NextResponse.json({ item: data });
  } catch (e) {
    console.error("[kiosk-feedback] update failed", e);
    return NextResponse.json({ error: "Could not save that" }, { status: 500 });
  }
}
