"use client";

import { useState, useEffect } from "react";
import { createAuthClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

export type UserRole = "admin" | "payroll-admin" | "member";

interface AuthState {
  user: User | null;
  role: UserRole;
  loading: boolean;
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    user: null,
    role: "member",
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
          .select("role")
          .eq("email", user.email.toLowerCase())
          .maybeSingle();

        setState({
          user,
          role: (data?.role as UserRole) || "member",
          loading: false,
        });
      } else {
        setState({ user, role: "member", loading: false });
      }
    }

    load();
  }, []);

  return state;
}
