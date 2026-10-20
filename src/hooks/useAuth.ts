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
  // TrimGauge (measure tech tool) + job audio notes. No calendar capabilities;
  // member-level in calendar. Admin or measure-tech can sign in to TrimGauge.
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
  | "installer";

interface AuthState {
  user: User | null;
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

// Module-level cache of the last resolved auth state. useAuth remounts on every
// page navigation (BottomNav, headers, etc.); without this cache each mount
// would reset role to "member" until the async fetch returns, making
// role-gated UI (e.g. the Write-Ups tab) flicker in and out on every route
// change. Starting from the cached value keeps it stable.
let cachedState: AuthState | null = null;

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>(
    cachedState ?? {
      user: null,
      role: "member",
      roles: [],
      autoCc: [],
      crewNames: [],
      loading: true,
    }
  );

  useEffect(() => {
    const supabase = createAuthClient();

    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      let next: AuthState;
      if (user?.email) {
        const { data } = await supabase
          .from("allowed_emails")
          .select("role, roles, auto_cc")
          .eq("email", user.email.toLowerCase())
          .maybeSingle();

        const roles = Array.isArray(data?.roles) && data.roles.length
          ? (data.roles as string[])
          : data?.role
            ? [data.role as string]
            : [];

        // Only installers need their crew names, and only they pay for the
        // extra round trip. my_crew_names() resolves the login through
        // sched_crews, which they cannot read directly (019).
        let crewNames: string[] = [];
        if (roles.includes("installer")) {
          const { data: names } = await supabase.rpc("my_crew_names");
          crewNames = Array.isArray(names) ? names : [];
        }

        next = {
          user,
          role: (data?.role as UserRole) || "member",
          roles,
          autoCc: Array.isArray(data?.auto_cc) ? data.auto_cc : [],
          crewNames,
          loading: false,
        };
      } else {
        next = {
          user,
          role: "member",
          roles: [],
          autoCc: [],
          crewNames: [],
          loading: false,
        };
      }

      cachedState = next;
      setState(next);
    }

    load();
  }, []);

  return state;
}
