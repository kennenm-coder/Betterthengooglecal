import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { requireAuth, getAdminClient } from "@/lib/auth";
import { dedupeRecipients } from "@/lib/email-recipients";
import type { JobCompletion } from "@/lib/job-complete";

// Same inbox the write-up notices fall back to (lib/action-settings.ts) -- kept
// as a literal here so this server route doesn't pull in the browser client.
const DEFAULT_WRITEUP_EMAIL = "fieldnotes@rbanwo.com";
import {
  OUTCOME_INFO,
  answerText,
  type JcOutcome,
  type JcQuestion,
} from "@/lib/job-complete-core";

// Nodemailer needs the Node runtime (not edge).
export const runtime = "nodejs";

/**
 * Email the right people that an install lead filed a Job Complete report
 * (migration 058). Same robot Gmail as the write-up notices (GMAIL_USER /
 * GMAIL_APP_PASSWORD; dormant until those are set).
 *
 * The caller sends ONLY the report's id. Who gets mailed and what it says are
 * both worked out here from the saved row -- so a phone can't pick recipients
 * (the phishing worry the write-up route spells out). Recipients come from the
 * NWO Hub setting (hub_app_settings: app "calendar", key
 * "job_complete_recipients": { complete: [], complete_issues: [], not_complete: [] }),
 * falling back to the write-up inbox. A report can only be mailed by the lead
 * who filed it, and only once per submit (a resubmit clears the stamp).
 */
export async function POST(request: Request) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  let id = "";
  try {
    const body = await request.json();
    id = typeof body?.id === "string" ? body.id : "";
  } catch {
    /* fall through */
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) {
    return NextResponse.json({ error: "Email sending is not configured on the server yet." }, { status: 503 });
  }

  const admin = getAdminClient();
  const { data: row, error: rowError } = await admin.from("job_completions").select("*").eq("id", id).maybeSingle();
  if (rowError || !row) return NextResponse.json({ error: "That report wasn't found." }, { status: 404 });
  const rep = row as JobCompletion;

  if ((rep.created_by || "").toLowerCase() !== (user!.email || "").toLowerCase()) {
    return NextResponse.json({ error: "Only the person who filed this report can send it." }, { status: 403 });
  }
  if (rep.emailed_at) return NextResponse.json({ success: true, alreadySent: true });

  // Recipients: the hub's setting for this outcome, else the write-up inbox.
  const valid = (e: unknown): e is string => typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
  let to: string[] = [];
  try {
    const { data: hub } = await admin
      .from("hub_app_settings")
      .select("value")
      .eq("app_slug", "calendar")
      .eq("key", "job_complete_recipients")
      .maybeSingle();
    const v = (hub?.value ?? {}) as Partial<Record<JcOutcome, unknown>>;
    const list = v[rep.outcome];
    if (Array.isArray(list)) to = list.filter(valid).map((e) => e.trim());
  } catch {
    /* use the fallback */
  }
  if (to.length === 0) {
    try {
      const { data: s } = await admin.from("action_settings").select("value").eq("key", "writeup_email_to").maybeSingle();
      if (Array.isArray(s?.value)) to = (s.value as unknown[]).filter(valid).map((e) => e.trim());
    } catch {
      /* use the default */
    }
  }
  if (to.length === 0) to = [DEFAULT_WRITEUP_EMAIL];
  const { to: finalTo } = dedupeRecipients(to, []);

  const info = OUTCOME_INFO[rep.outcome];
  const flagNote = rep.flagged && rep.outcome === "complete" ? " (flagged — a checklist answer needs a look)" : "";
  const subject = `Job ${rep.outcome === "complete" && !rep.flagged ? "complete" : info.tag.toLowerCase()}: ${rep.job_name || "Job"} · #${rep.order_number}`;
  const template: JcQuestion[] = Array.isArray(rep.template) ? rep.template : [];
  const lines = [
    `${info.label}${flagNote}`,
    "",
    `Job: ${rep.job_name || "—"}`,
    `Order #: ${rep.order_number}${rep.work_order_number ? `  (WO ${rep.work_order_number})` : ""}`,
    `Address: ${rep.address || "—"}`,
    `Install date: ${rep.install_date || "—"}`,
    `Crew: ${rep.crew_name || "—"}`,
    `Submitted by: ${rep.created_by_name || rep.created_by}`,
    "",
    ...template.map((q) => `${q.title}\n  ${answerText(q, rep.answers?.[q.id])}`),
    "",
    rep.flagged ? "Open the Write-Ups page in the calendar to review it and see the photos." : "Photos are on the Write-Ups page in the calendar.",
  ];

  try {
    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: gmailUser, pass: gmailPass } });
    await transporter.sendMail({
      from: `"${process.env.WRITEUP_FROM_NAME || "RbA Field Notes"}" <${gmailUser}>`,
      to: finalTo,
      replyTo: user!.email || undefined,
      subject,
      text: lines.join("\n"),
    });
    await admin.from("job_completions").update({ emailed_at: new Date().toISOString(), email_error: null }).eq("id", id);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "send failed";
    console.error("[job-complete/notify] send failed:", message);
    await admin.from("job_completions").update({ email_error: message.slice(0, 300) }).eq("id", id);
    return NextResponse.json({ error: "Failed to send email." }, { status: 502 });
  }
}
