import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Step 1 of connecting a GroupMe account: send the user to GroupMe to approve.
 *
 * GroupMe uses OAuth 2.0 "implicit" flow, which in practice means: we send the
 * person to GroupMe, they approve, and GroupMe redirects them back to the one
 * callback URL registered against our client id -- with the access token sitting
 * in the query string. We never exchange a code, and there is no client secret.
 *
 * The callback URL is NOT passed here. GroupMe only ever redirects to the URL
 * registered in the app's settings at dev.groupme.com, which is why a separate
 * registration is needed for local development.
 *
 * Env:
 *   GROUPME_CLIENT_ID  from the app registered at dev.groupme.com
 */
export async function GET() {
  // Admin only during the pilot -- same gate as canUseInstallerChat().
  const { error: authError } = await requireRole("admin");
  if (authError) return authError;

  const clientId = process.env.GROUPME_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      {
        error:
          "GroupMe isn't set up on the server yet (GROUPME_CLIENT_ID is missing).",
      },
      { status: 503 }
    );
  }

  // Deliberately NOT /oauth/authorize, which is the documented entry point.
  //
  // GroupMe's /oauth/authorize answers 302 to the login dialog over PLAIN HTTP
  // while setting its own session cookie with the `secure` flag. A browser will
  // not send a secure cookie over http, so the login page cannot see the
  // session it just created: you sign in, pass the SMS PIN check, and get
  // bounced straight back to the login form. Forever. (Verified against the
  // live endpoint on 2026-10-01 -- the Location header really is http://.)
  //
  // Going directly to the https login dialog keeps the whole exchange on https
  // so the cookie survives and the flow completes. Same endpoint GroupMe sends
  // you to anyway, just not downgraded on the way.
  const url = `https://oauth.groupme.com/oauth/login_dialog?client_id=${encodeURIComponent(
    clientId
  )}`;
  return NextResponse.redirect(url);
}
