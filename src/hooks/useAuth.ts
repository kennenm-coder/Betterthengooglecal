"use client";

import { useState, useEffect } from "react";
import { createAuthClient } from "@/lib/supabase/client";
import { clearSavedCalendarData } from "@/lib/store";
import { invalidateWriteUpsCache } from "@/lib/work-order-store";
import type { User } from "@supabase/supabase-js";

export type UserRole =
  | "admin"
  | "payroll-admin"
  | "payroll-approver"
  | "field-manager"
  | "scheduling"
  | "scheduling_manager"
  | "member"
  // Roles & Responsibilities app (TeamMangerRBANWO.com) editor. No calendar
  // capabilities; member-level in calendar.
  | "process-manager"
  // Change-order-app role (no calendar capabilities; member-level in calendar).
  | "sales"
  // TrimGauge (measure tech tool) + job audio notes. Member-level in the
  // calendar, plus Tech Measure tiles on the calendar and in Search (see
  // canSeeMeasureTiles in lib/roles). Admin or measure-tech can sign in to TrimGauge.
  | "measure-tech"
  // Cut-list-app roles (no calendar capabilities on their own). Managed here so
  // the shared allowed_emails table + Team UI stay the single source of truth.
  | "configuring"
  | "configuring-editing"
  // Cut-list role for standalone (QO-) trim orders only — no job access there.
  | "standalone-trim"
  // Job-Auditor-app role (no calendar capabilities; member-level in calendar).
  | "inventory-specialist"
  // Field installer. The one SUBTRACTIVE role: it restricts rather than grants,
  // so unlike every other role here it does not stack. Sees their own crew's
  // jobs in full and every other job trimmed. Requires sched_crew_id to be set
  // — see supabase/migrations/033_installer_role.sql.
  | "installer"
  // Install lead: restricted like installer (unless also field-manager), and
  // fills out More for More bonus sheets. See migration 045.
  | "installer-lead"
  // Puts More for More sheets in for every crew, auto-approved. Additive (not
  // restricted). Assigned in the NWO hub, not the calendar's Team page.
  | "mfm-submitter"
  // Reads the office kiosk's feedback on the Payroll Admin page, and nothing
  // else there. Additive; created in the NWO hub's roster-roles.ts.
  | "feedback"
  // Write-ups without the manager powers (see canWriteUps / isWriteUpRepOnly
  // in lib/roles.ts and migration 061). Created in the NWO hub.
  | "writeup-rep";

interface AuthState {
  user: User | null;
  /**
   * The display name an admin typed for this login on the Team page
   * (allowed_emails.name). Empty when none was set — never falls back to the
   * email, because the Measures screen matches rForce tech names against it
   * and an email address would just silently match nothing.
   */
  name: string;
  /** Primary role — drives calendar-app RLS and gating. */
  role: UserRole;
  /** Full multi-role set (superset of `role`); used by apps needing finer grain. */
  roles: string[];
  /** Extra emails to auto-CC on field notes for this user */
  autoCc: string[];
  /**
   * For installers: the crew names whose jobs are theirs — their own resource
   * and their install lead, aliases included. Empty for everyone else, and
   * empty for an installer whose login has no resource assigned yet, which is
   * what makes that case fail closed instead of showing the whole board.
   */
  crewNames: string[];
  loading: boolean;
}

const LOADING_STATE: AuthState = {
  user: null,
  name: "",
  role: "member",
  roles: [],
  autoCc: [],
  crewNames: [],
  loading: true,
};

// ONE shared copy of "who is signed in and what may they do", for the whole
// page. useAuth is called by the page, the bottom bar, the header bell, the
// data provider and every job tile on screen; before this, each of those fired
// its own sign-in check plus its own roles lookup every time it appeared, so a
// single tap on a tab sent dozens of identical requests. Now the first caller
// does the check, everyone else shares the answer, and it is only re-checked
// when it is old (STALE_MS), when the user signs in or out, or when a different
// account appears.
const STALE_MS = 5 * 60 * 1000;
let sharedState: AuthState = LOADING_STATE;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
let watching = false;
const listeners = new Set<(s: AuthState) => void>();

function publish(next: AuthState) {
  sharedState = next;
  listeners.forEach((fn) => fn(next));
}

// The last roles this phone was given, so the bottom bar can draw the right
// tabs the instant the app opens instead of starting from "no roles" and
// popping tabs in a moment later. DRAWING ONLY: nothing that grants access
// reads this, and pages, the server and the database all check for themselves.
const ROLES_CACHE_KEY = "auth:lastRoles";

function rememberRoles(roles: string[] | null) {
  try {
    if (roles) localStorage.setItem(ROLES_CACHE_KEY, JSON.stringify(roles));
    else localStorage.removeItem(ROLES_CACHE_KEY);
  } catch {
    /* storage unavailable (private mode) — the bar just waits for the check */
  }
}

/** Roles remembered from the last good check on this phone, or null. */
export function readRememberedRoles(): string[] | null {
  try {
    const raw = localStorage.getItem(ROLES_CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === "string") : null;
  } catch {
    return null;
  }
}

async function fetchAuth(): Promise<void> {
  const supabase = createAuthClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  // "No session at all" is a real signed-out answer. Anything else (weak
  // signal, the session renewing itself, a slow server) is a failed check, and
  // a failed check must not be read as "this person has no roles" — that is
  // what made tabs vanish for minutes at a time. Throwing keeps the last good
  // answer (see loadAuth) and leaves it stale so the next screen retries.
  if (userError && userError.name !== "AuthSessionMissingError") throw userError;

  let next: AuthState;
  if (user?.email) {
    const { data, error: rolesError } = await supabase
      .from("allowed_emails")
      .select("name, role, roles, auto_cc")
      .eq("email", user.email.toLowerCase())
      .maybeSingle();
    if (rolesError) throw rolesError;

    const roles = Array.isArray(data?.roles) && data.roles.length
      ? (data.roles as string[])
      : data?.role
        ? [data.role as string]
        : [];

    // Only installers and install leads need their crew names, and only they pay for the
    // extra round trip. my_crew_names() resolves the login through
    // sched_crews, which they cannot read directly (019).
    let crewNames: string[] = [];
    if (roles.includes("installer") || roles.includes("installer-lead")) {
      const { data: names, error: crewError } = await supabase.rpc("my_crew_names");
      if (crewError) throw crewError;
      crewNames = Array.isArray(names) ? names : [];
    }

    next = {
      user,
      name: typeof data?.name === "string" ? data.name.trim() : "",
      role: (data?.role as UserRole) || "member",
      roles,
      autoCc: Array.isArray(data?.auto_cc) ? data.auto_cc : [],
      crewNames,
      loading: false,
    };
  } else {
    next = { ...LOADING_STATE, user, loading: false };
  }

  fetchedAt = Date.now();
  rememberRoles(next.user ? next.roles : null);
  publish(next);
}

/** Run the check, or join the one already running. */
function loadAuth(force = false): Promise<void> {
  if (inflight) return inflight;
  if (!force && !sharedState.loading && Date.now() - fetchedAt < STALE_MS) {
    return Promise.resolve();
  }
  inflight = fetchAuth()
    .catch(() => {
      // Keep whatever we had; a failed check must not blank the screen (or the
      // tab bar). fetchedAt is left alone, so the next screen to open retries.
      // If we never had an answer, stop the spinner so pages can fall through.
      if (sharedState.loading) publish({ ...LOADING_STATE, loading: false });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

// Sign-in / sign-out in this same tab (the login page and account deletion move
// on without a full reload) must not leave the previous person's roles behind.
function watchSignInOut() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  createAuthClient().auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      fetchedAt = Date.now();
      rememberRoles(null);
      // Don't leave this person's saved calendar and write-ups on the device
      // for whoever signs in next (shared phones, the office PC).
      clearSavedCalendarData();
      invalidateWriteUpsCache();
      publish({ ...LOADING_STATE, loading: false });
    } else if (event === "SIGNED_IN" || event === "USER_UPDATED") {
      // The browser re-announces SIGNED_IN when a tab regains focus; only a
      // different account (or no answer yet) is worth a re-check. Deferred so
      // we never call back into Supabase from inside its own event handler.
      if (event === "SIGNED_IN" && session?.user?.id && session.user.id === sharedState.user?.id) return;
      setTimeout(() => void loadAuth(true), 0);
    }
  });
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>(sharedState);

  useEffect(() => {
    watchSignInOut();
    listeners.add(setState);
    // Catch up if the answer changed between render and effect.
    setState(sharedState);
    void loadAuth();
    return () => {
      listeners.delete(setState);
    };
  }, []);

  return state;
}
