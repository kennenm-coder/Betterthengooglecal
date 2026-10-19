import { getSupabase } from "./supabase";

// ─── Tying warehouse rows to jobs ───────────────────────────────────────────
// Orca's inventory rows carry the factory's 7-digit `Job Order Number`. This
// app keys everything on our 8-digit `order_number`. Fewer than one row in ten
// carries both, so most mirrored rows resolve to no job at all and the install
// page correctly says "nothing in the warehouse is matched to this job yet".
//
// Migration 039 ships the fix: `orca_job_links` maps one to the other, and a
// trigger back-fills every already-mirrored row the moment a link is inserted.
// This file is what drives it — the office's way of answering, per factory
// job, "that one is ours, here is its order number".
//
// Nothing here touches Orca. These are our own tables, and `orca_rows` is
// read-only from this side: the webhook receiver owns it.

/** One factory job with rows in the warehouse that match nothing of ours. */
export interface UnmatchedGroup {
  jobOrderNumber: string;
  rowCount: number;
  /** A few row descriptions, so the office can tell what the job is. */
  samples: string[];
  /** Customer-ish names off the rows, e.g. "Abbott,Kelly" — the only clue
   *  Orca gives about whose job this is. */
  names: string[];
}

export interface OrcaLink {
  jobOrderNumber: string;
  orderNumber: string;
  source: string;
  createdAt: string | null;
  /** How many mirror rows currently resolve through this link. */
  rowCount: number;
}

export interface MatchCounts {
  matched: number;
  unmatched: number;
}

interface UnmatchedRowShape {
  job_order_number: string | null;
  description: string | null;
  name: string | null;
}

/**
 * Factory jobs with unmatched rows, worst offender first.
 *
 * Grouped here rather than in SQL because the mirror is small enough (low
 * thousands of rows) that one read is cheaper than a view plus a migration,
 * and because the sample descriptions want de-duplicating anyway.
 */
export async function fetchUnmatchedGroups(): Promise<
  { kind: "ok"; groups: UnmatchedGroup[] } | { kind: "unavailable"; detail: string }
> {
  const supabase = getSupabase();
  if (!supabase) return { kind: "unavailable", detail: "Not signed in." };

  const { data, error } = await supabase
    .from("orca_rows")
    .select("job_order_number, description, name")
    .is("order_number", null)
    .is("deleted_at", null)
    .not("job_order_number", "is", null);

  if (error) return { kind: "unavailable", detail: error.message };

  const byJob = new Map<string, UnmatchedGroup>();
  for (const r of (data || []) as UnmatchedRowShape[]) {
    const job = (r.job_order_number || "").trim();
    if (!job) continue;
    let g = byJob.get(job);
    if (!g) {
      g = { jobOrderNumber: job, rowCount: 0, samples: [], names: [] };
      byJob.set(job, g);
    }
    g.rowCount++;
    const desc = (r.description || "").trim();
    if (desc && g.samples.length < 3 && !g.samples.includes(desc)) g.samples.push(desc);
    const nm = (r.name || "").trim();
    if (nm && !g.names.includes(nm)) g.names.push(nm);
  }

  return {
    kind: "ok",
    groups: [...byJob.values()].sort((a, b) => b.rowCount - a.rowCount),
  };
}

/** Links already made, newest first, with how many rows each one resolves. */
export async function fetchLinks(): Promise<OrcaLink[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("orca_job_links")
    .select("job_order_number, order_number, source, created_at")
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  // One count query per link would be a round trip each. Reading the job
  // numbers back in one go and tallying locally is a single request.
  const { data: rows } = await supabase
    .from("orca_rows")
    .select("job_order_number")
    .not("order_number", "is", null)
    .is("deleted_at", null);

  const counts = new Map<string, number>();
  for (const r of (rows || []) as { job_order_number: string | null }[]) {
    const job = (r.job_order_number || "").trim();
    if (job) counts.set(job, (counts.get(job) || 0) + 1);
  }

  return data.map((l) => ({
    jobOrderNumber: l.job_order_number as string,
    orderNumber: l.order_number as string,
    source: l.source as string,
    createdAt: (l.created_at as string) ?? null,
    rowCount: counts.get((l.job_order_number as string) || "") || 0,
  }));
}

/** The headline: how much of the warehouse this app can actually place. */
export async function fetchMatchCounts(): Promise<MatchCounts | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const [matched, unmatched] = await Promise.all([
    supabase
      .from("orca_rows")
      .select("*", { count: "exact", head: true })
      .not("order_number", "is", null)
      .is("deleted_at", null),
    supabase
      .from("orca_rows")
      .select("*", { count: "exact", head: true })
      .is("order_number", null)
      .is("deleted_at", null),
  ]);

  if (matched.error || unmatched.error) return null;
  return { matched: matched.count ?? 0, unmatched: unmatched.count ?? 0 };
}

/**
 * Save a link. The trigger from migration 039 back-fills every mirrored row
 * for that factory job, so the number this returns is how many rows the office
 * just placed — which is the only feedback that means anything here.
 */
export async function saveLink(
  jobOrderNumber: string,
  orderNumber: string
): Promise<{ ok: true; resolved: number } | { ok: false; error: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Not signed in." };

  const job = jobOrderNumber.trim();
  const order = orderNumber.trim();
  if (!/^[0-9]{8}$/.test(order)) {
    return { ok: false, error: "An order number is 8 digits." };
  }

  const { error } = await supabase
    .from("orca_job_links")
    .upsert(
      { job_order_number: job, order_number: order, source: "manual" },
      { onConflict: "job_order_number" }
    );

  if (error) return { ok: false, error: error.message };

  // Count after the fact rather than trusting the trigger silently.
  const { count } = await supabase
    .from("orca_rows")
    .select("*", { count: "exact", head: true })
    .eq("job_order_number", job)
    .eq("order_number", order)
    .is("deleted_at", null);

  return { ok: true, resolved: count ?? 0 };
}

/**
 * Remove a link.
 *
 * Deleting the row does NOT undo the back-fill — the trigger wrote
 * `order_number` onto the mirror rows and nothing takes it off again. So the
 * rows are cleared here first, then the resolver is re-run, which puts back
 * any order number the row could still work out for itself (a Customer PO, a
 * cut-list barcode). Without that, a wrong link would be impossible to undo.
 */
export async function removeLink(
  jobOrderNumber: string
): Promise<{ ok: true; cleared: number } | { ok: false; error: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Not signed in." };

  const job = jobOrderNumber.trim();
  const { error: delError } = await supabase
    .from("orca_job_links")
    .delete()
    .eq("job_order_number", job);

  if (delError) return { ok: false, error: delError.message };

  // Deleting the link does not undo the back-fill on its own, so this puts
  // the rows back to whatever they can still work out for themselves. It
  // returns how many actually changed (migration 040).
  const { data: cleared, error: clearError } = await supabase.rpc(
    "orca_clear_job_order",
    { p_job_order_number: job }
  );
  if (clearError) return { ok: false, error: clearError.message };

  return { ok: true, cleared: typeof cleared === "number" ? cleared : 0 };
}

// ─── Suggestions ────────────────────────────────────────────────────────────

export interface Suggestion {
  orderNumber: string;
  customerName: string;
  /** Why it is being suggested, in words, so the office can judge it. */
  because: string;
}

/**
 * Guess which of our jobs a factory job belongs to.
 *
 * The only clue Orca gives is the `Name` column, which on factory rows holds a
 * customer in `Surname,Firstname` form. That is matched against the customer
 * names on our work orders.
 *
 * This only ever SUGGESTS. A surname match is not identification — there are
 * two Johnsons on the board most months — so the office confirms every one.
 */
export function suggestOrders(
  group: UnmatchedGroup,
  orders: { orderNumber: string; customerName: string }[]
): Suggestion[] {
  const parts = new Set<string>();
  for (const raw of group.names) {
    for (const piece of raw.split(/[,/]/)) {
      const p = piece.trim().toLowerCase();
      // Two characters is noise; so are the bare numbers in rows like
      // "-,04794151/097".
      if (p.length >= 3 && !/^\d+$/.test(p)) parts.add(p);
    }
  }
  if (parts.size === 0) return [];

  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const o of orders) {
    const name = (o.customerName || "").toLowerCase();
    if (!name) continue;
    const hit = [...parts].find((p) => name.includes(p));
    if (!hit) continue;
    if (seen.has(o.orderNumber)) continue;
    seen.add(o.orderNumber);
    out.push({
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      because: `"${hit}" is in the warehouse row's name`,
    });
    if (out.length >= 5) break;
  }
  return out;
}
