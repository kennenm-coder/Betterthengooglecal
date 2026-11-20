import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Step 1 of connecting a GroupMe account: send the person to GroupMe's own
 * sign-in page. They sign in there (Duck Force never sees their password),
 * GroupMe may text them a PIN, they approve, and GroupMe sends them back to
 * our callback (/api/groupme/callback) -- the one address registered for our
 * app at dev.groupme.com -- with their access token. Duck Force saves it and
 * they land back on the Chat tab, connected. Nothing for them to copy.
 *
 * WHICH GroupMe door (?via=):
 *   (default) /oauth/authorize -- GroupMe's official entry point. It opens a
 *     sign-in session (a cookie) that the login form and the PIN step after it
 *     rely on, then forwards to the login form.
 *     History: in Oct 2026 that forward went over plain http, the browser
 *     dropped GroupMe's secure cookie, and sign-in looped forever, so we
 *     jumped straight to the login form instead. Re-checked 2026-11-20:
 *     GroupMe's http hop now answers 301 -> https, so the cookie survives and
 *     the official door works. Skipping it meant the login form sometimes ran
 *     with no session -- "worked once, then invalid credentials".
 *   ?via=dialog -- straight to the login form (the old route), kept as the
 *     "try GroupMe's other sign-in page" backup link on the Chat tab.
 *
 * Env:
 *   GROUPME_CLIENT_ID  from the app registered at dev.groupme.com
 */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;

  // Not signed in to Duck Force (or session expired): send them to sign in and
  // come back to Chat, instead of showing raw error text.
  // Connecting your OWN GroupMe, or the office account, is for admins only
  // (migration 074) -- everyone else reads and sends through the office
  // account and never sees a GroupMe sign-in.
  const { error: authError } = await requireRole("admin");
  if (authError) {
    if (authError.status === 401) {
      return NextResponse.redirect(`${origin}/login?redirect=${encodeURIComponent("/chat")}`);
    }
    return NextResponse.redirect(`${origin}/chat?connect=adminonly`);
  }

  const clientId = process.env.GROUPME_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(`${origin}/chat?connect=noclient`);
  }

  const params = new URL(request.url).searchParams;
  const path = params.get("via") === "dialog" ? "login_dialog" : "authorize";
  const res = NextResponse.redirect(
    `https://oauth.groupme.com/oauth/${path}?client_id=${encodeURIComponent(clientId)}`
  );
  // GroupMe sends everyone back to the one callback address, so remember for
  // ten minutes whether this sign-in is for the OFFICE account.
  res.cookies.set("gm_connect_as", params.get("as") === "office" ? "office" : "personal", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/groupme",
    maxAge: 600,
  });
  return res;
}
