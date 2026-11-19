// A Write-Up Rep just submitted or edited a write-up → tell the field managers.
// POST { event: "submitted" | "edited", orderNumber, customerName }
//
// Called by the write-up form right after a rep's save succeeds. Only a rep
// (writeup-rep with no field-manager / admin role) triggers anything — the
// role is read from the session here, not trusted from the browser. Field
// managers get it in their bell and, if they turned it on, as a phone buzz.
// No email: edits are push + bell only, by decision (the submit email is the
// existing write-up email, unchanged).

import { NextResponse } from "next/server";
import { requireAuth, getAdminClient } from "@/lib/auth";
import { isWriteUpRepOnly } from "@/lib/roles";
import { emailsWithRole, notify } from "@/lib/notify-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "kennen.m@rbanwo.com" → "Kennen M." when no roster name is set. */
function shortName(email: string): string {
  const parts = email.split("@")[0].split(/[._\-\s]+/).filter(Boolean);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  if (parts.length === 0) return email;
  if (parts.length === 1) return cap(parts[0]);
  return `${cap(parts[0])} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

export async function POST(req: Request) {
  const { user, error } = await requireAuth();
  if (error || !user) return error;
  if (!isWriteUpRepOnly(user.roles)) return NextResponse.json({ ok: true, skipped: "not a rep" });

  const body = await req.json().catch(() => null);
  const event = body?.event === "edited" ? "edited" : body?.event === "submitted" ? "submitted" : null;
  const orderNumber = typeof body?.orderNumber === "string" ? body.orderNumber.slice(0, 60).trim() : "";
  const customer = typeof body?.customerName === "string" ? body.customerName.slice(0, 120).trim() : "";
  if (!event || !orderNumber) {
    return NextResponse.json({ error: "Missing event or order number." }, { status: 400 });
  }

  const { data: me } = await getAdminClient()
    .from("allowed_emails")
    .select("name")
    .eq("email", user.email.toLowerCase())
    .maybeSingle();
  const who = (me?.name as string | undefined)?.trim() || shortName(user.email);

  const managers = (await emailsWithRole(["field-manager"])).filter((e) => e !== user.email.toLowerCase());
  const job = customer ? `${customer} (${orderNumber})` : orderNumber;

  const res = await notify({
    emails: managers,
    kind: event === "edited" ? "writeup_rep_edited" : "writeup_rep_submitted",
    title: event === "edited" ? "Write-up edited — needs re-approval" : "New write-up to review",
    body: event === "edited" ? `${who} edited the write-up for ${job}.` : `${who} submitted a write-up for ${job}.`,
    url: "/work-orders",
    tag: `writeup-${orderNumber}`,
  });
  return NextResponse.json({ ok: true, ...res });
}
