// Single source of truth for role labels, styling, and capability gates.
// Both the client (button visibility) and the DB RLS policies must agree on
// who counts as a "field worker" — keep FIELD_WORK_ROLES in sync with the
// role checks in supabase/migrations/005_field_work_orders.sql.

import type { UserRole } from "@/hooks/useAuth";

/**
 * A user's roles. Accounts can hold several (allowed_emails.roles), so every
 * capability gate takes the FULL set and grants access if ANY held role
 * qualifies — the union of what all their roles allow. Callers pass the `roles`
 * array from useAuth. A single role string (or null) is also accepted for
 * convenience and normalized to an array.
 */
export type RoleInput = UserRole | string | string[] | null | undefined;

function toList(input: RoleInput): string[] {
  if (!input) return [];
  return Array.isArray(input) ? input : [input];
}

/** True if the user holds any of the allowed roles. */
function hasAny(input: RoleInput, allowed: readonly string[]): boolean {
  const held = toList(input);
  return held.some((r) => allowed.includes(r));
}

/**
 * The plain admin role always has access to everything. Every capability gate
 * below short-circuits through this, so an admin can never be locked out of a
 * feature no matter how the other role lists change.
 */
export function isAdmin(roles: RoleInput): boolean {
  return toList(roles).includes("admin");
}

/**
 * Is this a restricted field installer?
 *
 * `installer` is the one SUBTRACTIVE role in this app. Every other gate above
 * and below grants on the union of what the held roles allow; this one takes
 * away, so it cannot follow that rule — `installer` + `member` would otherwise
 * read as plain member and quietly undo the whole restriction. Holding it
 * restricts you, full stop.
 *
 * Admin is the one exception, so an admin who tags themselves as a crew to
 * test the role can never lock themselves out.
 *
 * Mirrors public.is_installer() in migration 033 — the DB enforces this; the
 * checks here only decide what to draw.
 */
export function isInstaller(roles: RoleInput): boolean {
  if (isAdmin(roles)) return false;
  return toList(roles).includes("installer");
}

/**
 * Roles that cannot be held alongside `installer`.
 *
 * Because the role subtracts, pairing it with anything else is always a
 * mistake — either the other role is pointless or it signals an intent the
 * restriction will ignore. The Team page refuses to save such a pair rather
 * than letting an admin create an account whose access does not match what
 * the checkboxes appear to say.
 */
export function installerRoleConflict(roles: string[]): boolean {
  return roles.includes("installer") && roles.length > 1;
}

/**
 * Does this installer's login know which crew they are?
 *
 * An installer with no resource assigned matches no job, so every screen
 * comes back empty. That is deliberate — failing closed — but an empty
 * calendar with no explanation reads as a broken app, so callers use this to
 * show "ask an admin to finish setting up your account" instead.
 */
export function installerNeedsSetup(roles: RoleInput, crewNames: string[]): boolean {
  return isInstaller(roles) && crewNames.length === 0;
}

/** Roles allowed to create field write-ups and send field notes. */
export const FIELD_WORK_ROLES: UserRole[] = ["admin", "field-manager"];

/**
 * Can this user create field write-ups / send field notes?
 * Gates the Write-Up button and the Log Action (field notes) button.
 */
export function canDoFieldWork(roles: RoleInput): boolean {
  return hasAny(roles, FIELD_WORK_ROLES);
}

/**
 * Who sees the Floaters line — the install leads with no job that day.
 *
 * Field managers, who use it to find someone to send; admins, as always. The
 * DB function sched_free_install_leads() enforces the same list, so hiding the
 * banner is presentation, not the access control.
 */
export function canSeeFloaters(roles: RoleInput): boolean {
  return isAdmin(roles) || hasAny(roles, ["field-manager"]);
}

/**
 * Roles that can review/close write-ups and approve photo deletion.
 * Field managers run the full review lifecycle alongside the office
 * (admin + payroll-admin): mark reviewed, close, reopen, archive.
 */
export function canReviewWriteUps(roles: RoleInput): boolean {
  return hasAny(roles, ["admin", "payroll-admin", "field-manager"]);
}

/**
 * Who can even SEE the Write-Ups tab. Admin + field-manager get full access;
 * scheduling + scheduling-manager get VIEW-ONLY (read, copy, download/print) —
 * they can't create, edit, review, delete, or toggle completion (gated by
 * canDoFieldWork / canReviewWriteUps, which exclude them).
 */
export function canSeeWriteUps(roles: RoleInput): boolean {
  return hasAny(roles, ["admin", "field-manager", "scheduling", "scheduling_manager"]);
}

/**
 * Who can APPROVE or deny a time-off request.
 *
 * Payroll approvers are managers given a say over time off and nothing else:
 * the role grants no other calendar capability, so handing it out is cheap.
 * Every approver sees every pending request -- there is no team or department
 * scoping, by decision.
 */
export function canApproveTimeOff(roles: RoleInput): boolean {
  return hasAny(roles, ["admin", "payroll-admin", "payroll-approver"]);
}

/**
 * Who can open the Time Off screen.
 *
 * Wider than approving: field managers add and remove time off without
 * deciding kiosk requests, and approvers need to get to the screen to decide
 * them.
 */
export function canManageTimeOff(roles: RoleInput): boolean {
  return (
    hasAny(roles, ["admin", "payroll-admin", "field-manager"]) ||
    canApproveTimeOff(roles)
  );
}

/** Roles allowed to set/edit/clear the legacy install-instructions link. */
export const LEGACY_LINK_ROLES: UserRole[] = ["admin", "scheduling", "scheduling_manager"];

/**
 * Can this user add/edit/clear a legacy install-instructions link on a job?
 * Everyone else can still see the link and open it — they just can't edit.
 * Keep in sync with the RLS policies in
 * supabase/migrations/016_legacy_links_multirole.sql.
 */
export function canEditLegacyLink(roles: RoleInput): boolean {
  return hasAny(roles, LEGACY_LINK_ROLES);
}

/** Assignable roles, in the order shown in the admin Team checkboxes. */
export const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "member", label: "Member" },
  { value: "field-manager", label: "Field Manager" },
  { value: "payroll-admin", label: "Payroll Admin" },
  // Managers who approve time off and nothing else. No other calendar
  // capability comes with it, so it is safe to hand out widely.
  { value: "payroll-approver", label: "Payroll Approver (time off)" },
  { value: "scheduling", label: "Scheduling" },
  { value: "scheduling_manager", label: "Scheduling Manager" },
  { value: "admin", label: "Admin" },
  // Roles & Responsibilities app role: lets them EDIT departments, roles,
  // responsibilities and SOPs there. Everyone on this list can already READ
  // that app, so this role is only about editing. No calendar capabilities.
  { value: "process-manager", label: "Process Manager (Roles & SOPs)" },
  // Change-order-app role (no calendar capabilities on its own; calendar access
  // is plain member-level).
  { value: "sales", label: "Sales (Change Orders)" },
  // TrimGauge role (no calendar capabilities on its own). Admin or measure-tech
  // can sign in to TrimGauge and record/listen to job audio notes.
  { value: "measure-tech", label: "Measure Tech (TrimGauge)" },
  // Cut-list-app roles (no calendar capabilities on their own).
  { value: "configuring", label: "Configuring (Cut List)" },
  { value: "configuring-editing", label: "Configuring + Editing (Cut List)" },
  { value: "standalone-trim", label: "Standalone Trim Orders (Cut List)" },
  // Job-Auditor-app role: audits, site runs, returns and attention items there.
  // No calendar capabilities on its own; calendar access is plain member-level.
  { value: "inventory-specialist", label: "Inventory Specialist (Job Auditor)" },
  // Field installer — RESTRICTS rather than grants, and cannot be combined
  // with any other role (see installerRoleConflict). Needs a scheduling
  // resource assigned alongside it.
  { value: "installer", label: "Installer (restricted)" },
];

export const ROLE_LABELS: Record<string, string> = Object.fromEntries(
  ROLE_OPTIONS.map((r) => [r.value, r.label])
);

export const ROLE_STYLES: Record<string, string> = {
  admin: "bg-primary/15 text-primary",
  "payroll-admin": "bg-rba-green/15 text-rba-green",
  "payroll-approver": "bg-lime-500/15 text-lime-700 dark:text-lime-400",
  "field-manager": "bg-amber-500/15 text-amber-600",
  scheduling: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  scheduling_manager: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
  member: "bg-surface border border-border text-muted",
  "process-manager": "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  sales: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
  "measure-tech": "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  configuring: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  "configuring-editing": "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  "standalone-trim": "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
  "inventory-specialist": "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  installer: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
};
