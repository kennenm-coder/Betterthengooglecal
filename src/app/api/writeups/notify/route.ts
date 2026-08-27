import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { requireAuth } from "@/lib/auth";

// Nodemailer needs the Node runtime (not edge).
export const runtime = "nodejs";

/**
 * Send the "field write-up submitted" notification email from a generic
 * automation mailbox (a dedicated Gmail), so it no longer depends on the
 * user's own mail app actually sending a mailto: draft.
 *
 * The sender is generic; the submitting user is logged two ways:
 *   - Reply-To is set to their email (replies route back to them)
 *   - the body already carries "Submitted by: …"
 *
 * This path is fully separate from Supabase Auth email (password resets), so
 * write-up volume can never eat into that budget.
 *
 * Env (set in .env.local locally and in Vercel → Settings → Environment Variables):
 *   GMAIL_USER          the robot Gmail address (e.g. rbafieldnotes@gmail.com)
 *   GMAIL_APP_PASSWORD  a Google "app password" for that account (16 chars)
 *   WRITEUP_FROM_NAME   optional display name (default "RbA Field Notes")
 */
export async function POST(request: Request) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) {
    // Not configured yet — surface it clearly so the UI keeps the write-up
    // saved and shows "email didn't send" instead of silently failing.
    return NextResponse.json(
      { error: "Email sending is not configured on the server yet." },
      { status: 503 }
    );
  }

  let payload: {
    to?: unknown;
    cc?: unknown;
    subject?: unknown;
    body?: unknown;
  };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const toEmail = (v: unknown): string[] =>
    (Array.isArray(v) ? v : [])
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean);

  const to = toEmail(payload.to);
  const cc = toEmail(payload.cc);
  const subject = typeof payload.subject === "string" ? payload.subject : "";
  const body = typeof payload.body === "string" ? payload.body : "";

  if (to.length === 0 || !subject || !body) {
    return NextResponse.json(
      { error: "Missing recipient, subject, or body." },
      { status: 400 }
    );
  }

  const fromName = process.env.WRITEUP_FROM_NAME || "RbA Field Notes";

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPass },
    });

    await transporter.sendMail({
      from: `"${fromName}" <${gmailUser}>`,
      to,
      cc: cc.length ? cc : undefined,
      // Reply-To = the submitter, so the generic sender still routes replies
      // back to the person who wrote it up.
      replyTo: user!.email || undefined,
      subject,
      text: body,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to send email.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
