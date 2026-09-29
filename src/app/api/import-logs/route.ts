import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { TTL_DAYS } from "@/lib/import-log";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}
