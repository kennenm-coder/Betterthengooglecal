// The daily alarm clock. Vercel Cron calls this once a day (vercel.json) —
// the free plan allows once a day, which is all anything here needs.
//
// It's where TIME-based notifications go: nobody taps anything, so something
// has to wake up and look. Each job is one step below, and anything it sends
// goes through notify() — the same channel the instant notifications use.
//
// Today's jobs:
//   1. Job Alert: buzz + bell every field manager and admin, 5 business days
//      before an appointment with notes and again the business day before
//      (src/lib/job-alerts-server.ts)
//   2. clear bell history older than 90 days
//
// Auth: Vercel sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is
// set on the project. Without it this route refuses everyone, so it can't be
// triggered from outside.

import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { purgeOldNotifications } from "@/lib/notify-server";
import { runJobAlerts } from "@/lib/job-alerts-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || !header) return false;
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header);
  return want.length === got.length && timingSafeEqual(want, got);
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET isn't set on the server." }, { status: 503 });
  }
  if (!authorized(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }

  const ran: Record<string, unknown> = {};
  try {
    ran.jobAlerts = await runJobAlerts();
  } catch (err) {
    ran.jobAlertsError = (err as Error).message;
  }
  try {
    ran.purgedNotifications = await purgeOldNotifications(90);
  } catch (err) {
    ran.purgeError = (err as Error).message;
  }
  return NextResponse.json({ ok: true, at: new Date().toISOString(), ran });
}
