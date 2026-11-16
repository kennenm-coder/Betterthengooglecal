import { getAdminClient } from "@/lib/auth";
import { decryptToken, encryptToken } from "@/lib/groupme-crypto";

/**
 * Server-side GroupMe client + token storage.
 *
 * Only ever import this from an /api/groupme/* route handler, for two
 * independent reasons:
 *   1. The access token must never reach the browser (see groupme-crypto.ts).
 *   2. GroupMe's API sends no CORS headers, so a browser could not call it
 *      directly even if we wanted it to.
 *
 * API reference: https://dev.groupme.com/docs/v3
 */

const BASE = "https://api.groupme.com/v3";
const TIMEOUT_MS = 10_000;

// --- Shapes we actually use (GroupMe returns a lot more) ---

export interface GroupMeGroup {
  id: string;
  name: string;
  image_url: string | null;
  messages?: {
    count: number;
    last_message_id?: string;
    last_message_created_at?: number;
    preview?: { nickname?: string; text?: string | null };
  };
}

export interface GroupMeAttachment {
  type: string;
  url?: string;
  /** Present on "mentions" attachments: who was mentioned. */
  user_ids?: string[];
  /**
   * Present on "mentions" attachments: where each mention sits in the message
   * text, as [startIndex, length] pairs that line up with user_ids by position.
   * The length INCLUDES the "@".
   */
  loci?: [number, number][];
}

export interface GroupMeMember {
  /** The GroupMe account id -- this is what a mention needs. */
  user_id: string;
  /** What they're called in THIS group, which may differ from their real name. */
  nickname: string;
}

export interface GroupMeMessage {
  id: string;
  source_guid: string;
  created_at: number; // unix seconds
  user_id: string;
  group_id: string;
  name: string;
  avatar_url: string | null;
  text: string | null;
  system: boolean;
  attachments: GroupMeAttachment[];
}

export interface GroupMeUser {
  id: string;
  name: string;
  email?: string;
}

export class GroupMeError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GroupMeError";
    this.status = status;
  }
}

// --- Low-level fetch ---

async function groupmeFetch<T>(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<{ data: T | null; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        // Always the header, never the query string -- a token in a URL ends
        // up in request logs.
        "X-Access-Token": token,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
      cache: "no-store",
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = e instanceof Error && e.name === "AbortError";
    throw new GroupMeError(
      aborted ? "GroupMe timed out." : "Could not reach GroupMe.",
      504
    );
  }
  clearTimeout(timer);

  // Documented: a messages query with nothing new returns 304 and no body.
  // That is the normal idle case while polling, not an error.
  if (res.status === 304) return { data: null, status: 304 };

  if (res.status === 401) {
    throw new GroupMeError(
      "GroupMe rejected the connection. The account may need reconnecting.",
      401
    );
  }
  if (!res.ok) {
    throw new GroupMeError(`GroupMe returned ${res.status}.`, res.status);
  }

  const body = (await res.json().catch(() => null)) as { response?: T } | null;
  return { data: (body?.response ?? null) as T | null, status: res.status };
}

// --- API calls ---

/** Who this token belongs to. Used to confirm a connection works. */
export async function getMe(token: string): Promise<GroupMeUser | null> {
  const { data } = await groupmeFetch<GroupMeUser>(token, "/users/me");
  return data;
}

/**
 * Every group this account is in.
 *
 * NOTE: this includes the person's PERSONAL groups -- family, friends,
 * anything. It is only used to fill the admin linking screen and to check
 * which linked groups this person belongs to (getMyGroupIndex); the app only
 * ever displays conversations for groups explicitly linked in installer_chats.
 * Do not surface this list anywhere else, and never call /chats
 * (direct messages) at all.
 */
export async function listGroups(token: string): Promise<GroupMeGroup[]> {
  const all: GroupMeGroup[] = [];
  // per_page defaults to 10; walk pages until one comes back short.
  for (let page = 1; page <= 10; page++) {
    const { data } = await groupmeFetch<GroupMeGroup[]>(
      token,
      `/groups?page=${page}&per_page=100&omit=memberships`
    );
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 100) break;
  }
  return all;
}

export interface MessageQuery {
  /** Older than this id -- how scrolling back through history works. */
  beforeId?: string;
  /** Newer than this id -- how polling for replies works. */
  sinceId?: string;
  limit?: number;
}

/**
 * Messages for a group, newest first. GroupMe caps `limit` at 100.
 * Returns [] when there is nothing new (GroupMe answers 304).
 */
export async function getMessages(
  token: string,
  groupId: string,
  query: MessageQuery = {}
): Promise<GroupMeMessage[]> {
  const params = new URLSearchParams({
    limit: String(Math.min(query.limit ?? 50, 100)),
  });
  if (query.beforeId) params.set("before_id", query.beforeId);
  if (query.sinceId) params.set("since_id", query.sinceId);

  const { data } = await groupmeFetch<{ messages: GroupMeMessage[] }>(
    token,
    `/groups/${encodeURIComponent(groupId)}/messages?${params}`
  );
  return data?.messages ?? [];
}

/** Who is in this group, so the composer can offer them for @-mentions. */
export async function getGroupMembers(
  token: string,
  groupId: string
): Promise<GroupMeMember[]> {
  const { data } = await groupmeFetch<{ members?: GroupMeMember[] }>(
    token,
    `/groups/${encodeURIComponent(groupId)}`
  );
  return (data?.members ?? [])
    .filter((m) => m.user_id && m.nickname)
    .map((m) => ({ user_id: m.user_id, nickname: m.nickname }));
}

/**
 * Post into the real GroupMe group, as the account whose token this is.
 *
 * `source_guid` is GroupMe's own duplicate guard: the same guid inside a
 * one-minute window is ignored rather than posted twice, so a retry or a
 * double-tap cannot spam the installer's group.
 */
export async function sendMessage(
  token: string,
  groupId: string,
  text: string,
  attachments: GroupMeAttachment[] = []
): Promise<GroupMeMessage | null> {
  const { data } = await groupmeFetch<{ message: GroupMeMessage }>(
    token,
    `/groups/${encodeURIComponent(groupId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        message: { source_guid: crypto.randomUUID(), text, attachments },
      }),
    }
  );
  return data?.message ?? null;
}

// --- Token storage (service role only -- see migration 025) ---

export interface StoredConnection {
  groupmeUserId: string | null;
  groupmeName: string | null;
  connectedAt: string;
}

/** The decrypted token for this app user, or null if they haven't connected. */
export async function getTokenForUser(userId: string): Promise<string | null> {
  const admin = getAdminClient();
  const { data } = await admin
    .from("groupme_tokens")
    .select("access_token_encrypted")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data?.access_token_encrypted) return null;
  try {
    return decryptToken(data.access_token_encrypted);
  } catch {
    // Wrong key or a tampered row -- treat as not connected rather than
    // handing GroupMe something meaningless.
    return null;
  }
}

/**
 * EVERY call in this app runs on the signed-in person's OWN GroupMe account.
 *
 * October's pilot shared one office account ("RBANWO Office") between every
 * user and wrote the real author's name into the text. That was replaced by
 * per-person connections so a message shows up in GroupMe under the person who
 * actually sent it. The trade-off that comes with it: a person can only read
 * and post in groups their own GroupMe account belongs to (see
 * getMyGroupIndex), so someone who isn't in an installer's group simply won't
 * see that chat.
 */

/** Connection details for the UI, without ever exposing the token itself. */
export async function getConnection(
  userId: string
): Promise<StoredConnection | null> {
  const admin = getAdminClient();
  const { data } = await admin
    .from("groupme_tokens")
    .select("groupme_user_id, groupme_name, connected_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return null;
  return {
    groupmeUserId: data.groupme_user_id,
    groupmeName: data.groupme_name,
    connectedAt: data.connected_at,
  };
}

export async function storeToken(
  userId: string,
  email: string,
  token: string,
  me: GroupMeUser | null
): Promise<void> {
  const admin = getAdminClient();
  const { error } = await admin.from("groupme_tokens").upsert(
    {
      user_id: userId,
      email: email.toLowerCase(),
      access_token_encrypted: encryptToken(token),
      groupme_user_id: me?.id ?? null,
      groupme_name: me?.name ?? null,
      connected_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) {
    throw new Error(`Could not save the GroupMe connection: ${error.message}`);
  }
  // A different account may now sit behind this user -- drop the old one's
  // group list so membership is re-checked against the new account.
  groupCache.delete(userId);
}

/**
 * Forget THIS user's copy of their token. Nobody else's connection is touched.
 *
 * Worth being honest in the UI about what this does NOT do: GroupMe publishes
 * no revocation endpoint, so the token itself very likely stays valid on their
 * side. This removes our ability to use it, not its existence.
 */
export async function deleteToken(userId: string): Promise<void> {
  const admin = getAdminClient();
  await admin.from("groupme_tokens").delete().eq("user_id", userId);
  groupCache.delete(userId);
}

// --- Which groups this person's account is in (and their newest message) ---

/**
 * Every group THIS user's GroupMe account is in, mapped to that group's newest
 * message id ("" for a group with no messages yet).
 *
 * Does double duty:
 *   - Membership: a linked chat is only offered to someone whose own account
 *     is in that group, and every read/send route checks it here first, so a
 *     person can't be pointed at a group they don't belong to.
 *   - Unread: /groups carries each group's last_message_id, so one call covers
 *     every chat at once. No message text is read or kept.
 *
 * Cached PER USER for 30 s, because each signed-in user's nav bar asks for this
 * every minute and every open conversation re-checks membership on each poll.
 * Keyed by app user, never shared: different people are in different groups.
 * The licence asks us to respect API limits (§4.10) and GroupMe publishes none
 * to aim at, so this errs on the side of asking less.
 */
const groupCache = new Map<string, { at: number; byGroup: Map<string, string> }>();
const GROUP_TTL_MS = 30_000;

export async function getMyGroupIndex(
  userId: string,
  token: string
): Promise<Map<string, string>> {
  const hit = groupCache.get(userId);
  if (hit && Date.now() - hit.at < GROUP_TTL_MS) return hit.byGroup;

  const groups = await listGroups(token);
  const byGroup = new Map<string, string>();
  for (const g of groups) byGroup.set(g.id, g.messages?.last_message_id ?? "");

  groupCache.set(userId, { at: Date.now(), byGroup });
  return byGroup;
}

/** Everything this ONE user has read, keyed by installer name. */
export async function getReadState(
  userId: string
): Promise<Record<string, string>> {
  const admin = getAdminClient();
  const { data } = await admin
    .from("installer_chat_reads")
    .select("installer_name, last_read_message_id")
    .eq("user_id", userId);

  const out: Record<string, string> = {};
  for (const row of (data ?? []) as {
    installer_name: string;
    last_read_message_id: string;
  }[]) {
    out[row.installer_name] = row.last_read_message_id;
  }
  return out;
}

/** Move this user's bookmark for one installer. Never stores message content. */
export async function markRead(
  userId: string,
  installerName: string,
  messageId: string
): Promise<void> {
  const admin = getAdminClient();
  await admin.from("installer_chat_reads").upsert(
    {
      user_id: userId,
      installer_name: installerName,
      last_read_message_id: messageId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,installer_name" }
  );
}

/** Every installer -> group mapping, for working out unread across the board. */
export async function listMappings(): Promise<
  { installerName: string; groupId: string }[]
> {
  const admin = getAdminClient();
  const { data } = await admin
    .from("installer_chats")
    .select("installer_name, groupme_group_id");

  return ((data ?? []) as {
    installer_name: string;
    groupme_group_id: string;
  }[]).map((r) => ({
    installerName: r.installer_name,
    groupId: r.groupme_group_id,
  }));
}

/** The GroupMe group mapped to this installer, or null if unmapped. */
export async function resolveGroupId(
  installerName: string
): Promise<string | null> {
  const admin = getAdminClient();
  const { data } = await admin
    .from("installer_chats")
    .select("groupme_group_id")
    .eq("installer_name", installerName)
    .maybeSingle();
  return data?.groupme_group_id ?? null;
}
