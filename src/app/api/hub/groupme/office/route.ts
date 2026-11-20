// The office GroupMe account, managed from the NWO Hub. Admins only (Bearer
// token, Hub address only). Migration 074.
//
//   POST   { token }  -> connect the office account by pasting its access token
//   DELETE            -> disconnect it (shared-chat settings are kept)
//
// Signing in as the office account through GroupMe's own page goes through
// Duck Force (/api/groupme/connect?as=office), because GroupMe only returns
// sign-ins to the one address registered for our app.

import { NextResponse } from "next/server";
import { requireRoleBearer } from "@/lib/auth";
import { getMe, GroupMeError } from "@/lib/groupme";
import { isTokenCryptoConfigured } from "@/lib/groupme-crypto";
import { deleteOffice, storeOffice } from "@/lib/groupme-office";
import { hubPreflight, withHubCors } from "@/lib/hub-cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(req: Request) {
  return hubPreflight(req);
}

export async function POST(req: Request) {
  const { user, error } = await requireRoleBearer(req, "admin");
  if (error || !user) return withHubCors(req, error!);
  if (!isTokenCryptoConfigured()) {
    return withHubCors(req, NextResponse.json({ error: "Duck Force is missing GROUPME_TOKEN_KEY." }, { status: 503 }));
  }
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) {
    return withHubCors(req, NextResponse.json({ error: "Paste the office account's access token." }, { status: 400 }));
  }
  try {
    const me = await getMe(token);
    if (!me) return withHubCors(req, NextResponse.json({ error: "GroupMe didn't recognise that token." }, { status: 400 }));
    await storeOffice(token, me, user.email);
    return withHubCors(req, NextResponse.json({ ok: true, name: me.name }));
  } catch (e) {
    const msg =
      e instanceof GroupMeError && e.status === 401 ? "GroupMe rejected that token. Copy it again." : (e as Error).message;
    return withHubCors(req, NextResponse.json({ error: msg }, { status: 400 }));
  }
}

export async function DELETE(req: Request) {
  const { error } = await requireRoleBearer(req, "admin");
  if (error) return withHubCors(req, error);
  await deleteOffice();
  return withHubCors(req, NextResponse.json({ ok: true }));
}
