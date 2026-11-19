// Server-only half of the kiosk approvals inbox. Reads public.kiosk_review_items
// with the service-role client; callers must run requireRole() first.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedUser } from "@/lib/auth";
import {
  HISTORY_PAGE_SIZE,
  HISTORY_STATUSES,
  historyOrdersByDecision,
  type HistoryFilters,
  type HistoryStatus,
  holdsApproverRole,
  type InboxItem,
  type InboxTimeCardDetail,
  type InboxTimeOffDetail,
  type DecisionTable,
} from "@/lib/kiosk-inbox";

/** The kiosk app's base URL, without a trailing slash. Null if not set. */
export function kioskAppUrl(): string | null {
  return process.env.KIOSK_APP_URL?.replace(/\/+$/, "") || null;
}

/**
 * Did this query fail because the table or view is not there yet?
 *
 * The kiosk's migration 009 creates kiosk_review_items and kiosk_share_links.
 * Until it runs, the inbox falls back to time off only (exactly what this
 * screen did before), rather than breaking the Time Off screen.
 */
export function isMissingRelation(
  error: { code?: string; message?: string } | null | undefined
): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /does not exist|could not find the table|schema cache/i.test(
    error.message ?? ""
  );
}

/** The reviewer's display name from the roster, falling back to their email. */
export async function reviewerName(
  admin: SupabaseClient,
  email: string
): Promise<string> {
  const { data } = await admin
    .from("allowed_emails")
    .select("name")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  return String(data?.name || "").trim() || email;
}

const VIEW_COLUMNS =
  "kind, item_id, decision_table, submission_id, reference_code, title, employee_name, department, status, approver_roles, submitted_at, reviewed_by_name, reviewed_at, review_note, pdf_path, source, data";

export interface ViewRow {
  kind: InboxItem["kind"];
  item_id: string;
  decision_table: DecisionTable;
  submission_id: string | null;
  reference_code: string | null;
  title: string | null;
  employee_name: string | null;
  department: string | null;
  status: InboxItem["status"];
  approver_roles: string[] | null;
  submitted_at: string;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  pdf_path: string | null;
  source: string | null;
  data: Record<string, unknown> | null;
}

/** Look up one row of the view by where its decision lives. */
export async function findViewRow(
  admin: SupabaseClient,
  table: DecisionTable,
  itemId: string
): Promise<{ row: ViewRow | null; error: { code?: string; message?: string } | null }> {
  const { data, error } = await admin
    .from("kiosk_review_items")
    .select(VIEW_COLUMNS)
    .eq("decision_table", table)
    .eq("item_id", itemId)
    .maybeSingle();
  return { row: (data as ViewRow | null) ?? null, error };
}

function toItem(row: ViewRow, user: AuthenticatedUser): InboxItem {
  const approverRoles = row.approver_roles?.length ? row.approver_roles : ["admin"];
  return {
    kind: row.kind,
    item_id: row.item_id,
    decision_table: row.decision_table,
    submission_id: row.submission_id,
    reference_code: row.reference_code,
    title: row.title || "Kiosk submission",
    employee_name: row.employee_name || "Unknown",
    department: row.department,
    status: row.status,
    approver_roles: approverRoles,
    submitted_at: row.submitted_at,
    reviewed_by_name: row.reviewed_by_name,
    reviewed_at: row.reviewed_at,
    review_note: row.review_note,
    has_pdf: Boolean(row.pdf_path),
    source: row.source || "kiosk",
    data: row.data && typeof row.data === "object" ? row.data : {},
    can_decide:
      row.status === "pending" && holdsApproverRole(user.roles, approverRoles),
  };
}

/** Attach the time-off and time-card detail the view does not carry. */
async function attachDetail(admin: SupabaseClient, items: InboxItem[]) {
  const timeOffIds = items.filter((i) => i.kind === "time_off").map((i) => i.item_id);
  const timeCardIds = items.filter((i) => i.kind === "time_card").map((i) => i.item_id);

  const [timeOff, timeCard] = await Promise.all([
    timeOffIds.length
      ? admin
          .from("time_off_requests")
          .select("id, start_date, end_date, start_time, end_time, request_type, reason")
          .in("id", timeOffIds)
      : Promise.resolve({ data: [] as unknown[] }),
    timeCardIds.length
      ? admin
          .from("kiosk_time_card_requests")
          .select(
            "id, work_date, adjustment_type, hours_category, recorded_hours, claimed_hours, clock_in, clock_out, reason"
          )
          .in("id", timeCardIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const offById = new Map<string, InboxTimeOffDetail>();
  for (const r of (timeOff.data ?? []) as (InboxTimeOffDetail & { id: string })[]) {
    offById.set(r.id, r);
  }
  const cardById = new Map<string, InboxTimeCardDetail>();
  for (const r of (timeCard.data ?? []) as (InboxTimeCardDetail & { id: string })[]) {
    cardById.set(r.id, r);
  }

  for (const item of items) {
    if (item.kind === "time_off") item.time_off = offById.get(item.item_id) ?? null;
    if (item.kind === "time_card") item.time_card = cardById.get(item.item_id) ?? null;
  }
}

export interface InboxLoad {
  items: InboxItem[];
  /** True when the kiosk's migration 009 has not been run yet. */
  viewMissing: boolean;
}

/**
 * Pending rows this user can decide.
 *
 * Visibility is filtered in the query, not after it, so the row limit counts
 * only rows the person can actually see.
 */
export async function loadInboxItems(
  admin: SupabaseClient,
  user: AuthenticatedUser
): Promise<InboxLoad> {
  let query = admin
    .from("kiosk_review_items")
    .select(VIEW_COLUMNS)
    .eq("status", "pending")
    .order("submitted_at", { ascending: true })
    .limit(200);

  if (!user.roles.includes("admin")) {
    query = query.overlaps("approver_roles", user.roles);
  }

  const { data, error } = await query;

  if (error) {
    if (isMissingRelation(error)) {
      return { items: await legacyPendingTimeOff(admin, user), viewMissing: true };
    }
    throw new Error(error.message);
  }

  const items = ((data ?? []) as ViewRow[]).map((r) => toItem(r, user));
  await attachDetail(admin, items);
  return { items, viewMissing: false };
}

/**
 * One submission by its kiosk submission id: where an emailed link lands.
 *
 * Any status, so a link still works after somebody has decided it. A person who
 * is not one of the row's approver roles gets `forbidden` and no detail at all,
 * so the link cannot be used to read something they have no business with.
 */
export async function loadItemBySubmission(
  admin: SupabaseClient,
  user: AuthenticatedUser,
  submissionId: string
): Promise<{ item: InboxItem | null; forbidden: boolean; kind: InboxItem["kind"] | null }> {
  const { data, error } = await admin
    .from("kiosk_review_items")
    .select(VIEW_COLUMNS)
    .eq("submission_id", submissionId)
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingRelation(error)) return { item: null, forbidden: false, kind: null };
    throw new Error(error.message);
  }
  if (!data) return { item: null, forbidden: false, kind: null };

  const row = data as ViewRow;
  const approverRoles = row.approver_roles?.length ? row.approver_roles : ["admin"];
  if (!holdsApproverRole(user.roles, approverRoles)) {
    return { item: null, forbidden: true, kind: row.kind };
  }
  const item = toItem(row, user);
  await attachDetail(admin, [item]);
  return { item, forbidden: false, kind: row.kind };
}

export interface HistoryLoad extends InboxLoad {
  /** Rows matching the filters, across all pages. */
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Decided and record-only history, filtered and paged in the database.
 *
 * Ordering: anything decided sorts by WHEN it was decided, newest first.
 * "On record" and "All" sort by when it was submitted, because record-only
 * rows have no decision date. The date range applies to that same column.
 */
export async function loadHistory(
  admin: SupabaseClient,
  user: AuthenticatedUser,
  filters: HistoryFilters
): Promise<HistoryLoad> {
  const { page, pageSize } = filters;
  const byDecision = historyOrdersByDecision(filters.status);
  const dateColumn = byDecision ? "reviewed_at" : "submitted_at";

  let query = admin
    .from("kiosk_review_items")
    .select(VIEW_COLUMNS, { count: "exact" });

  const statuses: Record<HistoryStatus, string[]> = {
    decided: ["approved", "denied"],
    approved: ["approved"],
    denied: ["denied"],
    recorded: ["recorded"],
    all: ["approved", "denied", "recorded"],
  };
  query = query.in("status", statuses[filters.status]);

  if (filters.kind !== "all") query = query.eq("kind", filters.kind);
  if (filters.from) query = query.gte(dateColumn, filters.from);
  if (filters.to) query = query.lt(dateColumn, filters.to);

  if (filters.q) {
    const like = `*${filters.q}*`;
    query = query.or(
      `employee_name.ilike.${like},reference_code.ilike.${like},title.ilike.${like}`
    );
  }

  if (!user.roles.includes("admin")) {
    query = query.overlaps("approver_roles", user.roles);
  }

  query = query
    .order(dateColumn, { ascending: false, nullsFirst: false })
    .order("submitted_at", { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);

  const { data, error, count } = await query;

  if (error) {
    if (isMissingRelation(error)) {
      return { items: [], viewMissing: true, total: 0, page, pageSize };
    }
    throw new Error(error.message);
  }

  const items = ((data ?? []) as ViewRow[]).map((r) => toItem(r, user));
  await attachDetail(admin, items);
  return { items, viewMissing: false, total: count ?? items.length, page, pageSize };
}

/**
 * Read the History filters off a request URL, rejecting anything odd rather
 * than passing it to the database.
 */
export function parseHistoryFilters(params: URLSearchParams): HistoryFilters {
  const kind = params.get("kind");
  const status = params.get("status");
  const page = Math.max(0, Math.min(10_000, parseInt(params.get("page") || "0", 10) || 0));
  const iso = (v: string | null) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
  // Characters that mean something in PostgREST's or=() syntax or in LIKE.
  const q = (params.get("q") || "").replace(/[,()*%\\"':]/g, " ").trim().slice(0, 80);

  return {
    kind: (["time_off", "time_card", "form", "recognition"] as const).includes(kind as never)
      ? (kind as HistoryFilters["kind"])
      : "all",
    status: (HISTORY_STATUSES as readonly string[]).includes(status ?? "")
      ? (status as HistoryStatus)
      : "decided",
    from: iso(params.get("from")),
    to: iso(params.get("to")),
    q,
    page,
    pageSize: HISTORY_PAGE_SIZE,
  };
}

const TIME_OFF_APPROVERS = ["admin", "payroll-admin", "payroll-approver"];

/**
 * Before migration 009: the pending time off this screen always showed,
 * shaped like inbox rows so the rest of the screen does not care.
 */
async function legacyPendingTimeOff(
  admin: SupabaseClient,
  user: AuthenticatedUser
): Promise<InboxItem[]> {
  if (!holdsApproverRole(user.roles, TIME_OFF_APPROVERS)) return [];

  const { data, error } = await admin
    .from("time_off_requests")
    .select(
      "id, employee_name, department, start_date, end_date, start_time, end_time, request_type, reason, reference_code, signed_pdf_path, signed_at, created_at, kiosk_submission_id, source"
    )
    .eq("status", "pending")
    .order("start_date", { ascending: true })
    .limit(100);
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    kind: "time_off" as const,
    item_id: r.id,
    decision_table: "time_off_requests" as const,
    submission_id: r.kiosk_submission_id ?? null,
    reference_code: r.reference_code ?? null,
    title: `Time off request - ${r.request_type || "PTO"}`,
    employee_name: r.employee_name,
    department: r.department ?? null,
    status: "pending" as const,
    approver_roles: TIME_OFF_APPROVERS,
    submitted_at: r.signed_at || r.created_at,
    reviewed_by_name: null,
    reviewed_at: null,
    review_note: null,
    has_pdf: Boolean(r.signed_pdf_path),
    source: "kiosk",
    data: {},
    can_decide: true,
    time_off: {
      start_date: r.start_date,
      end_date: r.end_date,
      start_time: r.start_time,
      end_time: r.end_time,
      request_type: r.request_type,
      reason: r.reason,
    },
  }));
}

/** Append to the kiosk's audit log. Never throws: the decision already stands. */
export async function logKioskEvent(
  admin: SupabaseClient,
  entry: {
    submissionId: string | null;
    eventType: string;
    /** The approver's name, as the roster has it right now. */
    actor: string;
    /**
     * The approver's login email: unlike a name it names exactly one person, and
     * it is the only identifier for who decided a time card (whose own row holds
     * just the name).
     */
    actorEmail?: string;
    referenceCode: string | null;
    note: string | null;
  }
): Promise<void> {
  try {
    const { error } = await admin.from("kiosk_events").insert({
      submission_id: entry.submissionId,
      event_type: entry.eventType,
      actor: entry.actor,
      payload: {
        referenceCode: entry.referenceCode,
        note: entry.note,
        ...(entry.actorEmail ? { reviewedByEmail: entry.actorEmail.toLowerCase() } : {}),
      },
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    console.error("[kiosk-inbox] audit log write failed", entry.eventType, e);
  }
}
