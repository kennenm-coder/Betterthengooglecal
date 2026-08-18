"use client";

import { useState, useEffect } from "react";
import { createAuthClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

export type UserRole = "admin" | "payroll-admin" | "field-manager" | "member";

interface AuthState {
  user: User | null;
  role: UserRole;
  /** Extra emails to auto-CC on field notes for this user */
  autoCc: string[];
  loading: boolean;
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    user: null,
    role: "member",
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
          .select("role, auto_cc")
          .eq("email", user.email.toLowerCase())
          .maybeSingle();

        setState({
          user,
          role: (data?.role as UserRole) || "member",
          autoCc: Array.isArray(data?.auto_cc) ? data.auto_cc : [],
          loading: false,
        });
      } else {
        setState({ user, role: "member", autoCc: [], loading: false });
      }
    }

    load();
  }, []);

  return state;
}
