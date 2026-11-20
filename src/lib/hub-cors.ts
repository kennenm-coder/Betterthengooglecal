// The NWO Hub (www.nwotoolbox.com) manages GroupMe for Duck Force by calling
// Duck Force's /api/hub/* routes from the browser. Browsers only allow that
// cross-site call when Duck Force says the Hub may make it (CORS). Only the
// Hub's own addresses are allowed; the request must still carry an admin's
// sign-in token (requireRoleBearer), so CORS alone grants nothing.

import { NextResponse } from "next/server";

const HUB_ORIGINS = new Set([
  "https://www.nwotoolbox.com",
  "https://nwotoolbox.com",
  "https://kennen-s-app.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
]);

function allowOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  return origin && HUB_ORIGINS.has(origin) ? origin : null;
}

/** Add the CORS headers to a response going back to the Hub. */
export function withHubCors(req: Request, res: NextResponse): NextResponse {
  const origin = allowOrigin(req);
  if (origin) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
  }
  return res;
}

/** The browser's "may I?" check before the real request. */
export function hubPreflight(req: Request): NextResponse {
  const res = new NextResponse(null, { status: 204 });
  const origin = allowOrigin(req);
  if (origin) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.headers.set("Access-Control-Max-Age", "600");
    res.headers.set("Vary", "Origin");
  }
  return res;
}
