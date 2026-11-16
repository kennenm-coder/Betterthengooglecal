import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getMe, storeToken, GroupMeError } from "@/lib/groupme";
import { isTokenCryptoConfigured } from "@/lib/groupme-crypto";

export const runtime = "nodejs";

/**
 * Step 2 of connecting a GroupMe account: GroupMe sends the person back here
 * with ?access_token=... in the query string.
 *
 * KNOWN RESIDUAL RISK: that token arrives in the request URL, and hosting
 * platforms commonly log request URLs. We cannot change that -- it is how
 * GroupMe's implicit flow works, and they publish no alternative. What we do
 * control:
 *   - we never log the URL ourselves,
 *   - we redirect straight to a clean /chat URL so it does not linger in
 *     browser history or get forwarded in a Referer header,
 *   - we encrypt it before it is stored (see groupme-crypto.ts).
 * If GroupMe ever ships an authorization-code flow, switch to it.
 */
export async function GET(request: Request) {
  const { user, error: authError } = await requireRole("admin");
  if (authError) return authError;

  const origin = new URL(request.url).origin;
  const back = (status: string) =>
    NextResponse.redirect(`${origin}/chat?connect=${status}`);

  if (!isTokenCryptoConfigured()) {
    return back("nokey");
  }

  const token = new URL(request.url).searchParams.get("access_token");
  if (!token) {
    // Covers the user pressing "deny" as well as a malformed redirect.
    return back("denied");
  }

  try {
    // Confirm the token actually works before storing it, and capture who
    // GroupMe says it belongs to so the UI can show "Connected as ...".
    const me = await getMe(token);
    if (!me) return back("invalid");

    await storeToken(user!.id, user!.email, token, me);
    return back("ok");
  } catch (e) {
    if (e instanceof GroupMeError && e.status === 401) return back("invalid");
    return back("error");
  }
}
