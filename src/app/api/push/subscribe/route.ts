// Save or forget THIS device's phone-notification subscription.
// POST   { endpoint, keys: { p256dh, auth }, deviceLabel }  — Turn on
// DELETE { endpoint }                                       — Turn off
//
// The email always comes from the signed-in session, never the body, so a
// device can only ever be registered to the person using it.

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { removeSubscription, saveSubscription } from "@/lib/notify-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

export async function POST(req: Request) {
  const { user, error } = await requireAuth();
  if (error || !user) return error ?? NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const endpoint = str(body?.endpoint, 1000);
  const p256dh = str(body?.keys?.p256dh, 200);
  const auth = str(body?.keys?.auth, 200);
  if (!endpoint.startsWith("https://") || !p256dh || !auth) {
    return NextResponse.json({ error: "That isn't a valid push subscription." }, { status: 400 });
  }

  const failed = await saveSubscription(user.email, { endpoint, p256dh, auth }, str(body?.deviceLabel, 120));
  if (failed) return NextResponse.json({ error: failed }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { user, error } = await requireAuth();
  if (error || !user) return error ?? NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const endpoint = str(body?.endpoint, 1000);
  if (endpoint) await removeSubscription(user.email, endpoint);
  return NextResponse.json({ ok: true });
}
