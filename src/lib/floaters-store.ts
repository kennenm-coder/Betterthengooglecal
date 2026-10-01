import { getSupabase } from "./supabase";

/**
 * Install leads with no job on a given day — "floaters", the people a field
 * manager can still send somewhere.
 *
 * The scheduling tables are locked to the scheduling roles, so this goes
 * through sched_free_install_leads(), a SECURITY DEFINER function that returns
 * only crew names and dates. See
 * supabase/migrations/026_floaters_free_install_leads.sql.
 */

export interface FloatersByDay {
  /** YYYY-MM-DD -> crew names free that day, already alphabetical. */
  [date: string]: string[];
}

interface FreeLeadRow {
  work_date: string;
  crew_id: string;
  crew_name: string;
}

/**
 * Free install leads for an inclusive date range, grouped by day.
 *
 * Returns an empty map rather than throwing when the caller lacks the role or
 * the function is missing — the banner is an extra, and it should never be able
 * to break the calendar underneath it.
 */
export async function fetchFreeInstallLeads(
  startDate: string,
  endDate: string
): Promise<FloatersByDay> {
  const sb = getSupabase();
  if (!sb) return {};

  const { data, error } = await sb.rpc("sched_free_install_leads", {
    p_start: startDate,
    p_end: endDate,
  });

  if (error || !data) {
    if (error) console.warn("[floaters] lookup failed:", error.message);
    return {};
  }

  const byDay: FloatersByDay = {};
  for (const row of data as FreeLeadRow[]) {
    // The date can come back as a full timestamp depending on the driver.
    const day = String(row.work_date).slice(0, 10);
    (byDay[day] ??= []).push(row.crew_name);
  }
  return byDay;
}
