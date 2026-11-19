// Single source of truth for role labels, styling, and capability gates.
// Both the client (button visibility) and the DB RLS policies must agree on
// who counts as a "field worker" — keep FIELD_WORK_ROLES in sync with the
// role checks in supabase/migrations/005_field_work_orders.sql.
//
// WHERE ROLES ARE CREATED: the NWO Hub (Kennen-s-App, nwotoolbox.com) — its
// Team tab and src/lib/roster-roles.ts. Do NOT add a new assignable role to
// ROLE_OPTIONS below; add it to the hub's list. This file only decides what a
// held role may DO in the calendar (the gates), and labels it for display.

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
  const held = toList(roles);
  if (held.includes("installer")) return true;
  // An install lead is restricted the same way, unless they also run the
  // field as a field manager — then field-manager access wins.
  return held.includes("installer-lead") && !held.includes("field-manager");
}

/**
 * Does this login hold the installer-lead role? (Admins who tick it for
 * testing count too.) Drives the More for More tab and hides Changes.
 */
export function isInstallerLead(roles: RoleInput): boolean {
  return toList(roles).includes("installer-lead");
}

/** Does this login need its scheduling crew resolved (installer or lead)? */
export function needsCrew(roles: RoleInput): boolean {
  const held = toList(roles);
  return held.includes("installer") || held.includes("installer-lead");
}

/**
 * Who fills out a More for More: install leads (and admins, to test).
 * Mirrors the mfm_insert policy in migration 045.
 */
export function canFillMoreForMore(roles: RoleInput): boolean {
  return hasAny(roles, ["installer-lead", "admin"]);
}

/**
 * The More for More Submitter: someone who puts sheets in for EVERY crew
 * (not just their own) and whose submit approves the sheet on the spot.
 * Additive — it restricts nobody. Assigned in the NWO hub; this app only
 * reads it. Mirrors the mfm-submitter checks in migrations 055/056.
 *
 * Admins count too, like every other gate (Kennen, 2026-11-17): they get the
 * submitter's More for More list, the green More for More button and the
 * rest. The database already lets admins do all of it as payroll.
 */
export function isMfmSubmitter(roles: RoleInput): boolean {
  return isAdmin(roles) || toList(roles).includes("mfm-submitter");
}

/** Who gets the More for More tab at all: leads, submitters, and admins. */
export function canSeeMoreForMore(roles: RoleInput): boolean {
  return canFillMoreForMore(roles) || isMfmSubmitter(roles);
}

/**
 * Who does the office part of a More for More — deductions, final pay,
 * completing, sending back, on-paper sheets, PDF and Excel: the More for More
 * tab on the Payroll Admin page. Payroll admins, admins, and (056) the More for
 * More Submitter. Mirrors the role lists in migration 056.
 */
export function canProcessMoreForMore(roles: RoleInput): boolean {
  return hasAny(roles, ["admin", "payroll-admin", "mfm-submitter"]);
}

/**
 * The parts of More for More that stay with payroll only: deleting a sheet
 * and the settings page (bonus rates, people and tiers). Kennen, 2026-11-17:
 * the submitter does everything else. Mirrors mfm_delete and the settings
 * write policies (045, 047).
 */
export function canManageMoreForMore(roles: RoleInput): boolean {
  return hasAny(roles, ["admin", "payroll-admin"]);
}

/**
 * Who files a Job Complete report from an install tile: install leads, and
 * admins (to test). Nobody else sees the button, so until someone is given
 * the installer-lead role this feature is invisible. Mirrors the jc_insert
 * policy in migration 058.
 */
export function canSubmitJobComplete(roles: RoleInput): boolean {
  return hasAny(roles, ["installer-lead", "admin"]);
}

/**
 * Who can READ Job Complete reports (the tile tag, and the Write-Ups page
 * section): the leads (their own), and the office roles. Mirrors jc_read in
 * migration 058.
 */
export function canSeeJobCompletions(roles: RoleInput): boolean {
  return hasAny(roles, [
    "installer-lead",
    "admin",
    "field-manager",
    "payroll-admin",
    "scheduling",
    "scheduling_manager",
  ]);
}

/** Who marks a flagged Job Complete reviewed. Mirrors jc_update in 058. */
export function canReviewJobCompletions(roles: RoleInput): boolean {
  return hasAny(roles, ["admin", "field-manager", "payroll-admin"]);
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
  if (roles.includes("installer") && roles.length > 1) return true;
  // An install lead may also be a field manager (that lifts the restriction
  // and adds Write-Ups); any other pairing would be ignored by the
  // restriction, so it is refused for the same reason as above.
  if (roles.includes("installer-lead")) {
    return roles.some((r) => r !== "installer-lead" && r !== "field-manager");
  }
  return false;
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

/** Roles that run the field: field managers (and admins). Gates the field
 *  manager tools (Loading Schedule, Catalogs, Log Action) and full write-up
 *  editing — editing anyone's write-up, closing it, deleting it. */
export const FIELD_WORK_ROLES: UserRole[] = ["admin", "field-manager"];

/**
 * Can this user create field write-ups / send field notes?
 * Gates the Write-Up button and the Log Action (field notes) button.
 */
export function canDoFieldWork(roles: RoleInput): boolean {
  return hasAny(roles, FIELD_WORK_ROLES);
}

// ─── Write-Up Rep ───────────────────────────────────────────────────────────
//
// `writeup-rep` does write-ups the way a field manager does — start one,
// submit it (the email goes out on submit), photos, trim, check off work — but
// without the manager powers: no approving, closing, reopening, archiving or
// deleting, and they edit only the write-ups THEY started. Editing one that was
// already approved sends it back to In Review for a manager to approve again.
//
// The database enforces the same thing (migration 061): own-rows-only updates,
// and a trigger that refuses any status change past In Review or any new
// "reviewed" stamp from a rep. These helpers only decide what to draw.

/**
 * Who can do write-ups at all: the New write-up / hammer buttons, submitting,
 * photos, the trim handoff, resending the email. Field managers and admins,
 * plus Write-Up Reps. Mirrors the insert policy in migration 061.
 */
export function canWriteUps(roles: RoleInput): boolean {
  return canDoFieldWork(roles) || hasAny(roles, ["writeup-rep"]);
}

/**
 * Who gets notifications today, and so who is offered phone buzzes once on
 * the calendar (PushInvite). Field managers and admins — the only people any
 * notification is sent to so far (a Write-Up Rep's submit/edit). Widen this
 * when a new kind of notification goes to someone else (Job Alert, a rep's
 * write-up approved), or the invite will keep missing the people it's for.
 */
export function receivesNotifications(roles: RoleInput): boolean {
  return canDoFieldWork(roles);
}

/**
 * A Write-Up Rep with no field-manager powers on top. Their edits are limited
 * to their own write-ups and send approved ones back for re-approval; their
 * Write-Ups-page check-offs go through the crew check-off function.
 */
export function isWriteUpRepOnly(roles: RoleInput): boolean {
  return hasAny(roles, ["writeup-rep"]) && !canDoFieldWork(roles);
}

/**
 * Can this login edit THIS write-up (all of its rows)? Field managers and
 * admins edit any. A Write-Up Rep edits only the ones they started — every row
 * must carry their login email as created_by. Mirrors the update policy in
 * migration 061.
 */
export function canEditWriteUp(
  roles: RoleInput,
  email: string | null | undefined,
  rows: { createdBy?: string | null }[]
): boolean {
  if (canDoFieldWork(roles)) return true;
  if (!hasAny(roles, ["writeup-rep"]) || !email || rows.length === 0) return false;
  const me = email.toLowerCase();
  return rows.every((r) => (r.createdBy || "").toLowerCase() === me);
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
  // Write-Up Reps are deliberately NOT here: approving, reopening, archiving
  // and the archive?/still-open? questions are manager-only. Migration 061's
  // trigger refuses the status changes in the database too.
  return hasAny(roles, ["admin", "payroll-admin", "field-manager"]);
}

/**
 * Who checks off write-up work from a service tile and its Active Write-Ups
 * page — the three-choice popup (complete / complete + more issues / not
 * complete). Crews on any job, not just their own. Mirrors the role list in
 * writeup_crew_set_done() and the insert policy in migration 054.
 */
export function canCheckOffWriteUps(roles: RoleInput): boolean {
  return hasAny(roles, ["admin", "field-manager", "installer", "installer-lead", "writeup-rep"]);
}

/** Who can uncheck someone else's check-off. Anyone can undo their own. */
export function canUndoAnyCheckOff(roles: RoleInput): boolean {
  return hasAny(roles, ["admin", "field-manager"]);
}

/**
 * Who can even SEE the Write-Ups tab. Admin + field-manager get full access;
 * scheduling + scheduling-manager get VIEW-ONLY (read, copy, download/print) —
 * they can't create, edit, review, delete, or toggle completion (gated by
 * canDoFieldWork / canReviewWriteUps, which exclude them).
 */
export function canSeeWriteUps(roles: RoleInput): boolean {
  return hasAny(roles, ["admin", "field-manager", "scheduling", "scheduling_manager", "writeup-rep"]);
}

/**
 * Who can open ONE write-up's document page (/work-orders/<job>), which is where
 * the material list app's "Look at write-up" button lands. The people placing
 * trim orders (configuring, configuring-editing, standalone-trim) need to read
 * the write-up while they work the order, but they do not get the Write-Ups tab
 * or any ability to change one -- this is view-only and only for that page. The
 * database already lets any signed-in, allowlisted user read the table.
 */
export function canViewWriteUpDoc(roles: RoleInput): boolean {
  return (
    canSeeWriteUps(roles) ||
    hasAny(roles, ["configuring", "configuring-editing", "standalone-trim"])
  );
}

/**
 * Who can read the kiosk's feedback (ideas, comments, questions, complaints).
 *
 * Deliberately narrower than the rest of the Payroll Admin page: feedback can be
 * about anyone, payroll and managers included, so payroll admins do not get it
 * just by being payroll admins. It is admins plus the `feedback` role, which is
 * handed out in the NWO hub. Mirrors OPEN_ROLES.feedback in the kiosk's
 * src/lib/mail/recipients.ts, and the hub's Feedback email card.
 */
export function canReadFeedback(roles: RoleInput): boolean {
  return hasAny(roles, ["admin", "feedback"]);
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

// ─── Measure techs ──────────────────────────────────────────────────────────
//
// `measure-tech` is a TrimGauge role first: it opens the measuring app. In the
// calendar it adds exactly one thing — Tech Measure appointments, drawn as their
// own colour of tile on the calendar and listed in Search. Admins get the same
// tiles without ticking the role. Nobody else's calendar changes, and a
// restricted installer never gets them.
//
// This is UI scoping, not access control. work_orders' read policy lets every
// allowlisted non-installer read every row (035), so any other login CAN query
// Tech Measure rows; the calendar simply does not ask for them.

/** Does this login's calendar and search include Tech Measure tiles? */
export function canSeeMeasureTiles(roles: RoleInput): boolean {
  if (isInstaller(roles)) return false;
  return isAdmin(roles) || hasAny(roles, ["measure-tech"]);
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

/**
 * Who can open the Chat tab (GroupMe installer conversations).
 *
 * Admin ONLY for now — this is a pilot. Each person signs in to THEIR OWN
 * GroupMe account and picks which of their groups show in Chat (migration 067).
 *
 * To widen it, change it in both places together: here, and the role checks
 * in the /api/groupme/* routes (chatContext() in src/lib/groupme-route.ts plus
 * connect/connection/callback/read).
 */
export function canUseInstallerChat(roles: RoleInput): boolean {
  return isAdmin(roles);
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
  // TrimGauge role. Admin or measure-tech can sign in to TrimGauge and
  // record/listen to job audio notes. In the calendar it adds one thing —
  // Tech Measure tiles on the calendar and in Search (see canSeeMeasureTiles).
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
  // Install lead — restricted like Installer, plus the More for More tab.
  // May be paired with Field Manager only, which lifts the restriction.
  // Needs a scheduling resource assigned alongside it.
  { value: "installer-lead", label: "Installer Lead (More for More)" },
];

export const ROLE_LABELS: Record<string, string> = {
  ...Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label])),
  // Not in ROLE_OPTIONS on purpose: it is handed out in the NWO hub, so it
  // gets no checkbox on this app's Team page. Labelled here for badges only.
  "mfm-submitter": "More for More Submitter",
  // Handed out in the NWO hub (it creates roster roles), so it gets no checkbox here.
  feedback: "Feedback",
  // Handed out in the NWO hub, so it gets no checkbox here.
  "writeup-rep": "Write-Up Rep",
};

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
  "installer-lead": "bg-stone-500/15 text-stone-700 dark:text-stone-300",
  "mfm-submitter": "bg-rba-green/15 text-rba-green",
  feedback: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
  "writeup-rep": "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
};
