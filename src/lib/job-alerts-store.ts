// Job Alert notes from the browser (migrations 064 + 065). Field managers read
// every note on a job and write only their own — the database enforces both.
// The buzzes themselves go out from the daily cron (job-alerts-server.ts).

import { getSupabase } from "@/lib/supabase";

export interface JobAlert {
  id: string;
  workOrderId: string;
  note: string;
  createdBy: string;
  createdByName: string;
  updatedAt: string;
  /** Appointment dates each buzz already went out for (migration 065). */
  sent5ForDate: string | null;
  sent1ForDate: string | null;
}

interface JobAlertRow {
  id: string;
  work_order_id: string;
  note: string;
  created_by: string;
  created_by_name: string | null;
  updated_at: string;
  sent5_for_date: string | null;
  sent1_for_date: string | null;
}

const toAlert = (r: JobAlertRow): JobAlert => ({
  id: r.id,
  workOrderId: r.work_order_id,
  note: r.note,
  createdBy: r.created_by,
  createdByName: r.created_by_name || r.created_by.split("@")[0],
  updatedAt: r.updated_at,
  sent5ForDate: r.sent5_for_date,
  sent1ForDate: r.sent1_for_date,
});

export async function fetchJobAlerts(workOrderId: string): Promise<JobAlert[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("job_alerts")
    .select("id, work_order_id, note, created_by, created_by_name, updated_at, sent5_for_date, sent1_for_date")
    .eq("work_order_id", workOrderId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as JobAlertRow[]).map(toAlert);
}

/** Create or replace MY note on this appointment. */
export async function saveJobAlert(input: {
  workOrderId: string;
  orderNumber: string;
  note: string;
  email: string;
  name: string;
}): Promise<{ ok: boolean; error: string | null }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Not signed in." };
  const { error } = await supabase.from("job_alerts").upsert(
    {
      work_order_id: input.workOrderId,
      order_number: input.orderNumber || null,
      note: input.note.trim(),
      created_by: input.email.toLowerCase(),
      created_by_name: input.name || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "work_order_id,created_by" }
  );
  return { ok: !error, error: error?.message ?? null };
}

export async function deleteJobAlert(id: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase.from("job_alerts").delete().eq("id", id);
  return !error;
}

/** Every Job Alert note (field managers / admins can read them all). */
export async function fetchAllJobAlerts(): Promise<JobAlert[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("job_alerts")
    .select("id, work_order_id, note, created_by, created_by_name, updated_at, sent5_for_date, sent1_for_date")
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as JobAlertRow[]).map(toAlert);
}

/** Just enough of each job to list it (and know which month to load). */
export interface JobAlertJobLite {
  id: string;
  customerName: string;
  address: string;
  workOrderType: string;
  scheduledStart: string | null;
}

export async function fetchJobAlertJobs(ids: string[]): Promise<Map<string, JobAlertJobLite>> {
  const out = new Map<string, JobAlertJobLite>();
  const supabase = getSupabase();
  if (!supabase || ids.length === 0) return out;
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from("work_orders_visible")
      .select("id, customer_name, address, work_order_type, scheduled_start")
      .in("id", ids.slice(i, i + 200));
    for (const r of (data || []) as Record<string, string | null>[]) {
      out.set(String(r.id), {
        id: String(r.id),
        customerName: r.customer_name || "",
        address: r.address || "",
        workOrderType: r.work_order_type || "",
        scheduledStart: r.scheduled_start,
      });
    }
  }
  return out;
}
