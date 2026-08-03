import { NextRequest, NextResponse } from "next/server";
import { parseXlsHtml } from "@/lib/parse-xls";
import { parseCsv } from "@/lib/parse-csv";
import { isAccountsCsv, parseAccountsCsv, AccountRow } from "@/lib/parse-accounts-csv";
import { createClient } from "@supabase/supabase-js";
import { WorkOrder } from "@/lib/types";

const SUPA_URL = "https://xusqjotoyntnfysquvlv.supabase.co";
const SUPA_KEY = "sb_publishable_HQigRx1Q8I6OpPffXMxRZQ_iqegVCka";

type FileResult = {
  text: string;
  format: "xls" | "csv" | "accounts_csv" | "unknown";
};

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

function detectFormat(text: string): "xls" | "csv" | "accounts_csv" | "unknown" {
  const trimmed = text.replace(/^﻿/, "").trimStart();

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

async function upsertToSupabase(orders: WorkOrder[]) {
  const supabase = createClient(SUPA_URL, SUPA_KEY);

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
  const supabase = createClient(SUPA_URL, SUPA_KEY);
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

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.UPLOAD_API_KEY;
    const contentType = request.headers.get("content-type") || "";
    const isBrowserUpload = contentType.includes("multipart/form-data");
    if (apiKey && !isBrowserUpload) {
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

      return NextResponse.json({
        success: true,
        format: "accounts_csv",
        parsed: accounts.length,
        updated: stats.updated,
        inserted: stats.inserted,
        total: stats.total,
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
      orders = parseXlsHtml(result.text);
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

    const upserted = await upsertToSupabase(orders);

    return NextResponse.json({
      success: true,
      format,
      parsed: orders.length,
      upserted,
    });
  } catch (err: any) {
    console.error("Upload error:", err);
    const message = err?.message || "Failed to process file";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
