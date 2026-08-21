// Single source of truth for role labels, styling, and capability gates.
// Both the client (button visibility) and the DB RLS policies must agree on
// who counts as a "field worker" — keep FIELD_WORK_ROLES in sync with the
// role checks in supabase/migrations/005_field_work_orders.sql.

import type { UserRole } from "@/hooks/useAuth";

/**
 * The plain admin role always has access to everything. Every capability gate
 * below short-circuits through this, so an admin can never be locked out of a
 * feature no matter how the other role lists change.
 */
export function isAdmin(role: UserRole | null | undefined): boolean {
  return role === "admin";
}

/** Roles allowed to create field write-ups and send field notes. */
export const FIELD_WORK_ROLES: UserRole[] = ["admin", "field-manager"];

/**
 * Can this role create field write-ups / send field notes?
 * Gates the Write-Up button and the Log Action (field notes) button.
 */
export function canDoFieldWork(role: UserRole | null | undefined): boolean {
  return isAdmin(role) || (!!role && FIELD_WORK_ROLES.includes(role));
}

/** Roles that can review/close write-ups and approve photo deletion (office). */
export function canReviewWriteUps(role: UserRole | null | undefined): boolean {
  return isAdmin(role) || role === "payroll-admin";
}

/**
 * Who can even SEE the Write-Ups tab. Limited to admin + field-manager for now
 * so the feature stays out of regular members' way during a soft rollout.
 * (Widen this later — e.g. add "payroll-admin" — to open it up.)
 */
export function canSeeWriteUps(role: UserRole | null | undefined): boolean {
  return isAdmin(role) || role === "field-manager";
}

/** Who can open/manage the Time Off screen. */
export function canManageTimeOff(role: UserRole | null | undefined): boolean {
  return isAdmin(role) || role === "payroll-admin" || role === "field-manager";
}

/** Assignable roles, in the order shown in the admin Team checkboxes. */
export const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "member", label: "Member" },
  { value: "field-manager", label: "Field Manager" },
  { value: "payroll-admin", label: "Payroll Admin" },
  { value: "scheduling", label: "Scheduling" },
  { value: "scheduling_manager", label: "Scheduling Manager" },
  { value: "admin", label: "Admin" },
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
};
