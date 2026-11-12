// Stores the JIP / Service answer (writeup-kind.ts) on write-ups that do not
// have one yet. Server only — it runs with the service-role client, because
// "has the job's rForce order dropped off the report" needs the import ledger,
// which no signed-in user can read.
//
// Two callers:
//   - the hourly work-order import (src/app/api/upload/route.ts), for every
//     write-up still without an answer — which on its first run after
//     migration 053 is all of them;
//   - POST /api/writeups/kind, right after a write-up is submitted, for that one
//     job, so the trim order it hands over can print its tracker straight away.
//
// Only rows with writeup_kind still null are written, and the update repeats
// that condition, so an answer is never changed once stored.

import type { SupabaseClient } from "@supabase/supabase-js";
import { offReportCutoff, type OrderRow } from "./writeup-stage";
import { batchKeyOf, decideWriteUpKinds, type KindDecision, type KindWriteUpRow } from "./writeup-kind";

const PAGE = 1000;
const CHUNK = 200;

interface StampRow extends KindWriteUpRow {
  order_number: string;
  writeup_kind: string | null;
}

export interface KindStampSummary {
  orders: number;
  stamped: number;
  /** Write-ups left blank because the job has no install date on file. */
  unknown: number;
}

async function loadAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function currentCutoff(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase
    .from("rforce_import_runs")
    .select("ran_at")
    .order("ran_at", { ascending: false })
    .limit(50);
  return offReportCutoff((data || []).map((r: { ran_at: string }) => r.ran_at));
}

/**
 * Stamp the write-ups on `orderNumbers` (or, with none given, on every job that
 * has a write-up without an answer). Throws on a database error — before
 * migration 053 the column is missing and the select fails.
 */
export async function stampWriteUpKinds(
  supabase: SupabaseClient,
  opts: { orderNumbers?: string[]; cutoff?: string | null } = {}
): Promise<KindStampSummary> {
  let orders = (opts.orderNumbers || []).map((o) => String(o || "").trim()).filter(Boolean);
  if (!opts.orderNumbers) {
    const pending = await loadAll<{ order_number: string }>((from, to) =>
      supabase
        .from("field_work_orders")
        .select("order_number")
        .is("writeup_kind", null)
        .neq("status", "draft")
        .order("id")
        .range(from, to)
    );
    orders = pending.map((r) => r.order_number).filter(Boolean);
  }
  orders = [...new Set(orders)];
  const summary: KindStampSummary = { orders: orders.length, stamped: 0, unknown: 0 };
  if (orders.length === 0) return summary;

  const cutoff = opts.cutoff !== undefined ? opts.cutoff : await currentCutoff(supabase);

  for (let i = 0; i < orders.length; i += CHUNK) {
    const chunk = orders.slice(i, i + CHUNK);
    const [writeUps, workOrders] = await Promise.all([
      loadAll<StampRow>((from, to) =>
        supabase
          .from("field_work_orders")
          .select("id, batch_id, order_number, created_at, status, job_closed_since, auto_closed_at, writeup_kind")
          .in("order_number", chunk)
          .order("id")
          .range(from, to)
      ),
      loadAll<OrderRow>((from, to) =>
        supabase
          .from("work_orders")
          .select("order_number, status, work_order_type, scheduled_start, updated_at")
          .in("order_number", chunk)
          .neq("work_order_type", "Account")
          .order("id")
          .range(from, to)
      ),
    ]);

    const wuBy = new Map<string, StampRow[]>();
    for (const w of writeUps) {
      const list = wuBy.get(w.order_number) || [];
      list.push(w);
      wuBy.set(w.order_number, list);
    }
    const woBy = new Map<string, OrderRow[]>();
    for (const o of workOrders) {
      const list = woBy.get(o.order_number) || [];
      list.push(o);
      woBy.set(o.order_number, list);
    }

    // Rows sharing one identical answer go in one update.
    const batches = new Map<string, { decision: KindDecision; ids: string[] }>();
    for (const orderNumber of chunk) {
      const rows = wuBy.get(orderNumber) || [];
      const decided = decideWriteUpKinds({ ownRows: woBy.get(orderNumber) || [], writeUps: rows, cutoff });
      for (const r of rows) {
        if (r.writeup_kind || r.status === "draft") continue;
        const d = decided.get(batchKeyOf(r));
        if (!d) {
          summary.unknown++;
          continue;
        }
        const k = JSON.stringify(d);
        const b = batches.get(k) || { decision: d, ids: [] as string[] };
        b.ids.push(r.id);
        batches.set(k, b);
      }
    }

    const nowIso = new Date().toISOString();
    for (const { decision, ids } of batches.values()) {
      const { error } = await supabase
        .from("field_work_orders")
        .update({ writeup_kind: decision.kind, writeup_kind_detail: decision.detail, writeup_kind_at: nowIso })
        .in("id", ids)
        .is("writeup_kind", null);
      if (error) throw new Error(`write-up kind update failed: ${error.message}`);
      summary.stamped += ids.length;
    }
  }
  return summary;
}
