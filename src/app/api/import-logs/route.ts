import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const TTL_DAYS = 3;

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Clean up old entries
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - TTL_DAYS);
  await supabase
    .from("import_logs")
    .delete()
    .lt("created_at", cutoff.toISOString());

  // Fetch remaining entries
  const { data, error } = await supabase
    .from("import_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}
