import { NextResponse } from "next/server";
import { requireRole, getAdminClient } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the notification bell shows.
 *
 * Returns every pending request plus an `unseen` count — the ones that
 * arrived since this approver last opened the bell.
 *
 * The distinction matters: opening the bell clears the BADGE, not the queue.
 * Requests stay in the list until somebody actually decides them, so a
 * manager who glances and walks away has not accidentally dismissed anybody's
 * time off.
 */
export async function GET() {
  const { user, error } = await requireRole(
    "admin",
    "payroll-admin",
    "payroll-approver"
  );
  if (error) return error;

  try {
    const admin = getAdminClient();

    const { data: pending, error: pendingError } = await admin
      .from("time_off_requests")
      .select(
        "id, employee_name, department, start_date, end_date, start_time, end_time, request_type, reason, reference_code, signed_pdf_path, created_at"
      )
      .eq("status", "pending")
      .order("start_date", { ascending: true })
      .limit(100);

    if (pendingError) throw new Error(pendingError.message);

    const { data: seen } = await admin
      .from("time_off_notification_reads")
      .select("last_seen_at")
      .eq("email", user!.email.toLowerCase())
      .maybeSingle();

    const lastSeen = seen?.last_seen_at ? Date.parse(seen.last_seen_at) : 0;
    const rows = pending ?? [];

    // Never opened the bell? Everything is unseen.
    const unseen = lastSeen
      ? rows.filter((r) => Date.parse(r.created_at) > lastSeen).length
      : rows.length;

    return NextResponse.json({ requests: rows, unseen, total: rows.length });
  } catch (e) {
    console.error("[time-off] pending fetch failed", e);
    return NextResponse.json(
      { error: "Could not load pending requests" },
      { status: 500 }
    );
  }
}

/** Mark the queue as looked at. Clears this approver's badge only. */
export async function POST() {
  const { user, error } = await requireRole(
    "admin",
    "payroll-admin",
    "payroll-approver"
  );
  if (error) return error;

  try {
    const admin = getAdminClient();
    const now = new Date().toISOString();
    await admin.from("time_off_notification_reads").upsert(
      {
        email: user!.email.toLowerCase(),
        last_seen_at: now,
        updated_at: now,
      },
      { onConflict: "email" }
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    // A badge that fails to clear is a cosmetic problem, not a failed action.
    console.error("[time-off] could not mark the queue seen", e);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
