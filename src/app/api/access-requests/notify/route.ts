import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { getAdminClient } from "@/lib/auth";

// Nodemailer needs the Node runtime (not edge).
export const runtime = "nodejs";

/**
 * Tell the admin that someone just asked for an account.
 *
 * Called right after the login page inserts an access_requests row (both the
 * "Request Access" button and the sign-up flow's auto-request). The requester
 * is NOT signed in at that point, so unlike /api/writeups/notify this route
 * can't require auth. It is locked down instead by what it's allowed to do:
 *
 *   - the caller only sends an email address; everything in the message is
 *     read back out of the database, so nothing in the payload reaches the
 *     mailbox
 *   - the recipient is fixed server-side (env, defaulting to the admin), so a
 *     caller can never redirect the mail somewhere else
 *   - the row must already exist and be freshly created, so the endpoint can't
 *     be used to mail about made-up or long-settled requests
 *   - each address is remembered for the life of the server process, so a
 *     replayed call doesn't send a second copy
 *
 * The worst a stranger can do with it is re-announce a request that really is
 * sitting in the admin queue.
 *
 * Shares the generic-mailbox credentials with the write-up notification:
 *   GMAIL_USER          the robot Gmail address
 *   GMAIL_APP_PASSWORD  a Google "app password" for that account (16 chars)
 *   ACCESS_REQUEST_NOTIFY_TO  optional override for who gets told
 *   WRITEUP_FROM_NAME   optional display name (default "RbA Field Notes")
 */

/** Who hears about new requests when no override is set. */
const DEFAULT_NOTIFY_TO = "kennen.m@rbanwo.com";

/** A request older than this is treated as settled — no mail. */
const FRESH_WINDOW_MS = 10 * 60 * 1000;

/** Addresses already announced by this server process (replay guard). */
const announced = new Set<string>();

export async function POST(request: Request) {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) {
    // Not configured yet. The request itself is already saved, so this is only
    // a missing courtesy email — say so and let the caller move on.
    return NextResponse.json(
      { error: "Email sending is not configured on the server yet." },
      { status: 503 }
    );
  }

  let payload: { email?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email =
    typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email) {
    return NextResponse.json({ error: "Missing email." }, { status: 400 });
  }

  if (announced.has(email)) {
    return NextResponse.json({ success: true, skipped: "already-sent" });
  }

  // Everything that goes in the email comes from here, not from the caller.
  let admin;
  try {
    admin = getAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Server is missing its database service key." },
      { status: 503 }
    );
  }
  const { data: row, error: lookupError } = await admin
    .from("access_requests")
    .select("email, name, created_at")
    .eq("email", email)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json(
      { error: "Could not look up the request." },
      { status: 502 }
    );
  }
  if (!row) {
    return NextResponse.json(
      { error: "No pending request for that email." },
      { status: 404 }
    );
  }

  const createdAt = row.created_at ? Date.parse(row.created_at) : NaN;
  if (Number.isFinite(createdAt) && Date.now() - createdAt > FRESH_WINDOW_MS) {
    // An older row that's still waiting — already announced when it came in.
    return NextResponse.json({ success: true, skipped: "not-new" });
  }

  const notifyTo = process.env.ACCESS_REQUEST_NOTIFY_TO || DEFAULT_NOTIFY_TO;
  const fromName = process.env.WRITEUP_FROM_NAME || "RbA Field Notes";
  const who = row.name ? `${row.name} (${row.email})` : row.email;

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPass },
    });

    await transporter.sendMail({
      from: `"${fromName}" <${gmailUser}>`,
      to: notifyTo,
      subject: `New Duck Force account request — ${row.name || row.email}`,
      text: [
        `${who} asked for a Duck Force account.`,
        "",
        `Name:  ${row.name || "(not given)"}`,
        `Email: ${row.email}`,
        "",
        "Open Duck Force → Admin → Requests to approve or deny it.",
      ].join("\n"),
    });

    // Only remember it once the mail is actually away, so a failed send can be
    // retried. Cap the set so a long-lived process can't grow it forever.
    if (announced.size > 500) announced.clear();
    announced.add(email);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to send email.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
