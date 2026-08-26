import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/hooks/useAuth";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export interface AuthenticatedUser {
  id: string;
  email: string;
  /** Primary (collapsed) role — kept for callers/RLS that key off one role. */
  role: UserRole;
  /** Full multi-role set. Access checks should use this, not `role`. */
  roles: UserRole[];
}

interface AuthResult {
  user: AuthenticatedUser | null;
  error: NextResponse | null;
}

/**
 * Server-side role check for API routes.
 *
 * Accounts can hold several roles (allowed_emails.roles). Access is the UNION
 * of what all held roles allow: the request is authorized if ANY held role is
 * in `allowed`. Mirrors the client-side gates in src/lib/roles.ts.
 *
 * Returns the authenticated user (with the full `roles` set and a collapsed
 * primary `role`), or a ready-to-return NextResponse error (401/403).
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

  // Look up roles from the allowlist — users not on the list are fully rejected
  const { data: row } = await supabase
    .from("allowed_emails")
    .select("role, roles")
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

  // Normalize to the full role set (handles legacy rows with only `role`).
  const roles: UserRole[] = (
    Array.isArray(row.roles) && row.roles.length
      ? (row.roles as UserRole[])
      : row.role
        ? [row.role as UserRole]
        : ["member"]
  );
  // Collapsed primary role, kept for callers/RLS that expect a single value.
  const role: UserRole = (row.role as UserRole) || roles[0] || "member";

  // Grant if ANY held role qualifies — the union of every role's "yeses".
  if (allowed.length > 0 && !roles.some((r) => allowed.includes(r))) {
    return {
      user: null,
      error: NextResponse.json(
        { error: "Forbidden — insufficient role" },
        { status: 403 }
      ),
    };
  }

  return {
    user: { id: user.id, email: user.email, role, roles },
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
