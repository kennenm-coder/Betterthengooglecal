// ─── The office GroupMe account + chats shared by role (server only) ────────
//
// Migration 074. An admin connects ONE office GroupMe account ("RBANWO
// Office") and picks which of its chats each Duck Force role can see.
// Everyone with the Chat role then reads and sends in those chats through the
// office account -- no GroupMe sign-in of their own. Their access follows
// their Duck Force account: lose the role, or the account, and the chats are
// gone, with nobody removing them from GroupMe groups.
//
// Sending through the office account: GroupMe shows every such message as
// "RBANWO Office" and has no way to set a per-message sender, so the text
// starts with the person's name ("Kennen M: running late") for the installers,
// and each message is tagged (GroupMe's source_guid) in groupme_sent with the
// Duck Force person who sent it, so Duck Force can show the right name above
// it, treat it as theirs, and not buzz them about their own message. Ids and
// names only, never the text (GroupMe licence §4.5).

import { getAdminClient } from "@/lib/auth";
import { decryptToken, encryptToken } from "@/lib/groupme-crypto";
import { forgetGroupIndex, getMyGroupIndex, type GroupMeUser, type MyGroup } from "@/lib/groupme";
import { hasAny, isAdmin, CHAT_ROLES, type RoleInput } from "@/lib/roles";

/** Key the office account's cached group list under (never a user id). */
export const OFFICE_KEY = "office";

export interface OfficeAccount {
  token: string;
  groupmeUserId: string | null;
  name: string | null;
  connectedByEmail: string | null;
}

export async function getOffice(): Promise<OfficeAccount | null> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("groupme_office")
    .select("access_token_encrypted, groupme_user_id, groupme_name, connected_by_email")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data?.access_token_encrypted) return null;
  try {
    return {
      token: decryptToken(data.access_token_encrypted),
      groupmeUserId: data.groupme_user_id ?? null,
      name: data.groupme_name ?? null,
      connectedByEmail: data.connected_by_email ?? null,
    };
  } catch {
    return null;
  }
}

export async function storeOffice(token: string, me: GroupMeUser | null, byEmail: string): Promise<void> {
  const admin = getAdminClient();
  const { error } = await admin.from("groupme_office").upsert(
    {
      id: 1,
      access_token_encrypted: encryptToken(token),
      groupme_user_id: me?.id ?? null,
      groupme_name: me?.name ?? null,
      connected_by_email: byEmail.toLowerCase(),
      connected_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`Could not save the office account: ${error.message}`);
  forgetGroupIndex(OFFICE_KEY);
}

export async function deleteOffice(): Promise<void> {
  const admin = getAdminClient();
  await admin.from("groupme_office").delete().eq("id", 1);
  forgetGroupIndex(OFFICE_KEY);
}

/** Every group the office account is in (cached 30 s, like a person's). */
export async function getOfficeGroups(office: OfficeAccount): Promise<Map<string, MyGroup>> {
  return getMyGroupIndex(OFFICE_KEY, office.token);
}

// --- Which office chats each role sees ---

export interface SharedChat {
  groupId: string;
  groupName: string | null;
  roles: string[];
  /** Individual Duck Force accounts given this chat, by login email (075). */
  emails: string[];
  /** The calendar installer / lead this chat belongs to (075). */
  installerName: string | null;
}

export async function listSharedChats(): Promise<SharedChat[]> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("groupme_shared_chats")
    .select("group_id, group_name, roles, emails, installer_name");
  if (error) return []; // before migration 075
  return (data ?? []).map((r) => ({
    groupId: String(r.group_id),
    groupName: (r.group_name as string | null) ?? null,
    roles: Array.isArray(r.roles) ? (r.roles as string[]) : [],
    emails: Array.isArray(r.emails) ? (r.emails as string[]).map((e) => e.toLowerCase()) : [],
    installerName: (r.installer_name as string | null) || null,
  }));
}

/**
 * Can this person see this shared chat? They need the Chat tab (admin or the
 * GroupMe Chat role), and then: admin, or a role the chat is shared with, or
 * their own account added to it individually.
 */
export function canSeeShared(chat: SharedChat, roles: RoleInput, email?: string | null): boolean {
  if (!hasAny(roles, CHAT_ROLES)) return false; // no Chat tab at all
  if (isAdmin(roles) || hasAny(roles, chat.roles)) return true;
  return !!email && chat.emails.includes(email.toLowerCase());
}

/** The shared chats this person can see, by group id. */
export async function sharedChatsFor(
  roles: RoleInput,
  email?: string | null
): Promise<Map<string, SharedChat>> {
  const all = await listSharedChats();
  return new Map(all.filter((c) => canSeeShared(c, roles, email)).map((c) => [c.groupId, c]));
}

/** Is this chat given to anyone (a role or a person)? */
export function isShared(chat: Pick<SharedChat, "roles" | "emails">): boolean {
  return chat.roles.length > 0 || chat.emails.length > 0;
}

/** Replace the shared-chat list (admin screen). Chats given to nobody are dropped. */
export async function saveSharedChats(rows: SharedChat[], byEmail: string): Promise<void> {
  const admin = getAdminClient();
  const keep = rows.filter(isShared);
  const ids = keep.map((r) => r.groupId);
  let del = admin.from("groupme_shared_chats").delete().neq("group_id", "");
  if (ids.length) del = del.not("group_id", "in", `(${ids.map((id) => `"${id}"`).join(",")})`);
  const { error: delError } = await del;
  if (delError) throw new Error(`Could not save shared chats: ${delError.message}`);
  if (keep.length === 0) return;
  const { error } = await admin.from("groupme_shared_chats").upsert(
    keep.map((r) => ({
      group_id: r.groupId,
      group_name: r.groupName,
      roles: r.roles,
      emails: r.emails.map((e) => e.toLowerCase()),
      installer_name: r.installerName,
      updated_by_email: byEmail.toLowerCase(),
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "group_id" }
  );
  if (error) throw new Error(`Could not save shared chats: ${error.message}`);
}

// --- People ---

export interface DuckForcePerson {
  email: string;
  name: string;
  roles: string[];
}

/** Everyone on the Duck Force allowlist, with their display name and roles. */
export async function listPeople(): Promise<DuckForcePerson[]> {
  const admin = getAdminClient();
  const { data } = await admin.from("allowed_emails").select("email, name, role, roles");
  return (data ?? []).map((r) => {
    const email = String(r.email || "").toLowerCase();
    const roles: string[] =
      Array.isArray(r.roles) && r.roles.length ? (r.roles as string[]) : r.role ? [String(r.role)] : [];
    return { email, name: displayName(r.name as string | null, email), roles };
  });
}

/** "Kennen McIntyre" -> as typed in the Team editor; else the email's first part. */
export function displayName(name: string | null | undefined, email: string): string {
  const n = (name || "").trim();
  if (n) return n;
  const local = email.split("@")[0] || email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/** Short form for the name in front of office messages: "Kennen McIntyre" -> "Kennen M". */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || "Duck Force";
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}`;
}

// --- Who sent each office message ---

export interface SentInfo {
  userId: string | null;
  email: string | null;
  name: string;
}

export async function recordSent(row: {
  sourceGuid: string;
  groupId: string;
  userId: string;
  email: string;
  name: string;
}): Promise<void> {
  const admin = getAdminClient();
  const { error } = await admin.from("groupme_sent").insert({
    source_guid: row.sourceGuid,
    group_id: row.groupId,
    sender_user_id: row.userId,
    sender_email: row.email.toLowerCase(),
    sender_name: row.name,
  });
  if (error) throw new Error(`Could not record the message: ${error.message}`);
}

export async function setSentMessageId(sourceGuid: string, messageId: string): Promise<void> {
  const admin = getAdminClient();
  await admin.from("groupme_sent").update({ message_id: messageId }).eq("source_guid", sourceGuid);
}

/** Who sent these office messages, by GroupMe source_guid. */
export async function lookupSent(guids: string[]): Promise<Map<string, SentInfo>> {
  const out = new Map<string, SentInfo>();
  const list = [...new Set(guids.filter(Boolean))];
  if (list.length === 0) return out;
  const admin = getAdminClient();
  const { data } = await admin
    .from("groupme_sent")
    .select("source_guid, sender_user_id, sender_email, sender_name")
    .in("source_guid", list);
  for (const r of data ?? []) {
    out.set(String(r.source_guid), {
      userId: (r.sender_user_id as string | null) ?? null,
      email: (r.sender_email as string | null) ?? null,
      name: String(r.sender_name || "Duck Force"),
    });
  }
  return out;
}

/** "Kennen M: running late" -> "running late", when it starts with that name. */
export function stripSenderPrefix(text: string, name: string): string {
  const prefix = `${shortName(name)}: `;
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

/**
 * Duck Force people who can see this chat through the office account: on the
 * allowlist, with the Chat tab, and a role the chat is shared with (admins
 * always). Feeds the @-picker and decides whom an @mention may notify.
 */
export async function peopleForChat(groupId: string): Promise<DuckForcePerson[]> {
  const chat = (await listSharedChats()).find((c) => c.groupId === groupId);
  if (!chat) return [];
  return (await listPeople()).filter((p) => canSeeShared(chat, p.roles, p.email));
}

/** One person's display name (Team editor name, or from their email). */
export async function nameFor(email: string): Promise<string> {
  const admin = getAdminClient();
  const { data } = await admin
    .from("allowed_emails")
    .select("name")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  return displayName((data?.name as string | null) ?? null, email.toLowerCase());
}

/**
 * Profile pictures set on the NWO Hub's Team page (employee_profiles, Hub
 * migration 007), by login email. Shown next to messages people send through
 * the office account. Missing table or picture -> simply not in the map.
 */
export async function avatarsFor(emails: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const list = [...new Set(emails.filter(Boolean).map((e) => e.toLowerCase()))];
  if (list.length === 0) return out;
  const admin = getAdminClient();
  const { data, error } = await admin.from("employee_profiles").select("email, avatar_url").in("email", list);
  if (error) return out;
  for (const r of data ?? []) {
    if (r.avatar_url) out.set(String(r.email).toLowerCase(), String(r.avatar_url));
  }
  return out;
}
