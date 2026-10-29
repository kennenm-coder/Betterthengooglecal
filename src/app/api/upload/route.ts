import { NextRequest, NextResponse } from "next/server";
import { parseXlsHtml } from "@/lib/parse-xls";
import { parseCsv } from "@/lib/parse-csv";
import { isAccountsCsv, parseAccountsCsv, AccountRow } from "@/lib/parse-accounts-csv";
import { isPurchaseOrderReport, parsePurchaseOrderReport, PurchaseOrderRow } from "@/lib/parse-po-report";
import { WorkOrder } from "@/lib/types";
import { requireRole, getAdminClient } from "@/lib/auth";
import { writeImportLog, fetchExistingOrders, computeOrderChanges } from "@/lib/import-log";

/**
 * Power Automate posts the full rForce export here hourly, 8am–5pm. A run reads
 * every existing row (for the diff) and re-upserts every parsed row, so give it
 * headroom well past the 15s Node default — a run that gets cut off mid-upsert
 * looks downstream like a batch of cancelled jobs (see the scheduling app's
 * docs/phase2-dropped-from-rforce.md).
 */
export const maxDuration = 60;

type FileResult = {
  text: string;
  format: ImportFormat;
};

type ImportFormat = "xls" | "csv" | "accounts_csv" | "po_report" | "unknown";

async function getFileContent(request: NextRequest): Promise<FileResult | null> {
  const contentType = request.headers.get("content-type") || "";

  // Power Automate path: JSON body with base64 file content
  if (contentType.includes("application/json")) {
    const json = await request.json();
    const raw: string = json.file || json.content || json.body || "";
    if (!raw) return null;

    let decoded: string;
    if (raw.startsWith("<") || raw.startsWith("﻿<") || raw.startsWith('"')) {
      decoded = raw;
    } else {
      try {
        decoded = Buffer.from(raw, "base64").toString("utf-8");
      } catch {
        decoded = raw;
      }
    }

    return { text: decoded, format: detectFormat(decoded) };
  }

  // Raw body paths
  if (
    contentType.includes("application/octet-stream") ||
    contentType.includes("text/html") ||
    contentType.includes("text/plain") ||
    contentType.includes("text/csv")
  ) {
    const raw = await request.text();
    if (!raw) return null;
    let decoded: string;
    if (raw.startsWith("<") || raw.startsWith("﻿<") || raw.startsWith('"') || raw.startsWith("﻿\"")) {
      decoded = raw;
    } else {
      try {
        decoded = Buffer.from(raw, "base64").toString("utf-8");
      } catch {
        decoded = raw;
      }
    }
    return { text: decoded, format: detectFormat(decoded) };
  }

  // Browser upload path: multipart form-data
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return null;
    const text = await file.text();
    return { text, format: detectFormat(text) };
  }

  // Fallback
  const text = await request.text();
  if (!text) return null;
  return { text, format: detectFormat(text) };
}

function detectFormat(text: string): ImportFormat {
  const trimmed = text.replace(/^﻿/, "").trimStart();

  // Vendor PO / ETA report, in either export shape — the HTML ".xls" or the
  // "Details Only" CSV. Checked first because the HTML shape would otherwise
  // be claimed by the work-order test below; the header it looks for appears
  // in no other report we import.
  if (isPurchaseOrderReport(trimmed)) {
    return "po_report";
  }

  // HTML table (XLS export)
  if (trimmed.startsWith("<") && trimmed.includes("<table")) {
    return "xls";
  }

  // Accounts CSV — has "Account Name" but NOT "Work Order Number"
  if (isAccountsCsv(trimmed)) {
    return "accounts_csv";
  }

  // Work orders CSV — has "Work Order Number"
  if (
    trimmed.startsWith('"') &&
    trimmed.includes('"Order Number"') &&
    trimmed.includes('"Work Order Number"')
  ) {
    return "csv";
  }

  // Unquoted CSV
  if (
    trimmed.includes("Order Number") &&
    trimmed.includes("Work Order Number") &&
    !trimmed.includes("<table")
  ) {
    return "csv";
  }

  return "unknown";
}

/**
 * Upsert EVERY parsed order, bumping `updated_at` even on rows that didn't change.
 *
 * This is deliberate, not an oversight. The scheduling app detects rForce
 * cancellations by absence — an order whose `updated_at` stops advancing is treated
 * as dropped from rForce, escalating to a 🔴 "likely cancel" review after two days.
 * Narrowing this to changed rows only (the diff is right there in the caller) would
 * flag every unchanged-but-live order as cancelled. See the invariant in the
 * scheduling app's docs/phase2-dropped-from-rforce.md before touching this.
 */
async function upsertToSupabase(orders: WorkOrder[]) {
  const supabase = getAdminClient();

  const rows = orders.map((wo) => ({
    id: wo.id,
    order_number: wo.orderNumber,
    work_order_number: wo.workOrderNumber,
    status: wo.status,
    appointment_status: wo.appointmentStatus,
    customer_name: wo.customerName,
    address: wo.address,
    booking_date: wo.bookingDate,
    scheduled_start: wo.scheduledStart,
    scheduled_end: wo.scheduledEnd,
    work_order_type: wo.workOrderType,
    order_owner: wo.orderOwner,
    sales_rep: wo.salesRep,
    tech_measure: wo.techMeasure,
    installer: wo.installer,
    service_rep: wo.serviceRep,
    contact_name: wo.contactName,
    email: wo.email,
    phones: wo.phones,
    service_description: wo.serviceDescription || "",
    primary_resource: wo.primaryResource || "",
    description: wo.description || "",
    combined_retail_total: wo.combinedRetailTotal || 0,
    product_count: wo.productCount || 0,
    total_units: wo.totalUnits || 0,
    windows: wo.windows || 0,
    patio_doors: wo.patioDoors || 0,
    doors: wo.doors || 0,
    order_alerts: wo.orderAlerts || "",
    account_name: wo.accountName || "",
    latitude: wo.latitude,
    longitude: wo.longitude,
    updated_at: new Date().toISOString(),
  }));

  const BATCH = 500;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from("work_orders")
      .upsert(chunk, { onConflict: "id" });

    if (error) {
      throw new Error(`Supabase upsert failed at batch ${Math.floor(i / BATCH) + 1}: ${error.message}`);
    }
    upserted += chunk.length;
  }
  return upserted;
}

async function upsertAccountsToSupabase(accounts: AccountRow[]) {
  const supabase = getAdminClient();
  const now = new Date().toISOString();

  // Deduplicate input by account_name — last occurrence wins
  const deduped = new Map<string, AccountRow>();
  for (const a of accounts) {
    if (a.account_name) deduped.set(a.account_name, a);
  }
  const unique = Array.from(deduped.values());

  let updated = 0;
  let inserted = 0;

  // Accounts WITH order numbers: update account_name on matching existing work orders
  const withOrder = unique.filter((a) => a.order_number);
  if (withOrder.length > 0) {
    for (const acct of withOrder) {
      const { data: existing } = await supabase
        .from("work_orders")
        .select("id, account_name")
        .eq("order_number", acct.order_number);

      if (existing && existing.length > 0) {
        for (const row of existing) {
          if (!row.account_name) {
            await supabase
              .from("work_orders")
              .update({ account_name: acct.account_name, updated_at: now })
              .eq("id", row.id);
            updated++;
          }
        }
      }
    }
  }

  // Accounts WITHOUT order numbers: insert as new rows, skip if already exists
  const withoutOrder = unique.filter((a) => !a.order_number);
  if (withoutOrder.length > 0) {
    const rows = withoutOrder.map((a) => ({
      id: a.account_name,
      account_name: a.account_name,
      address: a.address,
      job_close_date: a.job_close_date || "",
      work_order_type: "Account",
      updated_at: now,
    }));

    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const { error } = await supabase
        .from("work_orders")
        .upsert(chunk, { onConflict: "id", ignoreDuplicates: true });

      if (error) {
        throw new Error(`Accounts insert failed at batch ${Math.floor(i / BATCH) + 1}: ${error.message}`);
      }
      inserted += chunk.length;
    }
  }

  return { updated, inserted, total: updated + inserted };
}

/**
 * Upsert the vendor PO feed.
 *
 * Deliberately unlike upsertToSupabase() above: that one re-touches every row
 * so the scheduling app can read a stalled `updated_at` as a cancellation.
 * Here `last_seen_at` carries that signal instead, and the table's trigger
 * leaves `updated_at` alone on a row whose reported fields did not move — so
 * "what changed on this PO" stays answerable even though all ~730 rows are
 * re-sent on every daily run.
 *
 * Cancelled POs are filtered out of the report upstream, so a PO that stops
 * appearing simply stops advancing `last_seen_at`; nothing is ever deleted
 * here. The trigger also owns `confirmed_at` / `received_at`, which is why
 * neither is sent.
 */
async function upsertPurchaseOrders(rows: PurchaseOrderRow[]) {
  const supabase = getAdminClient();
  const seenAt = new Date().toISOString();

  const payload = rows.map((row) => ({ ...row, last_seen_at: seenAt }));

  const BATCH = 500;
  let upserted = 0;
  for (let i = 0; i < payload.length; i += BATCH) {
    const chunk = payload.slice(i, i + BATCH);
    const { error } = await supabase
      .from("purchase_orders")
      .upsert(chunk, { onConflict: "vendor_po_number" });

    if (error) {
      throw new Error(
        `Purchase order upsert failed at batch ${Math.floor(i / BATCH) + 1}: ${error.message}`
      );
    }
    upserted += chunk.length;
  }
  return upserted;
}

/**
 * How many of the feed's JOB numbers we can actually tie to a work order.
 * Reported back on every run rather than logged, because a sudden drop is the
 * first sign the report's order-number column has changed shape.
 *
 * The baseline moved on 2026-10-29. This counts `order_number`, which used to
 * be the sold order and is now the job the PO belongs to (migration 042), so
 * service jobs match for the first time. On the 18:12 sample that day the
 * figure went from 445 of 477 to 530 of 530 — every job number in the report
 * now ties to a work order. Judge a drop against the new number, and treat
 * anything short of "all of them" as worth a look.
 */
async function countMatchedOrders(rows: PurchaseOrderRow[]): Promise<number | null> {
  const orderNumbers = [...new Set(rows.map((r) => r.order_number))];
  if (orderNumbers.length === 0) return 0;

  const supabase = getAdminClient();
  const matched = new Set<string>();

  // Chunked, and not for URL length. One order carries several work orders —
  // an install, a tech measure, any service visits — so asking about all ~530
  // at once returns a few thousand rows and PostgREST caps the response. The
  // count then silently reads low (469 instead of 530 on the 2026-10-29
  // report), which is exactly the false alarm the comment above tells you to
  // investigate. Small enough chunks stay under the cap.
  const CHUNK = 150;
  for (let i = 0; i < orderNumbers.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("work_orders")
      .select("order_number")
      .in("order_number", orderNumbers.slice(i, i + CHUNK));

    if (error) return null;
    for (const row of data ?? []) if (row.order_number) matched.add(row.order_number);
  }
  return matched.size;
}

/**
 * Confirm the jobs this feed now vouches for.
 *
 * Runs straight after every PO import, which is the whole point: the report
 * arrives at 4:00 am on its own, and a job the vendor acknowledged weeks ago
 * should not wait in the confirmation queue for somebody to remember to press
 * a button.
 *
 * The rule is `rforce_auto_confirm()` (migration 043) and lives in the
 * database rather than here, because the confirmation auditor's own screen
 * runs the same sweep on demand and a rule that runs in two places must only
 * be written once. It confirms a job only when the vendor has acknowledged
 * every live PO on it, never touches one somebody already confirmed or has a
 * draft open on, and marks what it writes as coming from the feed rather than
 * from an audit.
 *
 * Non-fatal on purpose. The import's job is to land the purchase orders; if
 * the sweep cannot run — most likely because 043 is not applied yet — the data
 * is still correct and the auditor's button still works.
 */
async function autoConfirmFromFeed(): Promise<number | null> {
  try {
    const supabase = getAdminClient();
    const { data, error } = await supabase.rpc("rforce_auto_confirm", {
      p_apply: true,
      p_actor: "rForce feed",
    });
    if (error) {
      console.warn("rForce auto-confirm skipped:", error.message);
      return null;
    }
    const rows = (data ?? []) as { confirmed?: boolean }[];
    return rows.filter((r) => r.confirmed).length;
  } catch (err) {
    console.warn("rForce auto-confirm skipped:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";
    const isBrowserUpload = contentType.includes("multipart/form-data");

    if (isBrowserUpload) {
      // Browser uploads require an authenticated admin session
      const { error: authError } = await requireRole("admin");
      if (authError) return authError;
    } else {
      // Power Automate / external uploads use API key
      const apiKey = process.env.UPLOAD_API_KEY;
      if (!apiKey) {
        console.error("UPLOAD_API_KEY is not configured — rejecting external upload");
        return NextResponse.json(
          { error: "Server configuration error" },
          { status: 500 }
        );
      }
      const provided = request.headers.get("x-api-key");
      if (provided !== apiKey) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const result = await getFileContent(request);

    if (!result || !result.text) {
      return NextResponse.json({ error: "Missing file content" }, { status: 400 });
    }

    // Accounts CSV path
    if (result.format === "accounts_csv") {
      const accounts = parseAccountsCsv(result.text);
      if (accounts.length === 0) {
        return NextResponse.json(
          { error: "Accounts CSV parsed but contained no valid rows" },
          { status: 400 }
        );
      }

      const stats = await upsertAccountsToSupabase(accounts);

      // Deliberately NOT written to the import log. An accounts upload only
      // backfills customer names onto jobs that already exist, so it isn't a
      // change a field manager needs on the Changes tab — and logging every
      // parsed row was what made that tab unreadable.

      return NextResponse.json({
        success: true,
        format: "accounts_csv",
        parsed: accounts.length,
        updated: stats.updated,
        inserted: stats.inserted,
        total: stats.total,
      });
    }

    // Vendor PO / ETA path. No import log: the Changes tab is a field
    // manager's view of jobs moving on the schedule, and a few hundred PO
    // status ticks an hour would bury that — the same reason accounts uploads
    // stay off it.
    if (result.format === "po_report") {
      const purchaseOrders = parsePurchaseOrderReport(result.text);
      if (purchaseOrders.length === 0) {
        return NextResponse.json(
          { error: "PO report parsed but contained no valid purchase-order rows" },
          { status: 400 }
        );
      }

      const upserted = await upsertPurchaseOrders(purchaseOrders);
      const distinctOrders = new Set(purchaseOrders.map((r) => r.order_number)).size;
      const matchedOrders = await countMatchedOrders(purchaseOrders);
      // Only after the POs have landed — the sweep reads what we just wrote.
      const autoConfirmed = await autoConfirmFromFeed();

      return NextResponse.json({
        success: true,
        format: "po_report",
        parsed: purchaseOrders.length,
        upserted,
        orders: distinctOrders,
        matchedOrders,
        autoConfirmed,
      });
    }

    // Work orders CSV / XLS path
    let orders: WorkOrder[];
    let format: string;

    if (result.format === "csv") {
      orders = parseCsv(result.text);
      format = "csv";
    } else if (result.format === "xls") {
      orders = parseXlsHtml(result.text);
      format = "xls";
    } else {
      // Guess, but never guess that an unrecognised HTML table is the
      // work-order export. parseXlsHtml falls back to the row's array index
      // when there is no "Work Order Number" column, so a table of some other
      // shape parses "successfully" into rows keyed 0, 1, 2… and overwrites
      // real work orders. Now that three different reports arrive at this one
      // endpoint, that header has to be present before we believe it.
      const looksLikeWorkOrders = /work\s*order\s*number/i.test(result.text);
      orders = looksLikeWorkOrders ? parseXlsHtml(result.text) : [];
      format = "xls";
      if (orders.length === 0) {
        orders = parseCsv(result.text);
        format = "csv";
      }
      if (orders.length === 0) {
        return NextResponse.json(
          { error: "Unsupported file format" },
          { status: 400 }
        );
      }
    }

    if (orders.length === 0) {
      return NextResponse.json(
        { error: `${format.toUpperCase()} parsed successfully but contained no valid work-order rows` },
        { status: 400 }
      );
    }

    // Diff: fetch existing rows so we know which orders are new vs. updated,
    // and what the tracked fields changed from — must happen BEFORE the upsert
    // overwrites the old values.
    const existingRows = await fetchExistingOrders(orders.map((o) => o.id));

    // A job with no date on it — before or after — is not field work anyone is
    // tracking, so it stays off the Changes tab. The exception is the change
    // that takes a job OFF the schedule: that one matters, and it survives
    // because the job still had a date beforehand.
    const onSchedule = (o: WorkOrder) =>
      Boolean(o.scheduledStart) || Boolean(existingRows.get(o.id)?.scheduled_start);

    const addedOrders = orders.filter(
      (o) => !existingRows.has(o.id) && Boolean(o.scheduledStart)
    );

    // Every import re-uploads the full dataset, so an order existing in the DB
    // says nothing — only orders with a real tracked-field difference count as
    // "updated". Schedule moves lead, since that's what the tab is scanned for.
    const changedOrders = orders
      .filter((o) => existingRows.has(o.id) && onSchedule(o))
      .map((o) => ({
        workOrderNumber: o.workOrderNumber,
        customerName: o.customerName,
        scheduledStart: o.scheduledStart,
        action: "updated" as const,
        changes: computeOrderChanges(existingRows.get(o.id)!, o),
      }))
      .filter((o) => o.changes.length > 0)
      .sort((a, b) => {
        const aMoved = a.changes.some((c) => c.kind === "schedule") ? 1 : 0;
        const bMoved = b.changes.some((c) => c.kind === "schedule") ? 1 : 0;
        if (aMoved !== bMoved) return bMoved - aMoved;
        return b.changes.length - a.changes.length;
      });

    const upserted = await upsertToSupabase(orders);

    // Log the import for the shared import log
    const source = isBrowserUpload ? "browser" : "power_automate";
    try {
      await writeImportLog({
        format,
        source,
        total_count: addedOrders.length + changedOrders.length,
        added_count: addedOrders.length,
        updated_count: changedOrders.length,
        orders: [
          ...addedOrders.map((o) => ({
            workOrderNumber: o.workOrderNumber,
            customerName: o.customerName,
            scheduledStart: o.scheduledStart,
            action: "added" as const,
          })),
          ...changedOrders,
        ],
      });
    } catch (logErr) {
      // Import log is non-critical — don't fail the upload
      console.error("Import log write failed:", logErr);
    }

    return NextResponse.json({
      success: true,
      format,
      parsed: orders.length,
      upserted,
    });
  } catch (err: unknown) {
    console.error("Upload error:", err);
    const message = err instanceof Error ? err.message : "Failed to process file";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
