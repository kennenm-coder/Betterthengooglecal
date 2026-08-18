import { createBrowserClient } from "@supabase/ssr";
import { SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/**
 * Browser Supabase client for all client-side data access.
 *
 * Uses @supabase/ssr's createBrowserClient (cookie-based session) — the SAME
 * session store as createAuthClient() — so requests carry the logged-in user's
 * JWT. This is required for any RLS policy that calls get_user_role(): a plain
 * createClient() would send anonymous requests (auth.jwt() null), which makes
 * inserts like field write-ups fail with a row-level-security violation even
 * for admins.
 */
export function getSupabase(): SupabaseClient | null {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    _client = createBrowserClient(url, key);
    return _client;
  } catch {
    return null;
  }
}
