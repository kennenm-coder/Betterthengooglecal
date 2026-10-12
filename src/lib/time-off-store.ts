import { TimeOffRequest, TimeOffStatus, Employee } from "./types";
import { getSupabase } from "./supabase";
import staticEmployees from "@/data/employees.json";

/**
 * A row with no status is an older row, written before the approval workflow
 * existed. Those are time off that is already happening, so they read as
 * approved — never as pending, which would hide them from the calendar.
 */
export function timeOffStatus(r: TimeOffRequest): TimeOffStatus {
  return r.status ?? "approved";
}

export function isApproved(r: TimeOffRequest): boolean {
  return timeOffStatus(r) === "approved";
}

export function isPending(r: TimeOffRequest): boolean {
  return timeOffStatus(r) === "pending";
}

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

/**
 * Approve or deny a request. Admin and payroll-admin only, which the existing
 * `admin_payroll_manage_time_off` RLS policy already enforces — this is an
 * UPDATE by a signed-in user, not a service-role write.
 *
 * Approving is what puts the time off on the calendar. Denying keeps the row
 * for the record but it is never shown.
 */
export async function updateTimeOffStatus(
  id: string,
  status: TimeOffStatus,
  reviewedBy: string,
  reviewNote?: string
): Promise<TimeOffRequest | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("time_off_requests")
    .update({
      status,
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
      review_note: reviewNote || null,
    })
    .eq("id", id)
    // Only an undecided request can be decided, so two admins tapping Approve
    // and Deny at the same moment can't both appear to have won.
    .eq("status", "pending")
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

/**
 * Which time off lands on a given date.
 *
 * APPROVED ONLY. A kiosk request sits as 'pending' until payroll approves it,
 * and showing it on the calendar before then would tell a scheduler someone is
 * off when nobody has agreed to it yet. Every banner and overview goes through
 * this function, so the filter belongs here rather than in each of them.
 */
export function getTimeOffForDate(
  requests: TimeOffRequest[],
  dateStr: string
): TimeOffRequest[] {
  return requests.filter((r) => {
    if (!isApproved(r)) return false;
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
