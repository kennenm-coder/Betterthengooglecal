// Job Site Visits (migration 078): a measure tech's log of trips out to a job,
// with notes. Logged from the Submissions tab or the "Log Job Site Visit"
// button on a job tile. Measure techs and admins read every visit; only the
// tech who logged one (or an admin) can change or delete it — the database
// enforces both. The monthly email goes out from the daily cron
// (site-visits-server.ts).

import { getSupabase } from "@/lib/supabase";
import type { WorkOrder } from "@/lib/types";

/** The job a visit is about, copied onto the visit when it's logged. */
export interface SiteVisitJob {
  order_number: string;
  work_order_id: string | null;
  work_order_number: string | null;
  job_name: string;
  address: string | null;
}

export interface SiteVisit extends SiteVisitJob {
  id: string;
  visit_date: string;
  notes: string;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "id, order_number, work_order_id, work_order_number, job_name, address, visit_date, notes, created_by, created_by_name, created_at, updated_at";

export function siteVisitJobOf(order: WorkOrder): SiteVisitJob {
  return {
    order_number: order.orderNumber,
    work_order_id: order.id || null,
    work_order_number: order.workOrderNumber || null,
    job_name: order.customerName || order.accountName || "",
    address: order.address || null,
  };
}

/** Who logged it, for display. */
export function visitBy(v: SiteVisit): string {
  return v.created_by_name || v.created_by.split("@")[0];
}

/** Every visit on one job (all appointments under its order number), newest first. */
export async function fetchSiteVisitsForJob(orderNumber: string): Promise<SiteVisit[]> {
  const supabase = getSupabase();
  if (!supabase || !orderNumber) return [];
  const { data, error } = await supabase
    .from("job_site_visits")
    .select(COLUMNS)
    .eq("order_number", orderNumber)
    .order("visit_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data as SiteVisit[];
}

/** Visits on or after a day (YYYY-MM-DD), newest first. */
export async function fetchSiteVisitsSince(since: string): Promise<SiteVisit[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("job_site_visits")
    .select(COLUMNS)
    .gte("visit_date", since)
    .order("visit_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error || !data) return [];
  return data as SiteVisit[];
}

/** Fired after any save or delete. detail = the job's order number. */
export const SITE_VISITS_CHANGED = "site-visits-changed";
function announce(orderNumber: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SITE_VISITS_CHANGED, { detail: orderNumber }));
}

/** Log a new visit, or change one (pass its id). */
export async function saveSiteVisit(input: {
  job: SiteVisitJob;
  visitDate: string;
  notes: string;
  name: string;
  id?: string;
}): Promise<{ ok: boolean; error: string | null }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Not signed in." };
  const { error } = input.id
    ? await supabase
        .from("job_site_visits")
        .update({ visit_date: input.visitDate, notes: input.notes.trim() })
        .eq("id", input.id)
    : await supabase.from("job_site_visits").insert({
        // Field by field: the job may be a whole SiteVisit row (opened from
        // the list), and its id / created_by must not ride along.
        order_number: input.job.order_number,
        work_order_id: input.job.work_order_id,
        work_order_number: input.job.work_order_number,
        job_name: input.job.job_name,
        address: input.job.address,
        visit_date: input.visitDate,
        notes: input.notes.trim(),
        created_by_name: input.name || null,
      });
  if (!error) announce(input.job.order_number);
  return { ok: !error, error: error?.message ?? null };
}

export async function deleteSiteVisit(id: string, orderNumber: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase.from("job_site_visits").delete().eq("id", id);
  if (!error) announce(orderNumber);
  return !error;
}

/** Keeps a job's visit list fresh: loads, then reloads on any change to that job. */
export function watchSiteVisits(orderNumber: string, onRows: (rows: SiteVisit[]) => void): () => void {
  let cancelled = false;
  const load = () => {
    fetchSiteVisitsForJob(orderNumber).then((rows) => {
      if (!cancelled) onRows(rows);
    });
  };
  const onChanged = (e: Event) => {
    if ((e as CustomEvent).detail === orderNumber) load();
  };
  load();
  window.addEventListener(SITE_VISITS_CHANGED, onChanged);
  return () => {
    cancelled = true;
    window.removeEventListener(SITE_VISITS_CHANGED, onChanged);
  };
}
