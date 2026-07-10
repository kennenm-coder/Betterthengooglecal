import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { parseXlsHtml } from "@/lib/parse-xls";

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Dev only" }, { status: 403 });
  }

  try {
    const filePath = process.env.DEV_XLS_PATH || "";
    if (!filePath) {
      return NextResponse.json({ error: "Set DEV_XLS_PATH env var" }, { status: 400 });
    }
    const html = readFileSync(filePath, "utf-8");
    const orders = parseXlsHtml(html);
    return NextResponse.json({
      orders,
      uploadedAt: new Date().toISOString(),
      count: orders.length,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
