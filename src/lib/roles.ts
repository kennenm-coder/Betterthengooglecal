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
 * Roles that can review/close write-ups and approve photo deletion.
 * Field managers run the full review lifecycle alongside the office
 * (admin + payroll-admin): mark reviewed, close, reopen, archive.
 */
export function canReviewWriteUps(roles: RoleInput): boolean {
  return hasAny(roles, ["admin", "payroll-admin", "field-manager"]);
}

/**
 * Who can even SEE the Write-Ups tab. Limited to admin + field-manager for now
 * so the feature stays out of regular members' way during a soft rollout.
 * (Widen this later — e.g. add "payroll-admin" — to open it up.)
 */
export function canSeeWriteUps(roles: RoleInput): boolean {
  return hasAny(roles, ["admin", "field-manager"]);
}

/** Who can open/manage the Time Off screen. */
export function canManageTimeOff(roles: RoleInput): boolean {
  return hasAny(roles, ["admin", "payroll-admin", "field-manager"]);
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
  { value: "scheduling", label: "Scheduling" },
  { value: "scheduling_manager", label: "Scheduling Manager" },
  { value: "admin", label: "Admin" },
  // Change-order-app role (no calendar capabilities on its own; calendar access
  // is plain member-level).
  { value: "sales", label: "Sales (Change Orders)" },
  // Cut-list-app roles (no calendar capabilities on their own).
  { value: "configuring", label: "Configuring (Cut List)" },
  { value: "configuring-editing", label: "Configuring + Editing (Cut List)" },
];

export const ROLE_LABELS: Record<string, string> = Object.fromEntries(
  ROLE_OPTIONS.map((r) => [r.value, r.label])
);

export const ROLE_STYLES: Record<string, string> = {
  admin: "bg-primary/15 text-primary",
  "payroll-admin": "bg-rba-green/15 text-rba-green",
  "field-manager": "bg-amber-500/15 text-amber-600",
  scheduling: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  scheduling_manager: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
  member: "bg-surface border border-border text-muted",
  sales: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
  configuring: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  "configuring-editing": "bg-purple-500/15 text-purple-600 dark:text-purple-400",
};
