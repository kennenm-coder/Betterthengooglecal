import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { requireAuth, getAdminClient } from "@/lib/auth";
import { dedupeRecipients } from "@/lib/email-recipients";

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
 *   WRITEUP_ALLOWED_DOMAINS
 *                       optional comma-separated domains that may receive these
 *                       notifications on top of the roster (e.g. "rbanwo.com")
 *
 * RECIPIENTS ARE RESTRICTED SERVER-SIDE. The caller supplies to/cc, so without
 * a check any allowlisted user could send arbitrary mail to any address in the
 * world from the company's robot mailbox — a phishing primitive wearing our own
 * domain, and a fast way to get the Gmail account suspended. A recipient must
 * therefore be one of:
 *   - an address on the `allowed_emails` roster (a team member), or
 *   - an address an admin put in someone's `auto_cc` (a known external), or
 *   - on a domain listed in WRITEUP_ALLOWED_DOMAINS.
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

  // Dedupe as a backstop so an address never lands on both To and CC, even if a
  // caller forgets to (To wins). Clients dedupe too; this guarantees it.
  const { to, cc } = dedupeRecipients(toEmail(payload.to), toEmail(payload.cc));
  const subject = typeof payload.subject === "string" ? payload.subject : "";
  const body = typeof payload.body === "string" ? payload.body : "";

  if (to.length === 0 || !subject || !body) {
    return NextResponse.json(
      { error: "Missing recipient, subject, or body." },
      { status: 400 }
    );
  }

  // ── Recipient allowlist (see the note above) ──────────────────────────────
  // Service role: this needs every roster row, and a normal user can only read
  // their own under RLS.
  let permitted: Set<string>;
  try {
    const admin = getAdminClient();
    const { data: roster, error: rosterError } = await admin
      .from("allowed_emails")
      .select("email, auto_cc");
    if (rosterError) throw new Error(rosterError.message);

    permitted = new Set<string>();
    for (const row of roster ?? []) {
      if (typeof row.email === "string" && row.email.trim()) {
        permitted.add(row.email.trim().toLowerCase());
      }
      for (const entry of Array.isArray(row.auto_cc) ? row.auto_cc : []) {
        if (typeof entry === "string" && entry.trim()) {
          permitted.add(entry.trim().toLowerCase());
        }
      }
    }
  } catch (err) {
    // Fail CLOSED. If we can't tell who is allowed, we don't send — the
    // write-up itself is already saved, and the UI shows "email didn't send".
    console.error(
      "[writeups/notify] could not load the recipient allowlist:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "Could not verify the recipients. The write-up was saved; try the email again." },
      { status: 503 }
    );
  }

  const allowedDomains = (process.env.WRITEUP_ALLOWED_DOMAINS || "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  const isPermitted = (address: string): boolean => {
    const a = address.trim().toLowerCase();
    if (permitted.has(a)) return true;
    const at = a.lastIndexOf("@");
    return at > 0 && allowedDomains.includes(a.slice(at + 1));
  };

  const rejected = [...to, ...cc].filter((a) => !isPermitted(a));
  if (rejected.length > 0) {
    return NextResponse.json(
      {
        error:
          `These addresses aren't approved to receive field notes: ${rejected.join(", ")}. ` +
          `Add the person to the Team list, add the address to someone's CC list on the Admin page, ` +
          `or add its domain to WRITEUP_ALLOWED_DOMAINS.`,
      },
      { status: 403 }
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
    console.error(
      "[writeups/notify] send failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json({ error: "Failed to send email." }, { status: 502 });
  }
}
