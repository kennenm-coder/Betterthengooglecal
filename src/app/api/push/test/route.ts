// "Send me a test" under Settings → Phone notifications. Goes through the real
// channel (bell row + push to the caller's own devices), so a buzz here means
// real notifications will arrive too.

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { notify } from "@/lib/notify-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const { user, error } = await requireAuth();
  if (error || !user) return error;

  const res = await notify({
    emails: [user.email],
    kind: "test",
    title: "Duck Force test",
    body: "Notifications are working on this device.",
    url: "/settings",
    tag: "test",
  });

  if (!res.pushConfigured) {
    return NextResponse.json(
      { ok: false, error: "Phone buzzes aren't set up on the server yet (the push keys are missing). It's in your bell." },
      { status: 503 }
    );
  }
  if (res.pushed === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          res.pruned > 0
            ? "This device's subscription had expired and was cleared. Tap Turn on again."
            : "No device is turned on for your account yet. Tap Turn on first.",
      },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true, pushed: res.pushed });
}
