import { NextRequest, NextResponse } from "next/server";
import { parseXlsHtml } from "@/lib/parse-xls";
import { createClient } from "@supabase/supabase-js";

const SUPA_URL = "https://xusqjotoyntnfysquvlv.supabase.co";
const SUPA_KEY = "sb_publishable_HQigRx1Q8I6OpPffXMxRZQ_iqegVCka";

async function getFileContent(request: NextRequest): Promise<string | null> {
  const contentType = request.headers.get("content-type") || "";

  // Power Automate path: raw body (base64 or plain text)
  if (
    contentType.includes("application/octet-stream") ||
    contentType.includes("text/html") ||
    contentType.includes("text/plain") ||
    contentType.includes("application/json")
  ) {
    if (contentType.includes("application/json")) {
      const json = await request.json();
      // Accept { file: "<base64 string>" } or { file: "<html string>" }
      const raw: string = json.file || json.content || json.body || "";
      if (!raw) return null;
      // Check if it's base64 encoded (no < at start means it's not raw HTML)
      if (raw.startsWith("<") || raw.startsWith("﻿<")) return raw;
      try {
        return Buffer.from(raw, "base64").toString("utf-8");
      } catch {
        return raw;
      }
    }
    const raw = await request.text();
    if (!raw) return null;
    if (raw.startsWith("<") || raw.startsWith("﻿<")) return raw;
    try {
      return Buffer.from(raw, "base64").toString("utf-8");
    } catch {
      return raw;
    }
  }

  // Browser upload path: multipart form-data
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return null;
    return file.text();
  }

  // Fallback: try reading as text
  const text = await request.text();
  return text || null;
}

async function upsertToSupabase(orders: ReturnType<typeof parseXlsHtml>) {
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
      throw new Error(`Batch ${Math.floor(i / BATCH) + 1}: ${error.message}`);
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

    const text = await getFileContent(request);

    if (!text) {
      return NextResponse.json({ error: "No file content provided" }, { status: 400 });
    }

    const orders = parseXlsHtml(text);

    if (orders.length === 0) {
      return NextResponse.json(
        { error: "No orders found in file. Make sure it's an .xls export." },
        { status: 400 }
      );
    }

    const upserted = await upsertToSupabase(orders);

    return NextResponse.json({
      success: true,
      count: upserted,
    });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json(
      { error: "Failed to process file" },
      { status: 500 }
    );
  }
}
