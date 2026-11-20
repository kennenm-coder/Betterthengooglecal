// Make a NEW GroupMe chat from the NWO Hub, owned by the office account.
// Admins only (Bearer token, Hub address only).
//
//   POST { name, members?: [{ name, phone }] }
//     -> creates the chat through the office account (so the office account is
//        in it from the start), invites the listed people by phone number,
//        and returns { groupId, name }. The Hub then saves who sees it (and
//        the Duck Force Bot goes in) with PUT /api/hub/groupme.

import { NextResponse } from "next/server";
import { requireRoleBearer } from "@/lib/auth";
import { addGroupMembers, createGroup, forgetGroupIndex, GroupMeError } from "@/lib/groupme";
import { getOffice, OFFICE_KEY } from "@/lib/groupme-office";
import { hubPreflight, withHubCors } from "@/lib/hub-cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(req: Request) {
  return hubPreflight(req);
}

/** "(734) 224-5369" -> "+1 7342245369"; anything that isn't a phone number -> null. */
function cleanPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1 ${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+1 ${digits.slice(1)}`;
  return null;
}

export async function POST(req: Request) {
  const { error } = await requireRoleBearer(req, "admin");
  if (error) return withHubCors(req, error);
  const office = await getOffice();
  if (!office) {
    return withHubCors(req, NextResponse.json({ error: "Connect the office account first." }, { status: 409 }));
  }

  const body = (await req.json().catch(() => null)) as { name?: unknown; members?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 140) : "";
  if (!name) return withHubCors(req, NextResponse.json({ error: "Give the chat a name." }, { status: 400 }));

  const members: { nickname: string; phone_number: string }[] = [];
  const skipped: string[] = [];
  for (const m of Array.isArray(body?.members) ? body!.members : []) {
    const nm = typeof (m as { name?: unknown })?.name === "string" ? String((m as { name: string }).name).trim() : "";
    const ph = typeof (m as { phone?: unknown })?.phone === "string" ? String((m as { phone: string }).phone) : "";
    if (!nm && !ph) continue;
    const phone = cleanPhone(ph);
    if (!nm || !phone) {
      skipped.push(nm || ph);
      continue;
    }
    members.push({ nickname: nm.slice(0, 50), phone_number: phone });
  }

  try {
    const group = await createGroup(office.token, name);
    await addGroupMembers(office.token, group.id, members);
    forgetGroupIndex(OFFICE_KEY); // so the new chat shows up straight away
    return withHubCors(req, NextResponse.json({ ok: true, groupId: group.id, name: group.name, invited: members.length, skipped }));
  } catch (e) {
    const msg = e instanceof GroupMeError ? e.message : (e as Error).message;
    return withHubCors(req, NextResponse.json({ error: msg }, { status: 502 }));
  }
}
