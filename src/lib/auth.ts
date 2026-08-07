import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/hooks/useAuth";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}

interface AuthResult {
  user: AuthenticatedUser | null;
  error: NextResponse | null;
}

/**
 * Server-side role check for API routes.
 *
 * Returns the authenticated user with their role, or a ready-to-return
 * NextResponse error (401/403).
 *
 * Usage:
 *   const { user, error } = await requireRole("admin");
 *   if (error) return error;
 *   // user is guaranteed non-null here
 */
export async function requireRole(
  ...allowed: UserRole[]
): Promise<AuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return {
      user: null,
      error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }

  // Look up role from the allowlist — users not on the list are fully rejected
  const { data: row } = await supabase
    .from("allowed_emails")
    .select("role")
    .eq("email", user.email.toLowerCase())
    .maybeSingle();

  if (!row) {
    return {
      user: null,
      error: NextResponse.json(
        { error: "Access denied — not on the allowlist" },
        { status: 403 }
      ),
    };
  }

  const role: UserRole = (row.role as UserRole) || "member";

  if (allowed.length > 0 && !allowed.includes(role)) {
    return {
      user: null,
      error: NextResponse.json(
        { error: "Forbidden — insufficient role" },
        { status: 403 }
      ),
    };
  }

  return {
    user: { id: user.id, email: user.email, role },
    error: null,
  };
}

/**
 * Require that the request is authenticated (any role).
 * Convenience wrapper around requireRole().
 */
export async function requireAuth(): Promise<AuthResult> {
  return requireRole(); // empty allowed = any role accepted
}

/**
 * Get a Supabase admin client (service role).
 * Only call from server-side API routes.
 */
export function getAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");
  }
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * Check if the given email is the last admin in the system.
 * Used to prevent the final admin from removing/demoting themselves.
 */
export async function isLastAdmin(email: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: admins } = await supabase
    .from("allowed_emails")
    .select("email")
    .eq("role", "admin");

  if (!admins || admins.length === 0) return true;
  if (admins.length > 1) return false;
  return admins[0].email.toLowerCase() === email.toLowerCase();
}
