import { NextResponse, type NextRequest } from "next/server";
import { requireRole, getAdminClient } from "@/lib/auth";
import { INBOX_ROLES } from "@/lib/kiosk-inbox";
import {
  kioskAppUrl,
  loadHistory,
  loadInboxItems,
  loadItemBySubmission,
  parseHistoryFilters,
} from "@/lib/kiosk-inbox-server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The kiosk approvals inbox: every kiosk submission (time off, time card
 * adjustments, forms that need approval, recognition nominations), read from
 * the kiosk's `kiosk_review_items` view.
 *
 *   GET                 pending rows this person can decide, plus `unseen`:
 *                       how many arrived since they last opened the bell.
 *   GET ?view=history   decided and record-only history they may see,
 *                       filtered and paged in the database:
 *                       kind, status, from, to (ISO), q (name / reference
 *                       code / nominee), page (0-based, 25 a page).
 *
 *   GET ?sub=<id>       one submission by its kiosk submission id, in any
 *                       status. This is where the link in a notification email
 *                       lands. `forbidden` is true when the person is not one
 *                       of that item's approver roles.
 *
 * Opening the bell clears the BADGE, not the queue: rows stay until somebody
 * decides them, so a glance never silently dismisses anybody's request.
 */
export async function GET(request: NextRequest) {
  const { user, error } = await requireRole(...INBOX_ROLES);
  if (error) return error;

  try {
    const admin = getAdminClient();

    const sub = request.nextUrl.searchParams.get("sub");
    if (sub) {
      if (!UUID.test(sub)) {
        return NextResponse.json({ item: null, forbidden: false, kind: null });
      }
      const found = await loadItemBySubmission(admin, user!, sub);
      return NextResponse.json({ ...found, kioskUrl: kioskAppUrl() });
    }

    if (request.nextUrl.searchParams.get("view") === "history") {
      const filters = parseHistoryFilters(request.nextUrl.searchParams);
      const history = await loadHistory(admin, user!, filters);
      return NextResponse.json({ ...history, kioskUrl: kioskAppUrl() });
    }

    const { items, viewMissing } = await loadInboxItems(admin, user!);

    const { data: seen } = await admin
      .from("time_off_notification_reads")
      .select("last_seen_at")
      .eq("email", user!.email.toLowerCase())
      .maybeSingle();
    const lastSeen = seen?.last_seen_at ? Date.parse(seen.last_seen_at) : 0;
    const decidable = items.filter((i) => i.can_decide);
    // Never opened the bell? Everything is unseen.
    const unseen = lastSeen
      ? decidable.filter((i) => Date.parse(i.submitted_at) > lastSeen).length
      : decidable.length;

    return NextResponse.json({
      items,
      unseen,
      viewMissing,
      kioskUrl: kioskAppUrl(),
    });
  } catch (e) {
    console.error("[kiosk-inbox] load failed", e);
    return NextResponse.json(
      { error: "Could not load the kiosk inbox" },
      { status: 500 }
    );
  }
}

/** Mark the inbox as looked at. Clears this person's badge only. */
export async function POST() {
  const { user, error } = await requireRole(...INBOX_ROLES);
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
    console.error("[kiosk-inbox] could not mark the inbox seen", e);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
