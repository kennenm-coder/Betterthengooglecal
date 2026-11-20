// GroupMe settings, called by the NWO Hub (Admin -> Apps -> Duck Force
// settings). Admins only, proven with their own sign-in token (Bearer), from
// the Hub's address only (CORS). Migrations 074/075.
//
//   GET  -> { office: { connected, name, connectedBy },
//             chats: [{ id, name, roles, emails, installerName, hasBot }],
//             roleOptions: [{ value, label }],
//             people: [{ email, name, hasChat }],
//             installers: string[] }
//   PUT  { chats: [{ groupId, roles, emails, installerName, bot }] }
//        -> saves who sees each chat and which installer it belongs to, and
//           adds/removes the Duck Force Bot (through the office account).
//           A chat given to nobody is unshared.

import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getAdminClient, requireRoleBearer } from "@/lib/auth";
import {
  createGroupMeBot,
  deleteBotRow,
  destroyGroupMeBot,
  GroupMeError,
  listBots,
  saveBot,
} from "@/lib/groupme";
import {
  getOffice,
  getOfficeGroups,
  isShared,
  listPeople,
  listSharedChats,
  saveSharedChats,
} from "@/lib/groupme-office";
import { hubPreflight, withHubCors } from "@/lib/hub-cors";
import { CHAT_ROLES, hasAny, ROLE_LABELS } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Where GroupMe should post new messages for the bot: Duck Force itself. */
const DUCK_FORCE_ORIGIN = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://duckforce.nwotoolbox.com";

export function OPTIONS(req: Request) {
  return hubPreflight(req);
}

/** Every installer / crew name on the calendar, for "this chat belongs to". */
async function installerNames(): Promise<string[]> {
  const admin = getAdminClient();
  const { data } = await admin.from("work_orders").select("installer").not("installer", "is", null).limit(50000);
  const set = new Set<string>();
  for (const r of data ?? []) {
    const n = String((r as { installer?: string }).installer || "").trim();
    if (n) set.add(n);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export async function GET(req: Request) {
  const { error } = await requireRoleBearer(req, "admin");
  if (error) return withHubCors(req, error);

  const [office, shared, people, installers] = await Promise.all([
    getOffice(),
    listSharedChats(),
    listPeople(),
    installerNames(),
  ]);
  const sharedById = new Map(shared.map((s) => [s.groupId, s]));

  let chats: {
    id: string;
    name: string;
    roles: string[];
    emails: string[];
    installerName: string | null;
    hasBot: boolean;
  }[] = [];
  let chatsError: string | null = null;
  if (office) {
    try {
      const index = await getOfficeGroups(office);
      const bots = new Set((await listBots([...index.keys()])).map((b) => b.groupId));
      chats = [...index.entries()]
        .map(([id, g]) => {
          const s = sharedById.get(id);
          return {
            id,
            name: g.name,
            roles: s?.roles ?? [],
            emails: s?.emails ?? [],
            installerName: s?.installerName ?? null,
            hasBot: bots.has(id),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      chatsError = e instanceof GroupMeError ? e.message : "Could not load the office account's chats.";
    }
  }

  return withHubCors(
    req,
    NextResponse.json({
      office: { connected: !!office, name: office?.name ?? null, connectedBy: office?.connectedByEmail ?? null },
      chats,
      chatsError,
      roleOptions: Object.entries(ROLE_LABELS)
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      people: people
        .map((p) => ({ email: p.email, name: p.name, hasChat: hasAny(p.roles, CHAT_ROLES) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      installers,
      // Where the Hub sends an admin to sign in as the office account.
      officeSignInUrl: `${DUCK_FORCE_ORIGIN}/api/groupme/connect?as=office`,
    })
  );
}

export async function PUT(req: Request) {
  const { user, error } = await requireRoleBearer(req, "admin");
  if (error || !user) return withHubCors(req, error!);
  const office = await getOffice();
  if (!office) {
    return withHubCors(req, NextResponse.json({ error: "Connect the office account first." }, { status: 409 }));
  }

  const body = (await req.json().catch(() => null)) as { chats?: unknown } | null;
  const rows = Array.isArray(body?.chats) ? body!.chats : null;
  if (!rows) return withHubCors(req, NextResponse.json({ error: "Missing chats." }, { status: 400 }));

  const index = await getOfficeGroups(office);
  const validRoles = new Set(Object.keys(ROLE_LABELS));
  const validEmails = new Set((await listPeople()).map((p) => p.email));
  const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

  const clean = rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .filter((r) => typeof r.groupId === "string" && index.has(r.groupId as string))
    .map((r) => {
      const groupId = r.groupId as string;
      const installer = typeof r.installerName === "string" ? r.installerName.trim().slice(0, 80) : "";
      return {
        groupId,
        groupName: index.get(groupId)?.name ?? null,
        roles: strArr(r.roles).filter((x) => validRoles.has(x)),
        emails: strArr(r.emails).map((e) => e.toLowerCase()).filter((e) => validEmails.has(e)),
        installerName: installer || null,
        wantBot: r.bot !== false,
      };
    });

  try {
    await saveSharedChats(clean, user.email);
  } catch (e) {
    return withHubCors(req, NextResponse.json({ error: (e as Error).message }, { status: 500 }));
  }

  // Bots: on for shared chats (unless turned off), off for unshared ones.
  const bots = new Map((await listBots(clean.map((c) => c.groupId))).map((b) => [b.groupId, b]));
  let botsAdded = 0;
  let botsRemoved = 0;
  const botErrors: string[] = [];
  for (const c of clean) {
    const want = isShared(c) && c.wantBot;
    const have = bots.get(c.groupId);
    try {
      if (want && !have) {
        const callbackKey = randomBytes(24).toString("hex");
        const botId = await createGroupMeBot(
          office.token,
          c.groupId,
          `${DUCK_FORCE_ORIGIN}/api/groupme/bot?k=${callbackKey}`,
          DUCK_FORCE_ORIGIN
        );
        await saveBot({
          groupId: c.groupId,
          botId,
          callbackKey,
          groupName: c.groupName,
          installerName: c.installerName,
          addedByUser: user.id,
          addedByEmail: user.email,
        });
        botsAdded++;
      } else if (!want && have) {
        try {
          await destroyGroupMeBot(office.token, have.botId);
        } catch (e) {
          // Already gone, or owned by someone's own GroupMe: stop using it anyway.
          if (!(e instanceof GroupMeError)) throw e;
        }
        await deleteBotRow(c.groupId);
        botsRemoved++;
      }
    } catch (e) {
      botErrors.push(`${c.groupName || c.groupId}: ${(e as Error).message}`);
    }
  }

  return withHubCors(
    req,
    NextResponse.json({
      ok: true,
      shared: clean.filter(isShared).length,
      botsAdded,
      botsRemoved,
      botErrors,
    })
  );
}
