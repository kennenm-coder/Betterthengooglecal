import { NextResponse } from "next/server";

// Which build is live, and proof the device can reach us. Used by
// src/lib/connection-check.ts as the "is the connection good enough to
// refresh on its own?" test. Returns only the public commit id — nothing
// private — so it needs no sign-in, and the middleware skips it to keep it
// fast (no Supabase call on the way in).

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { build: process.env.NEXT_PUBLIC_BUILD_ID ?? "" },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
