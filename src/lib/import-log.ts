/**
 * Shared import log backed by Supabase `import_logs` table.
 * Entries auto-expire after 3 days — old rows are deleted on read.
 */

import { createClient } from "@supabase/supabase-js";

const TTL_DAYS = 3;

export interface ImportLogOrder {
  workOrderNumber: string;
  customerName: string;
  scheduledStart: string | null;
  action: "added" | "updated";
}

export interface ImportLogEntry {
  id: string;
  created_at: string;
  format: string;
  source: string;
  total_count: number;
  added_count: number;
  updated_count: number;
  orders: ImportLogOrder[];
}

/** Server-side only: get a service-role client */
function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/**
 * Server-side: write an import log entry.
 * Called from the upload API route after each successful import.
 */
export async function writeImportLog(entry: {
  format: string;
  source: string;
  total_count: number;
  added_count: number;
  updated_count: number;
  orders: ImportLogOrder[];
}): Promise<void> {
  const supabase = getServiceClient();

  // Insert the log entry (cap stored orders at 50)
  await supabase.from("import_logs").insert({
    format: entry.format,
    source: entry.source,
    total_count: entry.total_count,
    added_count: entry.added_count,
    updated_count: entry.updated_count,
    orders: entry.orders.slice(0, 50),
  });

  // Clean up entries older than 3 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - TTL_DAYS);
  await supabase
    .from("import_logs")
    .delete()
    .lt("created_at", cutoff.toISOString());
}

/**
 * Server-side: determine which order IDs are new vs. existing.
 * Called before upsert to figure out the diff.
 */
export async function diffOrderIds(
  ids: string[]
): Promise<Set<string>> {
  const supabase = getServiceClient();
  const existing = new Set<string>();

  // Query in batches of 500
  const BATCH = 500;
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const { data } = await supabase
      .from("work_orders")
      .select("id")
      .in("id", chunk);
    if (data) {
      for (const row of data) existing.add(row.id);
    }
  }

  return existing;
}
