import { TimeOffRequest, Employee } from "./types";
import { getSupabase } from "./supabase";
import staticEmployees from "@/data/employees.json";

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
      start_time: req.start_time || null,
      end_time: req.end_time || null,
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

/**
 * "14:30" or "14:30:00" (what Postgres hands back) -> "2:30 PM".
 * Returns "" for a missing or unparseable time so callers can skip it.
 */
export function formatTimeDisplay(time: string | null | undefined): string {
  if (!time) return "";
  const [h, m] = time.split(":");
  const hour = Number(h);
  const minute = Number(m);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return "";
  const suffix = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
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

// --- Employees ---

export async function fetchEmployees(): Promise<Employee[]> {
  const supabase = getSupabase();
  if (!supabase) return staticEmployees as Employee[];

  const { data, error } = await supabase
    .from("employees")
    .select("*")
    .order("last_name", { ascending: true });

  if (error || !data || data.length === 0) return staticEmployees as Employee[];

  return data.map((r: any) => ({
    firstName: r.first_name,
    lastName: r.last_name,
    department: r.department,
  }));
}

export async function addEmployee(
  emp: Employee
): Promise<Employee | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("employees")
    .insert({
      first_name: emp.firstName.trim(),
      last_name: emp.lastName.trim(),
      department: emp.department.trim(),
    })
    .select()
    .single();

  if (error || !data) return null;
  return {
    firstName: data.first_name,
    lastName: data.last_name,
    department: data.department,
  };
}
