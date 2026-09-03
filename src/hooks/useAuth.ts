"use client";

import { useState, useEffect } from "react";
import { createAuthClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

export type UserRole =
  | "admin"
  | "payroll-admin"
  | "field-manager"
  | "scheduling"
  | "scheduling_manager"
  | "member"
  // Change-order-app role (no calendar capabilities; member-level in calendar).
  | "sales"
  // Cut-list-app roles (no calendar capabilities on their own). Managed here so
  // the shared allowed_emails table + Team UI stay the single source of truth.
  | "configuring"
  | "configuring-editing";

interface AuthState {
  user: User | null;
  /** Primary role — drives calendar-app RLS and gating. */
  role: UserRole;
  /** Full multi-role set (superset of `role`); used by apps needing finer grain. */
  roles: string[];
  /** Extra emails to auto-CC on field notes for this user */
  autoCc: string[];
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

        next = {
          user,
          role: (data?.role as UserRole) || "member",
          roles,
          autoCc: Array.isArray(data?.auto_cc) ? data.auto_cc : [],
          loading: false,
        };
      } else {
        next = { user, role: "member", roles: [], autoCc: [], loading: false };
      }

      cachedState = next;
      setState(next);
    }

    load();
  }, []);

  return state;
}
