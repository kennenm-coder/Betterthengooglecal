"use client";

import { useState, useEffect } from "react";
import { createAuthClient } from "@/lib/supabase/client";
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
  | "installer-lead";

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

async function fetchAuth(): Promise<void> {
  const supabase = createAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let next: AuthState;
  if (user?.email) {
    const { data } = await supabase
      .from("allowed_emails")
      .select("name, role, roles, auto_cc")
      .eq("email", user.email.toLowerCase())
      .maybeSingle();

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
      const { data: names } = await supabase.rpc("my_crew_names");
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
      // Keep whatever we had; a failed check must not blank the screen. If we
      // never had an answer, stop the spinner so pages can fall through.
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
