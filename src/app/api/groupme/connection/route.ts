import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import {
  deleteSharedToken,
  getMe,
  getSharedConnection,
  storeToken,
  GroupMeError,
} from "@/lib/groupme";
import { isTokenCryptoConfigured } from "@/lib/groupme-crypto";

export const runtime = "nodejs";

/**
 * Is the shared office GroupMe account connected, and as whom?
 * Never returns the token. One connection serves everyone (see getSharedToken).
 */
export async function GET() {
  const { error: authError } = await requireRole("admin");
  if (authError) return authError;

  // Only the encryption key is actually required. GROUPME_CLIENT_ID feeds the
  // OAuth route, which GroupMe's own broken sign-in makes unusable -- gating
  // the whole tab on it would wrongly report "not set up" for anyone using the
  // pasted-token path, which is everyone.
  const configured = isTokenCryptoConfigured();

  const connection = await getSharedConnection();
  return NextResponse.json({
    configured,
    connected: !!connection,
    groupmeName: connection?.groupmeName ?? null,
    connectedAt: connection?.connectedAt ?? null,
  });
}

/**
 * Connect by pasting an access token, instead of going through OAuth.
 *
 * Why this exists: GroupMe's own OAuth sign-in is broken. /oauth/authorize
 * redirects to a login page over plain http while setting its session cookie
 * `secure`, so the browser won't send the cookie back and the login loops
 * forever; forcing the https login dialog gets further but then fails with
 * their own "internal error" (both verified against the live service on
 * 2026-10-01). None of that is fixable from this side.
 *
 * An account's token is shown at dev.groupme.com once signed in, and this app
 * uses exactly ONE shared office account, so pasting it once is no worse
 * operationally than clicking through a consent screen once -- and it works.
 *
 * The token is validated against GroupMe before being stored, so a typo or a
 * stale value is rejected here rather than silently failing later. Storage is
 * identical to the OAuth path: encrypted, service-role only. The OAuth route
 * is left in place in case GroupMe ever fixes their end.
 */
export async function POST(request: Request) {
  const { user, error: authError } = await requireRole("admin");
  if (authError) return authError;

  if (!isTokenCryptoConfigured()) {
    return NextResponse.json(
      { error: "The server is missing its encryption key (GROUPME_TOKEN_KEY)." },
      { status: 503 }
    );
  }

  let payload: { token?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const token = typeof payload.token === "string" ? payload.token.trim() : "";
  if (!token) {
    return NextResponse.json({ error: "Paste your access token." }, { status: 400 });
  }

  try {
    const me = await getMe(token);
    if (!me) {
      return NextResponse.json(
        { error: "GroupMe didn't recognise that token." },
        { status: 400 }
      );
    }

    await storeToken(user!.id, user!.email, token, me);
    return NextResponse.json({ ok: true, groupmeName: me.name });
  } catch (e) {
    if (e instanceof GroupMeError && e.status === 401) {
      return NextResponse.json(
        { error: "That token was rejected by GroupMe. Copy it again." },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Could not reach GroupMe to check that token." },
      { status: 502 }
    );
  }
}

/**
 * Disconnect: delete our stored copy of the token.
 *
 * This does NOT revoke the token at GroupMe -- they publish no endpoint for
 * that -- so the UI says so plainly rather than implying a kill switch.
 */
export async function DELETE() {
  const { error: authError } = await requireRole("admin");
  if (authError) return authError;

  await deleteSharedToken();
  return NextResponse.json({ ok: true });
}
