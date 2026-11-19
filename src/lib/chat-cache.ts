/**
 * The Chat tab's last known state, kept in memory while Duck Force is open so
 * tapping Chat draws your list straight away instead of waiting on GroupMe.
 *
 * The bottom bar fills it as soon as the app loads (it already checks unread
 * chats every minute for the badge), and the Chat page reads it on open, then
 * refreshes it quietly behind the scenes.
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
}

interface ChatCache {
  /** Whose state this is, so a different login never sees it. */
  userId: string | null;
  connection: CachedConnection | null;
  chats: CachedChat[] | null;
}

let cache: ChatCache = { userId: null, connection: null, chats: null };

export function readChatCache(userId: string | null | undefined): ChatCache | null {
  if (!userId || cache.userId !== userId) return null;
  return cache;
}

export function writeChatCache(
  userId: string | null | undefined,
  patch: Partial<Omit<ChatCache, "userId">>
): void {
  if (!userId) return;
  if (cache.userId !== userId) cache = { userId, connection: null, chats: null };
  cache = { ...cache, ...patch };
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
