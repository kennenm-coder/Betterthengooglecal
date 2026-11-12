import { NextResponse } from "next/server";
import { requireAuth, getAdminClient } from "@/lib/auth";
import { stampWriteUpKinds } from "@/lib/writeup-kind-stamp";

/**
 * Stamp JIP / Service on one job's new write-ups (src/lib/writeup-kind.ts),
 * called right after a write-up is submitted so the answer is on the row
 * before the trim order it hands over is printed — without waiting for the
 * next hourly import, which would stamp it anyway.
 *
 * Body: { orderNumber }. Any signed-in user may ask: it only fills in blanks
 * with the one rule, never changes a stored answer, and touches only that
 * job's write-ups. Runs as the service role because judging "the job closed"
 * reads the import ledger, which no user can read.
 */
export async function POST(request: Request) {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  let orderNumber = "";
  try {
    const body = await request.json();
    orderNumber = typeof body?.orderNumber === "string" ? body.orderNumber.trim() : "";
  } catch {
    /* falls through to the 400 */
  }
  if (!orderNumber) return NextResponse.json({ error: "orderNumber is required." }, { status: 400 });

  try {
    const summary = await stampWriteUpKinds(getAdminClient(), { orderNumbers: [orderNumber] });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not stamp the write-up.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
