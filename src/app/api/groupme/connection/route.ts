import { NextResponse } from "next/server";
import { CHAT_ROLES } from "@/lib/roles";
import { requireRole } from "@/lib/auth";
import {
  deleteToken,
  getConnection,
  getMe,
  setNotifyMessages,
  storeToken,
  GroupMeError,
} from "@/lib/groupme";
import { isTokenCryptoConfigured } from "@/lib/groupme-crypto";

export const runtime = "nodejs";

/**
 * Has the signed-in person connected THEIR OWN GroupMe account, and as whom?
 * Never returns the token. Each person has their own connection.
 */
export async function GET() {
  const { user, error: authError } = await requireRole(...CHAT_ROLES);
  if (authError) return authError;

  // Only the encryption key is actually required. GROUPME_CLIENT_ID feeds the
  // OAuth route, which GroupMe's own broken sign-in makes unusable -- gating
  // the whole tab on it would wrongly report "not set up" for anyone using the
  // pasted-token path, which is everyone.
  const configured = isTokenCryptoConfigured();

  const connection = await getConnection(user!.id);
  return NextResponse.json({
    configured,
    connected: !!connection,
    groupmeName: connection?.groupmeName ?? null,
    connectedAt: connection?.connectedAt ?? null,
    notifyMessages: connection?.notifyMessages ?? true,
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
 * A person's token is shown at dev.groupme.com once they sign in there with
 * their own GroupMe account. Each person pastes their own, once.
 *
 * The token is validated against GroupMe before being stored, so a typo or a
 * stale value is rejected here rather than silently failing later. Storage is
 * identical to the OAuth path: encrypted, service-role only. The OAuth route
 * is left in place in case GroupMe ever fixes their end.
 */
export async function POST(request: Request) {
  const { user, error: authError } = await requireRole(...CHAT_ROLES);
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
  const { user, error: authError } = await requireRole(...CHAT_ROLES);
  if (authError) return authError;

  // Only this person's own connection. Everyone else stays connected.
  await deleteToken(user!.id);
  return NextResponse.json({ ok: true });
}

/**
 * PATCH { notifyMessages: boolean }: turn this person's phone buzzes for new
 * GroupMe messages on or off (the once-a-minute check, /api/cron/groupme).
 */
export async function PATCH(request: Request) {
  const { user, error: authError } = await requireRole(...CHAT_ROLES);
  if (authError) return authError;

  let payload: { notifyMessages?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (typeof payload.notifyMessages !== "boolean") {
    return NextResponse.json({ error: "Missing notifyMessages." }, { status: 400 });
  }

  try {
    await setNotifyMessages(user!.id, payload.notifyMessages);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, notifyMessages: payload.notifyMessages });
}
