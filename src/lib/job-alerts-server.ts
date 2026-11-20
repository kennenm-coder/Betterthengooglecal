// ─── Job Alert buzzes (server only, run by the daily cron) ─────────────────
//
// Each weekday morning, for every appointment that has Job Alert notes: if
// it's 5 business days out, or the business day before, ONE notification goes
// to everyone in that job's group — a phone buzz plus a bell entry, no email
// (Kennen, 2026-11-19). Two groups (migration 071, 2026-11-20): Tech Measure
// jobs buzz every measure tech and admin; every other job buzzes every field
// manager and admin. It lists every note on the job with who wrote it.
// The appointment date is read fresh from work_orders, so a rescheduled job
// buzzes for its new date. Date rules: src/lib/job-alert-dates.ts.
// Tables: 064 + 065 + 066 + 071.

import { getAdminClient } from "@/lib/auth";
import { emailsWithRole, notify } from "@/lib/notify-server";
import { appointmentDate, dueStage, shortDay, todayAtOffice, type JobAlertStage } from "@/lib/job-alert-dates";

interface AlertRow {
  id: string;
  work_order_id: string;
  note: string;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  sent5_for_date: string | null;
  sent1_for_date: string | null;
  audience: string | null;
}
interface OrderRow {
  id: string;
  customer_name: string | null;
  scheduled_start: string | null;
}

export interface JobAlertRun {
  jobs: number;
  buzzed: number;
  skippedWeekend?: boolean;
}

function timeOf(scheduledStart: string | null): string {
  const m = scheduledStart?.match(/[T ](\d{2}):(\d{2})/);
  if (!m) return "";
  const h = Number(m[1]);
  if (h === 0 && m[2] === "00") return "";
  return ` at ${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** "kennen.m@rbanwo.com" → "Kennen M." when no roster name was saved. */
function shortName(email: string): string {
  const parts = email.split("@")[0].split(/[._\-\s]+/).filter(Boolean);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  if (parts.length === 0) return email;
  if (parts.length === 1) return cap(parts[0]);
  return `${cap(parts[0])} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

export async function runJobAlerts(now: Date = new Date()): Promise<JobAlertRun> {
  const today = todayAtOffice(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) return { jobs: 0, buzzed: 0, skippedWeekend: true };

  const admin = getAdminClient();
  const { data } = await admin
    .from("job_alerts")
    .select("id, work_order_id, note, created_by, created_by_name, created_at, sent5_for_date, sent1_for_date, audience")
    .order("created_at", { ascending: true });
  const notes = (data || []) as AlertRow[];

  const byJob = new Map<string, AlertRow[]>();
  for (const n of notes) byJob.set(n.work_order_id, [...(byJob.get(n.work_order_id) || []), n]);
  const run: JobAlertRun = { jobs: byJob.size, buzzed: 0 };
  if (byJob.size === 0) return run;

  const ids = [...byJob.keys()];
  const orders = new Map<string, OrderRow>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: rows } = await admin
      .from("work_orders")
      .select("id, customer_name, scheduled_start")
      .in("id", ids.slice(i, i + 200));
    for (const o of (rows || []) as OrderRow[]) orders.set(o.id, o);
  }

  // Who gets the buzz, per group — looked up once, only if needed.
  const recipients = new Map<string, string[]>();
  const recipientsFor = async (audience: string): Promise<string[]> => {
    if (!recipients.has(audience)) {
      recipients.set(audience, await emailsWithRole(audience === "measure" ? ["measure-tech", "admin"] : ["field-manager", "admin"]));
    }
    return recipients.get(audience)!;
  };

  for (const [id, jobNotes] of byJob) {
    const o = orders.get(id);
    const appt = appointmentDate(o?.scheduled_start);
    if (!o || !appt) continue;

    // One buzz per JOB: a buzz counts as sent once ANY note records it for this
    // appointment date, so a note added after the 5-day buzz doesn't set off a
    // second one (the day-before buzz lists every note anyway).
    const sent5 = jobNotes.find((n) => n.sent5_for_date === appt)?.sent5_for_date ?? null;
    const sent1 = jobNotes.find((n) => n.sent1_for_date === appt)?.sent1_for_date ?? null;
    const stage: JobAlertStage | null = dueStage(appt, sent5, sent1, today);
    if (!stage) continue;

    const audience = jobNotes[0]?.audience === "measure" ? "measure" : "field";
    const customer = o.customer_name || "Job";
    const when = `${shortDay(appt)}${timeOf(o.scheduled_start)}`;
    const lines = jobNotes.map((n) => `${n.created_by_name?.trim() || shortName(n.created_by)}: ${n.note.trim()}`);

    await notify({
      emails: await recipientsFor(audience),
      kind: "job_alert",
      title: `Job Alert: ${customer} — ${when}${stage === "one" ? " (next business day)" : " (5 business days)"}`,
      body: lines.join("\n"),
      url: `/?order=${encodeURIComponent(id)}`,
      tag: `job-alert-${id}-${stage}`,
    });

    // The day-before buzz also settles the 5-day one, so a late note never
    // gets the 5-day buzz after the day-before one.
    const update =
      stage === "one"
        ? { sent1_for_date: appt, sent5_for_date: appt, sent_at: new Date().toISOString() }
        : { sent5_for_date: appt, sent_at: new Date().toISOString() };
    await admin.from("job_alerts").update(update).in("id", jobNotes.map((n) => n.id));
    run.buzzed += 1;
  }
  return run;
}
