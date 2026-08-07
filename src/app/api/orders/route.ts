import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";

const REPO = "kennenm-coder/Betterthengooglecal";
const FILE_PATH = "data/orders.json";
const BRANCH = "Main";

export async function GET() {
  try {
    // Require any authenticated user
    const { error: authError } = await requireAuth();
    if (authError) return authError;

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return NextResponse.json({ orders: [], uploadedAt: null, count: 0 });
    }

    const res = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
        next: { revalidate: 0 },
      }
    );

    if (!res.ok) {
      return NextResponse.json({ orders: [], uploadedAt: null, count: 0 });
    }

    const file = await res.json();
    const content = Buffer.from(file.content, "base64").toString("utf-8");
    const data = JSON.parse(content);

    return NextResponse.json(data);
  } catch (err) {
    console.error("Orders fetch error:", err);
    return NextResponse.json({ orders: [], uploadedAt: null, count: 0 });
  }
}
