// Job Alert notes from the browser (migration 064). Field managers read every
// note on a job and write only their own — the database enforces both.

import { getSupabase } from "@/lib/supabase";

export interface JobAlert {
  id: string;
  workOrderId: string;
  note: string;
  createdBy: string;
  createdByName: string;
  updatedAt: string;
  sentAt: string | null;
  sentForDate: string | null;
}

interface JobAlertRow {
  id: string;
  work_order_id: string;
  note: string;
  created_by: string;
  created_by_name: string | null;
  updated_at: string;
  sent_at: string | null;
  sent_for_date: string | null;
}

const toAlert = (r: JobAlertRow): JobAlert => ({
  id: r.id,
  workOrderId: r.work_order_id,
  note: r.note,
  createdBy: r.created_by,
  createdByName: r.created_by_name || r.created_by.split("@")[0],
  updatedAt: r.updated_at,
  sentAt: r.sent_at,
  sentForDate: r.sent_for_date,
});

export async function fetchJobAlerts(workOrderId: string): Promise<JobAlert[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("job_alerts")
    .select("id, work_order_id, note, created_by, created_by_name, updated_at, sent_at, sent_for_date")
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
