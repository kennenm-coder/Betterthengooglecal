// Office setup (admins only, migration 074): the office GroupMe account and
// which of its chats each Duck Force role sees.
//
//   GET                    -> { office: { connected, name, connectedBy },
//                               groups: [{ id, name, roles, hasBot }],
//                               roleOptions: [{ value, label }] }
//   POST   { token }       -> connect the office account by pasting its token
//                             (admins only; "Sign in with GroupMe" for the
//                             office account is /api/groupme/connect?as=office)
//   PUT    { shared: [{ groupId, roles }] }
//                          -> save which roles see each office chat. Chats
//                             newly shared get the Duck Force Bot added through
//                             the office account, so everyone's buzzes and
//                             unread counts are instant.
//   DELETE                 -> disconnect the office account

import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireRole } from "@/lib/auth";
import { createGroupMeBot, getMe, GroupMeError, listBots, saveBot } from "@/lib/groupme";
import {
  deleteOffice,
  getOffice,
  getOfficeGroups,
  listSharedChats,
  saveSharedChats,
  storeOffice,
} from "@/lib/groupme-office";
import { isTokenCryptoConfigured } from "@/lib/groupme-crypto";
import { ROLE_LABELS } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await requireRole("admin");
  if (error) return error;

  const [office, shared] = await Promise.all([getOffice(), listSharedChats()]);
  const sharedById = new Map(shared.map((s) => [s.groupId, s]));
  let groups: { id: string; name: string; roles: string[]; hasBot: boolean }[] = [];
  let groupsError: string | null = null;

  if (office) {
    try {
      const index = await getOfficeGroups(office);
      const bots = new Set((await listBots([...index.keys()])).map((b) => b.groupId));
      groups = [...index.entries()]
        .map(([id, g]) => ({ id, name: g.name, roles: sharedById.get(id)?.roles ?? [], hasBot: bots.has(id) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      groupsError = e instanceof GroupMeError ? e.message : "Could not load the office account's chats.";
    }
  }

  return NextResponse.json({
    office: {
      connected: !!office,
      name: office?.name ?? null,
      connectedBy: office?.connectedByEmail ?? null,
    },
    groups,
    groupsError,
    roleOptions: Object.entries(ROLE_LABELS)
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  });
}

export async function POST(req: Request) {
  const { user, error } = await requireRole("admin");
  if (error || !user) return error!;
  if (!isTokenCryptoConfigured()) {
    return NextResponse.json({ error: "The server is missing GROUPME_TOKEN_KEY." }, { status: 503 });
  }
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) return NextResponse.json({ error: "Paste the office account's access token." }, { status: 400 });

  try {
    const me = await getMe(token);
    if (!me) return NextResponse.json({ error: "GroupMe didn't recognise that token." }, { status: 400 });
    await storeOffice(token, me, user.email);
    return NextResponse.json({ ok: true, name: me.name });
  } catch (e) {
    if (e instanceof GroupMeError && e.status === 401) {
      return NextResponse.json({ error: "GroupMe rejected that token. Copy it again." }, { status: 400 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const { user, error } = await requireRole("admin");
  if (error || !user) return error!;
  const office = await getOffice();
  if (!office) return NextResponse.json({ error: "Connect the office account first." }, { status: 409 });

  const body = (await req.json().catch(() => null)) as { shared?: unknown } | null;
  const rows = Array.isArray(body?.shared) ? body!.shared : null;
  if (!rows) return NextResponse.json({ error: "Missing shared." }, { status: 400 });

  // Only real office chats, only real role names.
  const index = await getOfficeGroups(office);
  const validRoles = new Set(Object.keys(ROLE_LABELS));
  const clean = rows
    .filter((r): r is { groupId: string; roles: unknown } => !!r && typeof (r as { groupId?: unknown }).groupId === "string")
    .filter((r) => index.has(r.groupId))
    .map((r) => ({
      groupId: r.groupId,
      groupName: index.get(r.groupId)?.name ?? null,
      roles: (Array.isArray(r.roles) ? r.roles : []).filter(
        (x): x is string => typeof x === "string" && validRoles.has(x)
      ),
    }));

  try {
    await saveSharedChats(clean, user.email);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // Shared chats without the Duck Force Bot get it, through the office account.
  const sharedIds = clean.filter((c) => c.roles.length > 0).map((c) => c.groupId);
  const haveBot = new Set((await listBots(sharedIds)).map((b) => b.groupId));
  const origin = new URL(req.url).origin;
  let botsAdded = 0;
  const botErrors: string[] = [];
  for (const c of clean.filter((c) => c.roles.length > 0 && !haveBot.has(c.groupId))) {
    try {
      const callbackKey = randomBytes(24).toString("hex");
      const botId = await createGroupMeBot(
        office.token,
        c.groupId,
        `${origin}/api/groupme/bot?k=${callbackKey}`,
        origin
      );
      await saveBot({
        groupId: c.groupId,
        botId,
        callbackKey,
        groupName: c.groupName,
        installerName: null,
        addedByUser: user.id,
        addedByEmail: user.email,
      });
      botsAdded++;
    } catch (e) {
      botErrors.push(`${c.groupName || c.groupId}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({ ok: true, saved: clean.filter((c) => c.roles.length > 0).length, botsAdded, botErrors });
}

export async function DELETE() {
  const { error } = await requireRole("admin");
  if (error) return error;
  await deleteOffice();
  return NextResponse.json({ ok: true });
}
