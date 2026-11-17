import { NextResponse, type NextRequest } from "next/server";
import { requireRole, getAdminClient } from "@/lib/auth";
import { isMissingRelation } from "@/lib/kiosk-inbox-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUMNS =
  "id, sheet_number, employee_name, department, item, quantity, quantity_unit, item_url, reason, timeline, notes, submitted_at, sheet_status";

/**
 * The supply-request log on the Payroll Admin page.
 *
 * Supply requests asked for at the kiosk are a RECORD, not a decision: the
 * office orders from the supplies sheet, and nobody approves or denies them
 * here (yet; the kiosk's docs/SUPPLY-REQUEST-PLAN.md notes approval steps as a
 * future addition). So this is a read-only list of the latest requests, with
 * whether each has reached the sheet.
 *
 *   GET             the newest 100.
 *   GET ?id=<uuid>  just that one, for the link in a notification email.
 *
 * Read from the kiosk's own table with the service role after the role check,
 * like the rest of the kiosk inbox.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireRole("admin", "payroll-admin");
  if (error) return error;

  try {
    const admin = getAdminClient();
    const id = request.nextUrl.searchParams.get("id");

    let query = admin
      .from("kiosk_supply_requests")
      .select(COLUMNS)
      .order("submitted_at", { ascending: false })
      .limit(100);
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
    console.error("[kiosk-supplies] load failed", e);
    return NextResponse.json(
      { error: "Could not load the supply requests" },
      { status: 500 }
    );
  }
}
