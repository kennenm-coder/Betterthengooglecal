// Server side of the write-up stage tags and the Job Closed auto-close. Runs at
// the end of every work-order import (src/app/api/upload/route.ts), with the
// service-role client, so it works whether or not anyone has the app open.
//
// For every OPEN write-up it:
//   1. finds the write-up's own rForce order, plus every Service / Job Site
//      Visit order at the same address (address-match.ts);
//   2. works out the stage (writeup-stage.ts) and stores it on the row;
//   3. when every one of those orders is off the report, starts the Job Closed
//      clock (job_closed_since); when anything reopens, clears it;
//   4. seven days after the clock started, closes the write-up, ticking off any
//      work items nobody checked.
//
// Only rows already marked Open are touched — In Review waits for the office.
// A write-up this closed and someone reopened by hand is never closed again.

import type { SupabaseClient } from "@supabase/supabase-js";
import { addressKey, addressesMatch, type AddressKey } from "./address-match";
import {
  autoCloseAt,
  computeStage,
  offReportCutoff,
  type OrderRow,
  type StageDetail,
  type StageKey,
} from "./writeup-stage";

/** An import this much smaller than usual is treated as a cut-off report:
 *  logged, but nothing is judged from it. */
const SHORT_IMPORT_RATIO = 0.7;
const LEDGER_KEEP_DAYS = 60;
const PAGE = 1000;

interface WriteUpRow {
  id: string;
  order_number: string;
  address: string | null;
  line_items: { completed?: boolean }[] | null;
  rforce_stage: string | null;
  rforce_stage_detail: StageDetail | null;
  job_closed_since: string | null;
  auto_closed_at: string | null;
}

interface WorkOrderRow extends OrderRow {
  address: string | null;
}

export interface AutoCloseSummary {
  skipped?: string;
  writeUps: number;
  jobClosed: number;
  autoClosed: number;
  legacy: number;
  changed: number;
}

export interface AutoClosePlanRow {
  id: string;
  orderNumber: string;
  stage: StageKey;
  detail: StageDetail;
  jobClosedSince: string | null;
  autoClose: boolean;
  changed: boolean;
}

/** Record this import in the ledger. Returns false when it looks cut off. */
export async function logImportRun(
  supabase: SupabaseClient,
  ranAt: string,
  rowCount: number
): Promise<{ trusted: boolean }> {
  const { data: prev } = await supabase
    .from("rforce_import_runs")
    .select("row_count")
    .order("ran_at", { ascending: false })
    .limit(10);
  const counts = (prev || []).map((r: { row_count: number }) => r.row_count).sort((a, b) => a - b);
  const median = counts.length ? counts[Math.floor(counts.length / 2)] : 0;
  const trusted = counts.length < 3 || rowCount >= median * SHORT_IMPORT_RATIO;

  await supabase.from("rforce_import_runs").insert({ ran_at: ranAt, row_count: rowCount });
  const keepAfter = new Date(Date.now() - LEDGER_KEEP_DAYS * 24 * 3600_000).toISOString();
  await supabase.from("rforce_import_runs").delete().lt("ran_at", keepAfter);
  return { trusted };
}

/** Postgres hands jsonb back with its keys reordered, so compare by content. */
function canon(o: StageDetail | null | undefined): string {
  if (!o) return "null";
  const rec = o as Record<string, unknown>;
  return JSON.stringify(
    Object.keys(rec)
      .filter((k) => rec[k] !== undefined)
      .sort()
      .map((k) => [k, rec[k]])
  );
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

/**
 * Work out every open write-up's stage and what should change, without
 * writing anything. The import applies it; a dry run just reads it.
 */
export async function planWriteUpStages(supabase: SupabaseClient, now = new Date()): Promise<{
  plan: AutoClosePlanRow[];
  cutoff: string | null;
}> {
  const { data: runs } = await supabase
    .from("rforce_import_runs")
    .select("ran_at")
    .order("ran_at", { ascending: false })
    .limit(50);
  const cutoff = offReportCutoff((runs || []).map((r: { ran_at: string }) => r.ran_at));
  if (!cutoff) return { plan: [], cutoff: null };

  const [orders, writeUps] = await Promise.all([
    loadAll<WorkOrderRow>((from, to) =>
      supabase
        .from("work_orders")
        .select("order_number, status, work_order_type, scheduled_start, updated_at, address")
        .neq("work_order_type", "Account")
        .order("id")
        .range(from, to)
    ),
    loadAll<WriteUpRow>((from, to) =>
      supabase
        .from("field_work_orders")
        .select(
          "id, order_number, address, line_items, rforce_stage, rforce_stage_detail, job_closed_since, auto_closed_at"
        )
        .eq("status", "open")
        .order("id")
        .range(from, to)
    ),
  ]);

  const byOrder = new Map<string, WorkOrderRow[]>();
  // Only service-side orders count as "more work at this address" — a second
  // install sold to the same house is not this write-up's business.
  const byStreet = new Map<string, { key: AddressKey; row: WorkOrderRow }[]>();
  for (const o of orders) {
    if (!o.order_number) continue;
    const list = byOrder.get(o.order_number) || [];
    list.push(o);
    byOrder.set(o.order_number, list);
    if (o.work_order_type === "Service" || o.work_order_type === "Job Site Visit") {
      const key = addressKey(o.address);
      if (!key.street) continue;
      const hits = byStreet.get(key.street) || [];
      hits.push({ key, row: o });
      byStreet.set(key.street, hits);
    }
  }

  const groups = new Map<string, WriteUpRow[]>();
  for (const w of writeUps) {
    const list = groups.get(w.order_number) || [];
    list.push(w);
    groups.set(w.order_number, list);
  }

  const nowIso = now.toISOString();
  const plan: AutoClosePlanRow[] = [];
  for (const [orderNumber, rows] of groups) {
    const ownRows = byOrder.get(orderNumber) || [];
    // The write-up's own address, else the one rForce has for its order.
    const addr = rows.find((r) => r.address)?.address || ownRows.find((r) => r.address)?.address || "";
    const key = addressKey(addr);
    const addressRows = key.street
      ? (byStreet.get(key.street) || [])
          .filter((h) => addressesMatch(key, h.key) && h.row.order_number !== orderNumber)
          .map((h) => h.row)
      : [];

    const stage = computeStage({ ownRows, addressRows, cutoff, now });

    for (const r of rows) {
      let stageKey = stage.key;
      let since: string | null = null;
      let autoClose = false;
      if (stageKey === "job_closed") {
        if (r.auto_closed_at) {
          stageKey = "closed_reopened";
        } else {
          since = r.job_closed_since || nowIso;
          autoClose = autoCloseAt(since) <= now;
        }
      }
      const changed =
        autoClose ||
        r.rforce_stage !== stageKey ||
        canon(r.rforce_stage_detail) !== canon(stage.detail) ||
        (r.job_closed_since || null) !== since;
      plan.push({
        id: r.id,
        orderNumber,
        stage: stageKey,
        detail: stage.detail,
        jobClosedSince: since,
        autoClose,
        changed,
      });
    }
  }
  return { plan, cutoff };
}

/** Apply the plan. Rows sharing an identical change go in one update. */
async function applyPlan(supabase: SupabaseClient, plan: AutoClosePlanRow[], now: Date): Promise<void> {
  const nowIso = now.toISOString();
  const batches = new Map<string, { patch: Record<string, unknown>; ids: string[] }>();
  const closing = plan.filter((p) => p.autoClose);

  for (const p of plan) {
    if (!p.changed || p.autoClose) continue;
    const patch: Record<string, unknown> = {
      rforce_stage: p.stage,
      rforce_stage_detail: p.detail,
      rforce_checked_at: nowIso,
      job_closed_since: p.jobClosedSince,
    };
    const k = JSON.stringify(patch);
    const b = batches.get(k) || { patch, ids: [] as string[] };
    b.ids.push(p.id);
    batches.set(k, b);
  }
  for (const { patch, ids } of batches.values()) {
    const { error } = await supabase.from("field_work_orders").update(patch).in("id", ids).eq("status", "open");
    if (error) throw new Error(`write-up stage update failed: ${error.message}`);
  }

  if (closing.length === 0) return;
  // Closing ticks off every work item, the same as closing by hand does. Read
  // the items fresh so a tick made since the plan was built is kept.
  const { data: rows, error } = await supabase
    .from("field_work_orders")
    .select("id, line_items, status")
    .in(
      "id",
      closing.map((p) => p.id)
    );
  if (error) throw new Error(`auto-close read failed: ${error.message}`);
  const byId = new Map(closing.map((p) => [p.id, p]));
  for (const row of rows || []) {
    if (row.status !== "open") continue; // someone moved it since
    const p = byId.get(row.id)!;
    const items = Array.isArray(row.line_items) ? row.line_items : [];
    const { error: upErr } = await supabase
      .from("field_work_orders")
      .update({
        status: "closed",
        closed_at: nowIso,
        auto_closed_at: nowIso,
        nudge_snoozed_until: null,
        line_items: items.map((li: Record<string, unknown>) => ({ ...li, completed: true })),
        rforce_stage: "job_closed",
        rforce_stage_detail: p.detail,
        rforce_checked_at: nowIso,
        // job_closed_since is cleared by the status-change trigger (052);
        // auto_closed_at is what remembers this one closed itself.
      })
      .eq("id", row.id)
      .eq("status", "open");
    if (upErr) throw new Error(`auto-close failed: ${upErr.message}`);
  }
}

/**
 * The import's entry point. Logs the run, then (unless the report looks cut
 * off) refreshes every open write-up's stage and closes the ones whose
 * AUTO_CLOSE_DAYS in Job Closed are up.
 */
export async function runWriteUpAutoClose(
  supabase: SupabaseClient,
  runStartedAt: string,
  parsedRows: number
): Promise<AutoCloseSummary> {
  const { trusted } = await logImportRun(supabase, runStartedAt, parsedRows);
  const empty = { writeUps: 0, jobClosed: 0, autoClosed: 0, legacy: 0, changed: 0 };
  if (!trusted) return { ...empty, skipped: "import much smaller than usual — not judging closures from it" };

  const now = new Date();
  const { plan, cutoff } = await planWriteUpStages(supabase, now);
  if (!cutoff) return { ...empty, skipped: "no import runs logged yet" };
  await applyPlan(supabase, plan, now);
  return {
    writeUps: plan.length,
    jobClosed: plan.filter((p) => p.stage === "job_closed" && !p.autoClose).length,
    autoClosed: plan.filter((p) => p.autoClose).length,
    legacy: plan.filter((p) => p.stage === "legacy").length,
    changed: plan.filter((p) => p.changed).length,
  };
}
