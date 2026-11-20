// Job Alert notes from the browser (migrations 064-066, 071, 076). Each group
// reads every note and writes only its own — the database enforces both.
// The buzzes themselves go out from the daily cron (job-alerts-server.ts).
//
// Notes belong to the ORDER + the kind of appointment (migration 076, Kennen
// 2026-11-20), not to one work order: when the office cancels a work order and
// makes a new one, the notes show on the new one too. A job with no order
// number (none today) falls back to its own work order.

import { getSupabase } from "@/lib/supabase";

export interface JobAlert {
  id: string;
  /** The appointment the note was written on. */
  workOrderId: string;
  /** The order + kind of appointment the note follows (migration 076). */
  orderNumber: string;
  workOrderType: string;
  note: string;
  createdBy: string;
  createdByName: string;
  updatedAt: string;
  /** Which group the note belongs to (migration 071), set by the database. */
  audience: "field" | "measure";
  /** Appointment dates each buzz already went out for (migration 065). */
  sent5ForDate: string | null;
  sent1ForDate: string | null;
}

interface JobAlertRow {
  id: string;
  work_order_id: string;
  order_number: string | null;
  work_order_type: string | null;
  note: string;
  created_by: string;
  created_by_name: string | null;
  updated_at: string;
  sent5_for_date: string | null;
  sent1_for_date: string | null;
  audience: string | null;
}

const COLUMNS =
  "id, work_order_id, order_number, work_order_type, note, created_by, created_by_name, updated_at, sent5_for_date, sent1_for_date, audience";

const toAlert = (r: JobAlertRow): JobAlert => ({
  id: r.id,
  workOrderId: r.work_order_id,
  orderNumber: r.order_number || "",
  workOrderType: r.work_order_type || "",
  note: r.note,
  createdBy: r.created_by,
  createdByName: r.created_by_name || r.created_by.split("@")[0],
  updatedAt: r.updated_at,
  audience: r.audience === "measure" ? "measure" : "field",
  sent5ForDate: r.sent5_for_date,
  sent1ForDate: r.sent1_for_date,
});

/** Just what's needed to find a job's notes. */
export interface JobAlertTarget {
  id: string;
  orderNumber: string;
  workOrderType: string;
}

/** Which notes a job shares: its order + kind, or (no order number) itself. */
export function jobAlertKey(job: JobAlertTarget): string {
  return job.orderNumber ? `${job.orderNumber}|${job.workOrderType}` : `wo:${job.id}`;
}

/** The same key, from a note's side. */
export function noteKey(a: Pick<JobAlert, "orderNumber" | "workOrderType" | "workOrderId">): string {
  return a.orderNumber ? `${a.orderNumber}|${a.workOrderType}` : `wo:${a.workOrderId}`;
}

export async function fetchJobAlerts(job: JobAlertTarget): Promise<JobAlert[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  let q = supabase.from("job_alerts").select(COLUMNS);
  q = job.orderNumber
    ? q.eq("order_number", job.orderNumber).eq("work_order_type", job.workOrderType)
    : q.eq("work_order_id", job.id);
  const { data, error } = await q.order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as JobAlertRow[]).map(toAlert);
}

/** Fired after any save or delete, so the tile's Job Alert field, the card
 *  button's count and an open pop-up all refresh together — on every tile of
 *  the same order + kind. detail = jobAlertKey. */
export const JOB_ALERTS_CHANGED = "job-alerts-changed";
function announce(key: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(JOB_ALERTS_CHANGED, { detail: key }));
}

/** Add a new note on this job, or change one of MINE (pass its id). The
 *  database fills in the order number, kind and group from the job. */
export async function saveJobAlert(input: {
  job: JobAlertTarget;
  note: string;
  email: string;
  name: string;
  /** Set to edit an existing note of mine; leave off to add a new one. */
  id?: string;
}): Promise<{ ok: boolean; error: string | null }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Not signed in." };
  const now = new Date().toISOString();
  const { error } = input.id
    ? await supabase.from("job_alerts").update({ note: input.note.trim(), updated_at: now }).eq("id", input.id)
    : await supabase.from("job_alerts").insert({
        work_order_id: input.job.id,
        order_number: input.job.orderNumber || null,
        note: input.note.trim(),
        created_by: input.email.toLowerCase(),
        created_by_name: input.name || null,
        updated_at: now,
      });
  if (!error) announce(jobAlertKey(input.job));
  return { ok: !error, error: error?.message ?? null };
}

export async function deleteJobAlert(id: string, job: JobAlertTarget): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase.from("job_alerts").delete().eq("id", id);
  if (!error) announce(jobAlertKey(job));
  return !error;
}

/** Keeps a job's notes fresh: loads, then reloads on any change to its order + kind. */
export function watchJobAlerts(job: JobAlertTarget, onRows: (rows: JobAlert[]) => void): () => void {
  let cancelled = false;
  const key = jobAlertKey(job);
  const load = () => {
    fetchJobAlerts(job).then((rows) => {
      if (!cancelled) onRows(rows);
    });
  };
  const onChanged = (e: Event) => {
    if ((e as CustomEvent).detail === key) load();
  };
  load();
  window.addEventListener(JOB_ALERTS_CHANGED, onChanged);
  return () => {
    cancelled = true;
    window.removeEventListener(JOB_ALERTS_CHANGED, onChanged);
  };
}

/** Every Job Alert note this person's groups may read. */
export async function fetchAllJobAlerts(): Promise<JobAlert[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("job_alerts")
    .select(COLUMNS)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as JobAlertRow[]).map(toAlert);
}

/** Just enough of each job to list it (and know which month to load). */
export interface JobAlertJobLite {
  id: string;
  orderNumber: string;
  customerName: string;
  address: string;
  workOrderType: string;
  scheduledStart: string | null;
  appointmentStatus: string;
}

/** Every dated appointment on these orders (plus these lone work orders). */
export async function fetchJobAlertJobs(orderNumbers: string[], ids: string[] = []): Promise<JobAlertJobLite[]> {
  const out = new Map<string, JobAlertJobLite>();
  const supabase = getSupabase();
  if (!supabase) return [];
  const take = (rows: Record<string, string | null>[] | null) => {
    for (const r of rows || []) {
      out.set(String(r.id), {
        id: String(r.id),
        orderNumber: r.order_number || "",
        customerName: r.customer_name || "",
        address: r.address || "",
        workOrderType: r.work_order_type || "",
        scheduledStart: r.scheduled_start,
        appointmentStatus: r.appointment_status || "",
      });
    }
  };
  const cols = "id, order_number, customer_name, address, work_order_type, scheduled_start, appointment_status";
  for (let i = 0; i < orderNumbers.length; i += 200) {
    const { data } = await supabase
      .from("work_orders_visible")
      .select(cols)
      .in("order_number", orderNumbers.slice(i, i + 200))
      .not("scheduled_start", "is", null);
    take(data as Record<string, string | null>[] | null);
  }
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from("work_orders_visible")
      .select(cols)
      .in("id", ids.slice(i, i + 200));
    take(data as Record<string, string | null>[] | null);
  }
  return [...out.values()];
}
