import { NextRequest, NextResponse } from "next/server";
import { parseXlsHtml } from "@/lib/parse-xls";

const REPO = "kennenm-coder/Betterthengooglecal";
const FILE_PATH = "data/orders.json";
const BRANCH = "Main";

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

    const payload = {
      orders,
      uploadedAt: new Date().toISOString(),
      count: orders.length,
    };

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "GitHub token not configured" },
        { status: 500 }
      );
    }

    const content = Buffer.from(JSON.stringify(payload)).toString("base64");

    let sha: string | undefined;
    const getRes = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" } }
    );
    if (getRes.ok) {
      const existing = await getRes.json();
      sha = existing.sha;
    }

    const putRes = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `Update orders data - ${orders.length} orders`,
          content,
          branch: BRANCH,
          ...(sha ? { sha } : {}),
        }),
      }
    );

    if (!putRes.ok) {
      const err = await putRes.text();
      console.error("GitHub API error:", err);
      return NextResponse.json(
        { error: "Failed to save to GitHub" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      count: orders.length,
    });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json(
      { error: "Failed to process file" },
      { status: 500 }
    );
  }
}
