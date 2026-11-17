// The kiosk approvals inbox: what both the server routes and the screens need
// to agree on. Safe to import from client components (no server imports).
//
// The data comes from public.kiosk_review_items, a view the kiosk app
// (RBANWO-Kiosk) creates in its migration 009. That view and its contract are
// documented in the kiosk repo at docs/DUCK-FORCE-INBOX.md.

import type { RoleInput } from "@/lib/roles";

export type InboxKind = "time_off" | "time_card" | "form" | "recognition";
export type InboxStatus = "pending" | "approved" | "denied" | "recorded";
export type DecisionTable =
  | "time_off_requests"
  | "kiosk_time_card_requests"
  | "kiosk_submissions";

export const DECISION_TABLES: DecisionTable[] = [
  "time_off_requests",
  "kiosk_time_card_requests",
  "kiosk_submissions",
];

/** Extra detail for a time-off row, read from time_off_requests. */
export interface InboxTimeOffDetail {
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  request_type: string | null;
  reason: string | null;
}

/** Extra detail for a time card row, read from kiosk_time_card_requests. */
export interface InboxTimeCardDetail {
  work_date: string;
  adjustment_type: string;
  hours_category: string;
  recorded_hours: number | null;
  claimed_hours: number;
  clock_in: string | null;
  clock_out: string | null;
  reason: string;
}

/** One row of the inbox, as the API hands it to the browser. */
export interface InboxItem {
  kind: InboxKind;
  item_id: string;
  decision_table: DecisionTable;
  submission_id: string | null;
  reference_code: string | null;
  title: string;
  employee_name: string;
  department: string | null;
  status: InboxStatus;
  approver_roles: string[];
  submitted_at: string;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  /** Whether a signed PDF exists. The path itself stays on the server. */
  has_pdf: boolean;
  source: "kiosk" | "link" | string;
  data: Record<string, unknown>;
  /** Can the person asking decide this row? */
  can_decide: boolean;
  time_off?: InboxTimeOffDetail | null;
  time_card?: InboxTimeCardDetail | null;
}

/**
 * Who has any business with the inbox: the roles the kiosk lets an office
 * pick as approvers (APPROVER_ROLE_CHOICES in the kiosk). Matches who can
 * open the Time Off screen (canManageTimeOff).
 */
export const INBOX_ROLES = [
  "admin",
  "payroll-admin",
  "payroll-approver",
  "field-manager",
] as const;

/** Who can see and hand out the share links. Mirrors the RLS on kiosk_share_links. */
export const SHARE_LINK_ROLES = ["admin", "payroll-admin", "payroll-approver"] as const;

function toList(input: RoleInput): string[] {
  if (!input) return [];
  return Array.isArray(input) ? input : [input];
}

/** Does this login hold any role that can ever decide a kiosk item? */
export function canUseInbox(roles: RoleInput): boolean {
  return toList(roles).some((r) => (INBOX_ROLES as readonly string[]).includes(r));
}

export function canSeeShareLinks(roles: RoleInput): boolean {
  return toList(roles).some((r) => (SHARE_LINK_ROLES as readonly string[]).includes(r));
}

/**
 * May this login decide (and see) a row with these approver roles?
 * Admin always may. Everyone else needs one of the row's roles.
 */
export function holdsApproverRole(roles: RoleInput, approverRoles: string[] | null): boolean {
  const held = toList(roles);
  if (held.includes("admin")) return true;
  return (approverRoles ?? ["admin"]).some((r) => held.includes(r));
}

/**
 * History's status filter. "decided" (approved + denied) is the default.
 * "recorded" = forms that only needed filing.
 */
export const HISTORY_STATUSES = ["decided", "approved", "denied", "recorded", "all"] as const;
export type HistoryStatus = (typeof HISTORY_STATUSES)[number];

export const HISTORY_STATUS_LABELS: Record<HistoryStatus, string> = {
  decided: "Approved + denied",
  approved: "Approved",
  denied: "Denied",
  recorded: "On record (no decision)",
  all: "Everything",
};

export const HISTORY_PAGE_SIZE = 25;

export interface HistoryFilters {
  kind: "all" | InboxKind;
  status: HistoryStatus;
  /** ISO timestamp, inclusive. */
  from: string | null;
  /** ISO timestamp, exclusive. */
  to: string | null;
  /** Matches employee name, reference code, or title (nominee). */
  q: string;
  page: number;
  pageSize: number;
}

/**
 * Decided rows sort and filter by decision date; anything that can include
 * record-only rows (no decision date) uses the submitted date instead.
 */
export function historyOrdersByDecision(status: HistoryStatus): boolean {
  return status === "decided" || status === "approved" || status === "denied";
}

/** Fired on window after any inbox decision, so the bell and the Time Off screen agree. */
export const INBOX_DECIDED_EVENT = "kiosk-inbox-decided";

export const KIND_LABELS: Record<InboxKind, string> = {
  time_off: "Time off",
  time_card: "Time card",
  form: "Form",
  recognition: "Recognition",
};

/**
 * The Payroll Admin page has one section per kind of kiosk submission, in this
 * order. Supplies are not an InboxKind: they are a record with no decision, kept
 * in their own table, so they get a section of their own rather than a row in
 * the review view.
 */
export type SectionKind = InboxKind | "supply";

export const SECTION_ORDER: SectionKind[] = [
  "time_off",
  "time_card",
  "form",
  "supply",
  "recognition",
];

export const SECTION_TITLES: Record<SectionKind, string> = {
  time_off: "Time off",
  time_card: "Time cards",
  form: "Signed forms",
  supply: "Supply requests",
  recognition: "Difference Makers",
};

/**
 * Roles that always see a kind's section, even while it is empty. They match
 * the approver roles the kiosk gives each kind. Forms are set per template (and
 * default to admin), so for forms a section also shows to anyone who holds a
 * row's approver roles, which is every row they are sent.
 */
export const SECTION_ROLES: Record<SectionKind, string[]> = {
  time_off: ["admin", "payroll-admin", "payroll-approver"],
  time_card: ["admin", "payroll-admin"],
  form: ["admin"],
  supply: ["admin", "payroll-admin"],
  recognition: ["admin", "field-manager"],
};

/** Who can read the supply log. Supplies have no decision yet; see the kiosk's SUPPLY-REQUEST-PLAN. */
export const SUPPLY_ROLES = SECTION_ROLES.supply;

/** What an emailed link asks for: one submission, or one supply request. */
export interface InboxFocus {
  sub: string | null;
  supply: string | null;
}

/** One supply request, as the supply log shows it. */
export interface SupplyLogItem {
  id: string;
  sheet_number: number;
  employee_name: string;
  department: string;
  item: string;
  quantity: number;
  quantity_unit: string | null;
  item_url: string | null;
  reason: string;
  timeline: string;
  notes: string | null;
  submitted_at: string;
  sheet_status: "pending" | "synced" | "failed";
}

/** Copied from the kiosk (RECOGNITION_CATEGORY_LABELS in src/lib/kiosk/types.ts). */
export const RECOGNITION_CATEGORY_LABELS: Record<string, string> = {
  above_and_beyond: "Going Above and Beyond",
  delivers_results: "Delivers Results",
  innovative_idea: "Innovative Idea",
  team_player: "Effective Team Player",
  positive_attitude: "Positive Attitude",
  taking_the_lead: "Taking the Lead",
};

/** Copied from the kiosk (ADJUSTMENT_TYPE_LABELS). */
export const ADJUSTMENT_TYPE_LABELS: Record<string, string> = {
  missed_punch: "Forgot to clock in or out",
  wrong_hours: "Hours are wrong",
  missing_day: "A whole day is missing",
  wrong_category: "Hours in the wrong category",
  other: "Something else",
};

/** Copied from the kiosk (HOURS_CATEGORY_LABELS + the payroll column). */
export const HOURS_CATEGORY_LABELS: Record<string, string> = {
  regular: "Regular (Reg Hours)",
  overtime: "Overtime (Time at 1.5)",
  holiday: "Holiday",
  vacation: "Vacation",
  bereavement: "Bereavement",
  other: "Other",
};

/** Titles for the built-in share links, as the kiosk names them. */
export const BUILT_IN_LINK_TITLES: Record<string, string> = {
  time_off: "Request time off",
  time_card: "Fix my time card",
  recognition: "Nominate a Difference Maker",
};

/** One live share link, as the API hands it to the browser. */
export interface ShareLinkView {
  option_key: string;
  kind: string;
  title: string;
  url: string;
  expires_at: string | null;
}
