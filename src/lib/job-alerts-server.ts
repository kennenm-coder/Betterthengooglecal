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
//
// Notes follow the ORDER + kind of appointment (migration 076, Kennen
// 2026-11-20), not one work order: if the office cancels a work order and makes
// a new one, the buzz goes out for the new one. When an order has several
// upcoming appointments of that kind, the buzz is for the SOONEST uncancelled
// one; once it has passed, the notes ride along to the next.
// Tables: 064 + 065 + 066 + 071 + 076.

import { getAdminClient } from "@/lib/auth";
import { emailsWithRole, notify } from "@/lib/notify-server";
import { appointmentDate, dueStage, shortDay, todayAtOffice, type JobAlertStage } from "@/lib/job-alert-dates";

interface AlertRow {
  id: string;
  work_order_id: string;
  order_number: string | null;
  work_order_type: string | null;
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
  order_number: string | null;
  work_order_type: string | null;
  customer_name: string | null;
  scheduled_start: string | null;
  appointment_status: string | null;
}

/** Same rule as noteKey / jobAlertKey in job-alerts-store.ts. */
function keyOf(orderNumber: string | null, type: string | null, workOrderId: string): string {
  return orderNumber ? `${orderNumber}|${type || ""}` : `wo:${workOrderId}`;
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
    .select("id, work_order_id, order_number, work_order_type, note, created_by, created_by_name, created_at, sent5_for_date, sent1_for_date, audience")
    .order("created_at", { ascending: true });
  const notes = (data || []) as AlertRow[];

  const byJob = new Map<string, AlertRow[]>();
  for (const n of notes) {
    const k = keyOf(n.order_number, n.work_order_type, n.work_order_id);
    byJob.set(k, [...(byJob.get(k) || []), n]);
  }
  const run: JobAlertRun = { jobs: byJob.size, buzzed: 0 };
  if (byJob.size === 0) return run;

  // Every upcoming, uncancelled appointment on those orders (and the lone
  // work orders of notes with no order number), grouped the same way.
  const orderNumbers = [...new Set(notes.map((n) => n.order_number).filter((v): v is string => !!v))];
  const loneIds = notes.filter((n) => !n.order_number).map((n) => n.work_order_id);
  const cols = "id, order_number, work_order_type, customer_name, scheduled_start, appointment_status";
  const found: OrderRow[] = [];
  for (let i = 0; i < orderNumbers.length; i += 200) {
    const { data: rows } = await admin
      .from("work_orders")
      .select(cols)
      .in("order_number", orderNumbers.slice(i, i + 200))
      .gte("scheduled_start", today);
    found.push(...((rows || []) as OrderRow[]));
  }
  for (let i = 0; i < loneIds.length; i += 200) {
    const { data: rows } = await admin.from("work_orders").select(cols).in("id", loneIds.slice(i, i + 200));
    found.push(...((rows || []) as OrderRow[]));
  }
  const upcomingByKey = new Map<string, OrderRow[]>();
  for (const o of found) {
    const appt = appointmentDate(o.scheduled_start);
    if (!appt || appt < today || /cancel/i.test(o.appointment_status || "")) continue;
    // A lone work order's notes key on its id; an order's on order + kind.
    const k = o.order_number && orderNumbers.includes(o.order_number) ? keyOf(o.order_number, o.work_order_type, o.id) : `wo:${o.id}`;
    upcomingByKey.set(k, [...(upcomingByKey.get(k) || []), o]);
  }

  // Who gets the buzz, per group — looked up once, only if needed.
  const recipients = new Map<string, string[]>();
  const recipientsFor = async (audience: string): Promise<string[]> => {
    if (!recipients.has(audience)) {
      recipients.set(audience, await emailsWithRole(audience === "measure" ? ["measure-tech", "admin"] : ["field-manager", "admin"]));
    }
    return recipients.get(audience)!;
  };

  for (const [key, jobNotes] of byJob) {
    const upcoming = (upcomingByKey.get(key) || []).sort((a, b) =>
      (a.scheduled_start || "").localeCompare(b.scheduled_start || "")
    );
    // One buzz per JOB: a buzz counts as sent once ANY note records it for this
    // appointment date, so a note added after the 5-day buzz doesn't set off a
    // second one (the day-before buzz lists every note anyway).
    const stageFor = (o: OrderRow): JobAlertStage | null => {
      const appt = appointmentDate(o.scheduled_start);
      const sent5 = jobNotes.find((n) => n.sent5_for_date === appt)?.sent5_for_date ?? null;
      const sent1 = jobNotes.find((n) => n.sent1_for_date === appt)?.sent1_for_date ?? null;
      return dueStage(appt, sent5, sent1, today);
    };
    // The soonest upcoming appointment. One that's today and already had its
    // buzzes steps aside, so the next appointment of that kind isn't held up.
    let o = upcoming[0];
    if (o && appointmentDate(o.scheduled_start) === today && !stageFor(o) && upcoming[1]) o = upcoming[1];
    if (!o) continue;
    const appt = appointmentDate(o.scheduled_start)!;
    const id = o.id;
    const stage = stageFor(o);
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
