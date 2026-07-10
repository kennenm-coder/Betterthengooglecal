import { NextResponse } from "next/server";
import { list } from "@vercel/blob";

export async function GET() {
  try {
    const { blobs } = await list({ prefix: "orders/current.json" });

    if (blobs.length === 0) {
      return NextResponse.json({ orders: [], uploadedAt: null, count: 0 });
    }

    const blob = blobs[0];
    const response = await fetch(blob.url);
    const data = await response.json();

    return NextResponse.json(data);
  } catch (err) {
    console.error("Orders fetch error:", err);
    return NextResponse.json({ orders: [], uploadedAt: null, count: 0 });
  }
}
