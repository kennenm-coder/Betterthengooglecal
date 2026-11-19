// ─── Job Alert sending (server only, run by the daily cron) ────────────────
//
// Each weekday morning: every Job Alert whose appointment is 5 workdays out or
// closer (and hasn't been reminded for that date yet) is emailed to the person
// who wrote it, and sent through notify() for the phone buzz + bell. The
// appointment date is read fresh from work_orders, so a rescheduled job's
// reminder follows it. Date rules: src/lib/job-alert-dates.ts. Table: 064.

import nodemailer from "nodemailer";
import { getAdminClient } from "@/lib/auth";
import { notify } from "@/lib/notify-server";
import { appointmentDate, isDue, shortDay, todayAtOffice } from "@/lib/job-alert-dates";

interface AlertRow {
  id: string;
  work_order_id: string;
  note: string;
  created_by: string;
  sent_for_date: string | null;
}
interface OrderRow {
  id: string;
  order_number: string | null;
  customer_name: string | null;
  address: string | null;
  work_order_type: string | null;
  scheduled_start: string | null;
}

export interface JobAlertRun {
  checked: number;
  sent: number;
  emailFailed: number;
  skippedWeekend?: boolean;
}

function timeOf(scheduledStart: string | null): string {
  const m = scheduledStart?.match(/[T ](\d{2}):(\d{2})/);
  if (!m) return "";
  const h = Number(m[1]);
  if (h === 0 && m[2] === "00") return "";
  return ` at ${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

export async function runJobAlerts(origin: string, now: Date = new Date()): Promise<JobAlertRun> {
  const today = todayAtOffice(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) return { checked: 0, sent: 0, emailFailed: 0, skippedWeekend: true };

  const admin = getAdminClient();
  const { data: alerts } = await admin
    .from("job_alerts")
    .select("id, work_order_id, note, created_by, sent_for_date");
  const list = (alerts || []) as AlertRow[];
  const run: JobAlertRun = { checked: list.length, sent: 0, emailFailed: 0 };
  if (list.length === 0) return run;

  const ids = [...new Set(list.map((a) => a.work_order_id))];
  const orders = new Map<string, OrderRow>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin
      .from("work_orders")
      .select("id, order_number, customer_name, address, work_order_type, scheduled_start")
      .in("id", ids.slice(i, i + 200));
    for (const o of (data || []) as OrderRow[]) orders.set(o.id, o);
  }

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  const transporter =
    gmailUser && gmailPass ? nodemailer.createTransport({ service: "gmail", auth: { user: gmailUser, pass: gmailPass } }) : null;

  for (const a of list) {
    const o = orders.get(a.work_order_id);
    const appt = appointmentDate(o?.scheduled_start);
    if (!o || !isDue(appt, a.sent_for_date, today)) continue;

    const customer = o.customer_name || "a customer";
    const when = `${shortDay(appt!)}${timeOf(o.scheduled_start)}`;
    const link = `${origin}/?order=${encodeURIComponent(o.id)}`;
    const kind = o.work_order_type ? ` (${o.work_order_type})` : "";

    let emailError: string | null = null;
    if (transporter) {
      try {
        await transporter.sendMail({
          from: `"${process.env.WRITEUP_FROM_NAME || "RbA Field Notes"}" <${gmailUser}>`,
          to: a.created_by,
          subject: `Job Alert: ${customer} — ${when}`,
          text: [
            "Your Job Alert from Duck Force — this appointment is 5 workdays out.",
            "",
            `Customer: ${customer}`,
            `Address: ${o.address || "—"}`,
            `Order: ${o.order_number || "—"}${kind}`,
            `Appointment: ${when}`,
            "",
            "Your note:",
            a.note,
            "",
            `Open the job: ${link}`,
          ].join("\n"),
        });
      } catch (err) {
        emailError = (err as Error).message || "send failed";
        run.emailFailed += 1;
      }
    } else {
      emailError = "Gmail isn't set up on the server (GMAIL_USER / GMAIL_APP_PASSWORD).";
      run.emailFailed += 1;
    }

    await notify({
      emails: [a.created_by],
      kind: "job_alert",
      title: `Job Alert: ${customer}`,
      body: `${when}. ${a.note}`.slice(0, 240),
      url: `/?order=${encodeURIComponent(o.id)}`,
      tag: `job-alert-${o.id}`,
    });

    // Recorded as sent even if only the bell/buzz went out, so a broken email
    // setting doesn't repeat the reminder every morning; send_error says why.
    await admin
      .from("job_alerts")
      .update({ sent_at: new Date().toISOString(), sent_for_date: appt, send_error: emailError })
      .eq("id", a.id);
    run.sent += 1;
  }
  return run;
}
