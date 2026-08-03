import { NextRequest, NextResponse } from "next/server";
import { parseXlsHtml } from "@/lib/parse-xls";
import { parseCsv } from "@/lib/parse-csv";
import { createClient } from "@supabase/supabase-js";
import { WorkOrder } from "@/lib/types";

const SUPA_URL = "https://xusqjotoyntnfysquvlv.supabase.co";
const SUPA_KEY = "sb_publishable_HQigRx1Q8I6OpPffXMxRZQ_iqegVCka";

type FileResult = {
  text: string;
  format: "xls" | "csv" | "unknown";
};

async function getFileContent(request: NextRequest): Promise<FileResult | null> {
  const contentType = request.headers.get("content-type") || "";

  // Power Automate path: JSON body with base64 file content
  if (contentType.includes("application/json")) {
    const json = await request.json();
    const raw: string = json.file || json.content || json.body || "";
    if (!raw) return null;

    // Decode base64
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

function detectFormat(text: string): "xls" | "csv" | "unknown" {
  const trimmed = text.replace(/^﻿/, "").trimStart();

  // HTML table (XLS export)
  if (trimmed.startsWith("<") && trimmed.includes("<table")) {
    return "xls";
  }

  // CSV — check for quoted header row with known columns
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

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.UPLOAD_API_KEY;
    if (apiKey) {
      const provided = request.headers.get("x-api-key");
      if (provided !== apiKey) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const result = await getFileContent(request);

    if (!result || !result.text) {
      return NextResponse.json({ error: "Missing file content" }, { status: 400 });
    }

    let orders: WorkOrder[];
    let format: string;

    if (result.format === "csv") {
      orders = parseCsv(result.text);
      format = "csv";
    } else if (result.format === "xls") {
      orders = parseXlsHtml(result.text);
      format = "xls";
    } else {
      // Try both parsers
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
