// Once-a-minute check for new GroupMe messages (vercel.json: "* * * * *").
// Buzzes each person's phone once per chat that has something new. All the
// work is in src/lib/groupme-buzz-server.ts.
//
// Auth: same as /api/cron/daily -- Vercel sends `Authorization: Bearer
// <CRON_SECRET>`, and without that this route refuses everyone.

import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { runGroupMeBuzz } from "@/lib/groupme-buzz-server";
import { isTokenCryptoConfigured } from "@/lib/groupme-crypto";

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
  if (!isTokenCryptoConfigured()) {
    return NextResponse.json({ skipped: "GroupMe isn't set up on the server." });
  }

  try {
    return NextResponse.json(await runGroupMeBuzz());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
