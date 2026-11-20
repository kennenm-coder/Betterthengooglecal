// The signed-in person's notification schedule (quiet hours / days off).
// GET              -> { schedule, timezone }
// PUT { schedule, timezone } -> saves it
//
// Any signed-in account, for their OWN schedule only: the email always comes
// from the session, never the body. Applies to every Duck Force buzz (see
// notify() in src/lib/notify-server.ts). Migration 070.

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getNotificationPrefs, saveNotificationPrefs } from "@/lib/notify-server";
import { isValidTimezone, normalizeSchedule, OFFICE_TIMEZONE } from "@/lib/quiet-hours";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, error } = await requireAuth();
  if (error || !user) return error ?? NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json(await getNotificationPrefs(user.email));
}

export async function PUT(req: Request) {
  const { user, error } = await requireAuth();
  if (error || !user) return error ?? NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const schedule = normalizeSchedule((body as { schedule?: unknown }).schedule);
  const tz = (body as { timezone?: unknown }).timezone;
  const timezone = isValidTimezone(tz) ? tz : OFFICE_TIMEZONE;

  const failed = await saveNotificationPrefs(user.email, schedule, timezone);
  if (failed) return NextResponse.json({ error: failed }, { status: 500 });
  return NextResponse.json({ ok: true, schedule, timezone });
}
