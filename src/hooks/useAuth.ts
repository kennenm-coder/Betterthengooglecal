"use client";

import { useState, useEffect } from "react";
import { createAuthClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

export type UserRole = "admin" | "payroll-admin" | "member";

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

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    user: null,
    role: "member",
    roles: [],
    autoCc: [],
    loading: true,
  });

  useEffect(() => {
    const supabase = createAuthClient();

    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

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

        setState({
          user,
          role: (data?.role as UserRole) || "member",
          roles,
          autoCc: Array.isArray(data?.auto_cc) ? data.auto_cc : [],
          loading: false,
        });
      } else {
        setState({ user, role: "member", roles: [], autoCc: [], loading: false });
      }
    }

    load();
  }, []);

  return state;
}
