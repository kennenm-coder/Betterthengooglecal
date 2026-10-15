import { NextResponse } from "next/server";
import { requireAuth, getAdminClient } from "@/lib/auth";
import { TTL_DAYS } from "@/lib/import-log";
import { isInstaller } from "@/lib/roles";

// Import history for the /log page. These rows carry customer names, work
// order numbers and before/after values, and this route both reads them and
// prunes expired ones with the service-role key — so it must never answer an
// anonymous caller. Any allowlisted user may read it; the /log page is the
// only caller.
export async function GET() {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  // Not installers. This route answers with the service-role key, so RLS —
  // including the installer restrictions in 035 / 036 — does not touch it, and
  // the rows name customers on every crew's jobs. The /log tab is hidden from
  // them too; this is the half that actually holds.
  if (isInstaller(user?.roles)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Service role: pruning deletes rows no signed-in role is granted to delete.
  // getAdminClient() throws when the key is missing rather than silently
  // falling back to the anon key and half-working.
  const supabase = getAdminClient();

  // Clean up expired entries
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - TTL_DAYS);
  await supabase
    .from("import_logs")
    .delete()
    .lt("created_at", cutoff.toISOString());

  // Fetch remaining entries. Account imports and no-change imports are no
  // longer written, but rows from before that change can still be inside the
  // retention window — filter them out so the tab stays clean.
  const { data, error } = await supabase
    .from("import_logs")
    .select("*")
    .neq("format", "accounts_csv")
    .or("added_count.gt.0,updated_count.gt.0")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("[import-logs] read failed:", error.message);
    return NextResponse.json({ error: "Could not load import history." }, { status: 500 });
  }

  return NextResponse.json(data || []);
}
