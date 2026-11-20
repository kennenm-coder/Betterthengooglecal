// The monthly Job Site Visit email (migration 078). Server only.
//
// The daily cron calls runSiteVisitReport() at noon Eastern. On the 1st of the
// month it emails every visit logged for LAST month to the addresses typed in
// the NWO Hub (Duck Force settings -> hub_app_settings app "calendar", key
// "site_visit_recipients": ["a@x.com", ...]). Same robot Gmail as every other
// Duck Force email (GMAIL_USER / GMAIL_APP_PASSWORD).
//
// job_site_visit_reports holds one row per month sent, so a second run (the
// cron's other call, a manual ?force=1, a retry) never sends a month twice.
// If nobody is on the list yet, nothing is sent and nothing is recorded, so
// adding addresses later and forcing a run still sends it.

import nodemailer from "nodemailer";
import { getAdminClient } from "@/lib/auth";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TZ = "America/New_York";

interface VisitRow {
  order_number: string;
  work_order_number: string | null;
  job_name: string;
  address: string | null;
  visit_date: string;
  notes: string;
  created_by: string;
  created_by_name: string | null;
}

/** Today's date at the office (YYYY-MM-DD). */
function officeToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** "2026-10" -> first day, first day of the next month, and "October 2026". */
function monthBounds(ym: string): { from: string; to: string; label: string } {
  const [y, m] = ym.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const label = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return { from: `${ym}-01`, to: `${next}-01`, label };
}

/** The month before the one `day` (YYYY-MM-DD) falls in. */
function previousMonth(day: string): string {
  const [y, m] = day.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** The Hub's list of addresses, cleaned up. Empty when nothing is set. */
export async function siteVisitRecipients(): Promise<string[]> {
  const admin = getAdminClient();
  const { data } = await admin
    .from("hub_app_settings")
    .select("value")
    .eq("app_slug", "calendar")
    .eq("key", "site_visit_recipients")
    .maybeSingle();
  const raw = Array.isArray(data?.value) ? (data!.value as unknown[]) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of raw) {
    if (typeof e !== "string") continue;
    const t = e.trim();
    if (!EMAIL_SHAPE.test(t) || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function fmtDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Send one month's email. `month` is "YYYY-MM". Returns what happened, in
 * words, for the cron's log.
 */
export async function sendSiteVisitReport(month: string, opts: { resend?: boolean } = {}): Promise<string> {
  const admin = getAdminClient();

  if (!opts.resend) {
    const { data: sent } = await admin.from("job_site_visit_reports").select("sent_at").eq("month", month).maybeSingle();
    if (sent) return `${month}: already sent ${sent.sent_at}`;
  }

  const to = await siteVisitRecipients();
  if (to.length === 0) return `${month}: not sent — no addresses in the NWO Hub's Site Visit email list yet`;

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) return `${month}: not sent — email isn't set up on the server`;

  const { from, to: until, label } = monthBounds(month);
  const { data, error } = await admin
    .from("job_site_visits")
    .select("order_number, work_order_number, job_name, address, visit_date, notes, created_by, created_by_name")
    .gte("visit_date", from)
    .lt("visit_date", until)
    .order("visit_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`reading visits: ${error.message}`);
  const visits = (data || []) as VisitRow[];

  const who = (v: VisitRow) => v.created_by_name || v.created_by.split("@")[0];

  // Body: a count per tech, then every visit in date order.
  const perTech = new Map<string, number>();
  for (const v of visits) perTech.set(who(v), (perTech.get(who(v)) || 0) + 1);
  const lines: string[] = [
    `Job site visits for ${label}: ${visits.length}`,
    "",
  ];
  if (visits.length === 0) {
    lines.push("No job site visits were logged last month.");
  } else {
    for (const [name, n] of Array.from(perTech.entries()).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${name}: ${n}`);
    }
    lines.push("", "────────────────────────────", "");
    for (const v of visits) {
      lines.push(
        `${fmtDay(v.visit_date)} — ${who(v)}`,
        `${v.job_name || "—"} · Job #${v.order_number}${v.work_order_number ? ` (WO ${v.work_order_number})` : ""}`,
        ...(v.address ? [v.address] : []),
        ...v.notes.split(/\r?\n/).map((l) => `  ${l}`),
        ""
      );
    }
    lines.push("The same list is attached as a spreadsheet (CSV).");
  }

  const csv = [
    ["Date", "Measure tech", "Job name", "Job #", "WO #", "Address", "Notes"].join(","),
    ...visits.map((v) =>
      [v.visit_date, who(v), v.job_name, v.order_number, v.work_order_number || "", v.address || "", v.notes]
        .map((c) => csvCell(String(c ?? "")))
        .join(",")
    ),
  ].join("\r\n");

  const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: gmailUser, pass: gmailPass } });
  await transporter.sendMail({
    from: `"${process.env.WRITEUP_FROM_NAME || "RbA Field Notes"}" <${gmailUser}>`,
    to,
    subject: `Job site visits — ${label} (${visits.length})`,
    text: lines.join("\n"),
    attachments: visits.length ? [{ filename: `job-site-visits-${month}.csv`, content: csv, contentType: "text/csv" }] : [],
  });

  await admin
    .from("job_site_visit_reports")
    .upsert({ month, sent_at: new Date().toISOString(), recipients: to, visit_count: visits.length }, { onConflict: "month" });
  return `${month}: sent ${visits.length} visit(s) to ${to.length} address(es)`;
}

/**
 * The cron's step. Sends last month's email on the 1st (office time). If the
 * 1st's send didn't go (Gmail down, no addresses yet), it tries again each day
 * through the 5th, then gives up so a month never arrives weeks late. With
 * `force` it sends last month's whatever the date — still only once.
 */
export async function runSiteVisitReport(opts: { force?: boolean; now?: Date } = {}): Promise<string> {
  const today = officeToday(opts.now ?? new Date());
  const dayOfMonth = Number(today.slice(8, 10));
  if (!opts.force && dayOfMonth > 5) return `skipped: only sends on the 1st–5th (${today})`;
  return sendSiteVisitReport(previousMonth(today));
}
