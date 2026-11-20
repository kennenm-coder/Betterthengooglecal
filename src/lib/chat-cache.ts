/**
 * The Chat tab's last known state, kept in memory while Duck Force is open so
 * tapping Chat draws your list straight away instead of waiting on GroupMe.
 *
 * The bottom bar fills it as soon as the app loads (it already checks unread
 * chats every minute for the badge), and the Chat page reads it on open, then
 * refreshes it quietly behind the scenes.
 *
 * Opened conversations are kept too (and the top few are loaded ahead of
 * time), so going back into a chat shows it at once and only fetches what's
 * new.
 *
 * Memory only, on purpose: nothing is written to the phone's storage, so the
 * list goes away when the app is closed and no GroupMe data is kept anywhere.
 * It is also cleared when the signed-in account changes.
 */

export interface CachedConnection {
  configured: boolean;
  connected: boolean;
  groupmeName: string | null;
  notifyMessages?: boolean;
}

export interface CachedChat {
  id: string;
  name: string;
  unread: boolean;
  /** Unix seconds of the newest message; 0 when unknown. */
  lastAt: number;
  /** Unix seconds of the first unread message; 0 when read. */
  unreadSince?: number;
  /** The newest message, for the list's second line. */
  preview?: { name: string; text: string } | null;
  /** Exact unread count (chats with the Duck Force bot); 0 = unknown/none. */
  unreadCount?: number;
  hasBot?: boolean;
  /** Calendar installer this chat is linked to via the bot. */
  installerName?: string | null;
  /** The group's GroupMe picture. */
  imageUrl?: string | null;
  /** The last message this person had read, for the "New messages" line. */
  lastReadId?: string | null;
}

/** One message as the conversation view draws it (see InstallerChat). */
export interface CachedMessage {
  id: string;
  [field: string]: unknown;
}

interface ChatCache {
  /** Whose state this is, so a different login never sees it. */
  userId: string | null;
  connection: CachedConnection | null;
  chats: CachedChat[] | null;
}

let cache: ChatCache = { userId: null, connection: null, chats: null };

/** Each opened (or pre-loaded) conversation's messages, by group id. */
let messageCache: { userId: string | null; byGroup: Map<string, CachedMessage[]> } = {
  userId: null,
  byGroup: new Map(),
};
/** How many messages to keep per chat -- enough for a screen and some scroll. */
const KEEP_MESSAGES = 150;
const inFlight = new Set<string>();

export function readChatCache(userId: string | null | undefined): ChatCache | null {
  if (!userId || cache.userId !== userId) return null;
  return cache;
}

export function writeChatCache(
  userId: string | null | undefined,
  patch: Partial<Omit<ChatCache, "userId">>
): void {
  if (!userId) return;
  if (cache.userId !== userId) {
    cache = { userId, connection: null, chats: null };
    readLocally.clear();
  }
  if (patch.chats) patch = { ...patch, chats: applyLocalReads(patch.chats) };
  cache = { ...cache, ...patch };
  if ("chats" in patch) for (const fn of listeners) fn();
}

/**
 * Chats opened in this session, and when (unix seconds). Opening a chat marks
 * it read on screen straight away -- list, nav badge, job card button, app
 * icon -- instead of waiting for the server's next check to catch up. A
 * server answer that was already on its way still says "unread", so for a
 * short while that answer is overruled unless something genuinely NEW has
 * arrived since the chat was opened.
 */
const readLocally = new Map<string, number>();
const LOCAL_READ_WINDOW_S = 90;

export function applyLocalReads(chats: CachedChat[]): CachedChat[] {
  if (readLocally.size === 0) return chats;
  const now = Date.now() / 1000;
  return chats.map((c) => {
    const at = readLocally.get(c.id);
    if (at === undefined) return c;
    if (now - at > LOCAL_READ_WINDOW_S) {
      readLocally.delete(c.id);
      return c;
    }
    // A message newer than the moment it was opened is real news: keep it.
    if (c.lastAt > at) return c;
    return { ...c, unread: false, unreadCount: 0, unreadSince: 0 };
  });
}

/** Opening a chat: show it as read everywhere right now. */
export function markChatReadLocally(userId: string | null | undefined, groupId: string): void {
  if (!userId || cache.userId !== userId) return;
  readLocally.set(groupId, Date.now() / 1000);
  if (cache.chats) writeChatCache(userId, { chats: cache.chats });
}

const listeners = new Set<() => void>();

/** Be told whenever the chat list changes (the job card's Messages button). */
export function watchChatCache(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function readMessages(
  userId: string | null | undefined,
  groupId: string
): CachedMessage[] | null {
  if (!userId || messageCache.userId !== userId) return null;
  return messageCache.byGroup.get(groupId) ?? null;
}

export function writeMessages(
  userId: string | null | undefined,
  groupId: string,
  messages: CachedMessage[]
): void {
  if (!userId) return;
  if (messageCache.userId !== userId) messageCache = { userId, byGroup: new Map() };
  messageCache.byGroup.set(groupId, messages.slice(-KEEP_MESSAGES));
}

/**
 * Load a conversation in the background so it opens instantly when tapped.
 * Skips chats already loaded (or loading).
 */
export async function prefetchMessages(
  userId: string | null | undefined,
  groupId: string
): Promise<void> {
  if (!userId || readMessages(userId, groupId) || inFlight.has(groupId)) return;
  inFlight.add(groupId);
  try {
    const res = await fetch(`/api/groupme/messages?group=${encodeURIComponent(groupId)}`);
    if (!res.ok) return;
    const body = await res.json();
    if (Array.isArray(body.messages) && !readMessages(userId, groupId)) {
      writeMessages(userId, groupId, body.messages as CachedMessage[]);
    }
  } catch {
    // Just a head start; opening the chat loads it properly anyway.
  } finally {
    inFlight.delete(groupId);
  }
}

/** Fetch the connection state and remember it. Returns null if it failed. */
export async function fetchChatConnection(
  userId: string | null | undefined
): Promise<CachedConnection | null> {
  try {
    const res = await fetch("/api/groupme/connection");
    const connection: CachedConnection = res.ok
      ? await res.json()
      : { configured: false, connected: false, groupmeName: null };
    writeChatCache(userId, { connection });
    return connection;
  } catch {
    return null;
  }
}
