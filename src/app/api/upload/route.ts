import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { parseXlsHtml } from "@/lib/parse-xls";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const text = await file.text();
    const orders = parseXlsHtml(text);

    if (orders.length === 0) {
      return NextResponse.json(
        { error: "No orders found in file. Make sure it's an .xls export." },
        { status: 400 }
      );
    }

    const payload = JSON.stringify({
      orders,
      uploadedAt: new Date().toISOString(),
      count: orders.length,
    });

    const blob = await put("orders/current.json", payload, {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/json",
    });

    return NextResponse.json({
      success: true,
      count: orders.length,
      url: blob.url,
    });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json(
      { error: "Failed to process file" },
      { status: 500 }
    );
  }
}
