import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";

const REPO = "kennenm-coder/Betterthengooglecal";
const FILE_PATH = "data/orders.json";
const BRANCH = "Main";

export async function GET() {
  try {
    // Admin only.
    //
    // This hands back data/orders.json — every order, ~550 KB — fetched with
    // the repo's own token. It never passes through Postgres, so none of the
    // row and column restrictions on work_orders apply to it: left open to any
    // allowlisted account it would undo the installer role in a single fetch
    // (migrations 035 / 036).
    //
    // Nothing in the app calls this route; it reads as a leftover from before
    // the move to Supabase. Narrowing it is the conservative fix — deleting it
    // outright is probably the right one.
    const { error: authError } = await requireRole("admin");
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
