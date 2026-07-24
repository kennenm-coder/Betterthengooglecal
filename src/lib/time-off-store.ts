import { TimeOffRequest } from "./types";
import { getSupabase } from "./supabase";

export async function fetchTimeOffRequests(): Promise<TimeOffRequest[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("time_off_requests")
    .select("*")
    .order("start_date", { ascending: true });

  if (error || !data) return [];
  return data as TimeOffRequest[];
}

export async function addTimeOffRequest(
  req: Omit<TimeOffRequest, "id" | "created_at">
): Promise<TimeOffRequest | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("time_off_requests")
    .insert({
      employee_name: req.employee_name,
      department: req.department,
      start_date: req.start_date,
      end_date: req.end_date || null,
    })
    .select()
    .single();

  if (error || !data) return null;
  return data as TimeOffRequest;
}

export async function deleteTimeOffRequest(id: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;

  const { error } = await supabase
    .from("time_off_requests")
    .delete()
    .eq("id", id);

  return !error;
}

export function getTimeOffForDate(
  requests: TimeOffRequest[],
  dateStr: string
): TimeOffRequest[] {
  return requests.filter((r) => {
    const start = r.start_date;
    const end = r.end_date || r.start_date;
    return dateStr >= start && dateStr <= end;
  });
}
