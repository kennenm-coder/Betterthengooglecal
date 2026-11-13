import { NextResponse, type NextRequest } from "next/server";
import { requireRole, getAdminClient } from "@/lib/auth";
import { DECISION_TABLES, holdsApproverRole, INBOX_ROLES, type DecisionTable } from "@/lib/kiosk-inbox";
import { findViewRow, isMissingRelation } from "@/lib/kiosk-inbox-server";

export const runtime = "nodejs";

/** How long the download link stays valid. Long enough to click, not to share. */
const SIGNED_URL_TTL_SECONDS = 300;

const TIME_OFF_APPROVERS = ["admin", "payroll-admin", "payroll-approver"];

/**
 * Open the signed PDF behind any inbox row.
 *
 * The PDF lives in the kiosk's private `kiosk-signed` bucket, reachable only
 * with the service-role key. Only someone who could see the row in the inbox
 * (one of its approver roles, or admin) gets a link, and the link dies in
 * five minutes.
 *
 *   GET /api/kiosk-inbox/pdf?table=<decision_table>&id=<item_id>
 */
export async function GET(request: NextRequest) {
  const { user, error } = await requireRole(...INBOX_ROLES);
  if (error) return error;

  const table = request.nextUrl.searchParams.get("table") as DecisionTable | null;
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!table || !DECISION_TABLES.includes(table) || !id) {
    return NextResponse.json({ error: "Unknown item" }, { status: 400 });
  }

  try {
    const admin = getAdminClient();
    const { row, error: findError } = await findViewRow(admin, table, id);
    let pdfPath: string | null = null;

    if (findError) {
      if (!isMissingRelation(findError)) throw new Error(findError.message);
      // Before the kiosk's migration 009 the inbox is time off only; read
      // that table directly, for the people who decide time off.
      if (
        table !== "time_off_requests" ||
        !holdsApproverRole(user!.roles, TIME_OFF_APPROVERS)
      ) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const { data: t, error: tError } = await admin
        .from("time_off_requests")
        .select("signed_pdf_path")
        .eq("id", id)
        .maybeSingle();
      if (tError) throw new Error(tError.message);
      pdfPath = t?.signed_pdf_path ?? null;
    } else {
      if (!row || !holdsApproverRole(user!.roles, row.approver_roles)) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      pdfPath = row.pdf_path;
    }

    if (!pdfPath) {
      return NextResponse.json(
        { error: "This submission has no signed PDF." },
        { status: 404 }
      );
    }

    const { data, error: storageError } = await admin.storage
      .from("kiosk-signed")
      .createSignedUrl(pdfPath, SIGNED_URL_TTL_SECONDS);

    if (storageError || !data?.signedUrl) {
      return NextResponse.json(
        { error: "The stored PDF could not be reached." },
        { status: 502 }
      );
    }

    return NextResponse.redirect(data.signedUrl);
  } catch (e) {
    console.error("[kiosk-inbox] signed pdf fetch failed", e);
    return NextResponse.json(
      { error: "Could not fetch the signed PDF" },
      { status: 500 }
    );
  }
}
