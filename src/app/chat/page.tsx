"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Bell,
  BellOff,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ListChecks,
  Loader2,
  MessageCircle,
  Search,
  Unlink,
} from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import { useData } from "@/components/DataProvider";
import { crewsForDate } from "@/lib/format-utils";
import { canUseInstallerChat } from "@/lib/roles";
import BottomNav from "@/components/BottomNav";
import InstallerChat from "@/components/InstallerChat";
import GroupMeAttribution from "@/components/GroupMeAttribution";
import NotificationScheduleEditor from "@/components/NotificationScheduleEditor";
import {
  applyLocalReads,
  fetchChatConnection,
  markChatReadLocally,
  prefetchMessages,
  readChatCache,
  writeChatCache,
} from "@/lib/chat-cache";

/**
 * Chat tab -- your own GroupMe conversations, inside Duck Force.
 *
 * Admins and the "GroupMe Chat" role (canUseInstallerChat). Three screens:
 *   1. Connect       -- each person signs in to THEIR OWN GroupMe, once
 *   2. Chats         -- the groups that person ticked, newest activity first
 *   3. Choose chats  -- a checklist of every group their GroupMe account is in
 *
 * Everything is per person (migration 067): what you tick, and what you've
 * read, is yours alone. Messages go out under your own GroupMe name. Nothing
 * you didn't tick is ever shown, so personal groups stay out unless you add
 * them, and direct messages are never read at all.
 */

interface ConnectionState {
  configured: boolean;
  connected: boolean;
  groupmeName: string | null;
  /** Buzz this person's phone for new messages in their chosen chats. */
  notifyMessages?: boolean;
}

interface ChatRow {
  id: string;
  name: string;
  unread: boolean;
  /** Unix seconds of the newest message; 0 when unknown. */
  lastAt: number;
  /** Unix seconds of the first unread message; 0 when read. */
  unreadSince?: number;
  /** The newest message, for the second line. */
  preview?: { name: string; text: string } | null;
  /** Exact unread count (chats with the Duck Force bot); 0 = unknown/none. */
  unreadCount?: number;
  hasBot?: boolean;
  installerName?: string | null;
  /** The group's GroupMe picture. */
  imageUrl?: string | null;
  /** The last message you'd read, for the "New messages" line in the chat. */
  lastReadId?: string | null;
}

/** Two letters for a chat with no picture. */
function chatInitials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N}\s]/gu, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * The group's own GroupMe picture. GroupMe serves a small 60x60 copy when
 * ".avatar" is added to the picture's address, which keeps the list light.
 */
function ChatAvatar({ name, url }: { name: string; url?: string | null }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={`${url}.avatar`}
        alt=""
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setBroken(true)}
        className="w-10 h-10 rounded-full object-cover shrink-0 bg-surface"
      />
    );
  }
  return (
    <span className="w-10 h-10 rounded-full bg-surface border border-border shrink-0 flex items-center justify-center text-xs font-semibold text-muted">
      {chatInitials(name)}
    </span>
  );
}

/**
 * How long a chat has been waiting on you, as a color for its name pill.
 * Counted from the FIRST unread message, stepping once an hour: green, then
 * yellow-green, yellow, orange, and red from 4 hours. Display only.
 */
const AGE_STYLES = [
  { pill: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/40", label: "under an hour" },
  { pill: "bg-lime-500/15 text-lime-700 dark:text-lime-300 border-lime-500/40", label: "over an hour" },
  { pill: "bg-yellow-400/20 text-yellow-700 dark:text-yellow-300 border-yellow-500/40", label: "over 2 hours" },
  { pill: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/40", label: "over 3 hours" },
  { pill: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/40", label: "4+ hours" },
];
const READ_PILL = "bg-surface text-foreground border-border";

function ageStyle(unreadSince: number | undefined, nowMs: number) {
  const hours = unreadSince ? Math.floor((nowMs / 1000 - unreadSince) / 3600) : 0;
  return AGE_STYLES[Math.min(Math.max(hours, 0), AGE_STYLES.length - 1)];
}

interface GroupOption {
  id: string;
  name: string;
  picked: boolean;
}

const CONNECT_MESSAGES: Record<string, string> = {
  ok: "GroupMe connected. Now choose which of your chats to show here.",
  denied: "GroupMe sign-in was cancelled. Tap Sign in with GroupMe to try again.",
  invalid: "GroupMe didn't accept that sign-in. Tap Sign in with GroupMe to try again.",
  nokey: "The server is missing its encryption key, so the connection wasn't saved.",
  noclient: "GroupMe isn't set up on the server yet.",
  signin:
    "GroupMe approved you, but this browser wasn't signed in to Duck Force. Sign in to Duck Force here, then tap Sign in with GroupMe again.",
  forbidden: "Your Duck Force account doesn't have the Chat tab.",
  error: "Something went wrong connecting to GroupMe. Tap Sign in with GroupMe to try again.",
};

function ago(lastAt: number): string {
  if (!lastAt) return "";
  return formatDistanceToNowStrict(new Date(lastAt * 1000), { addSuffix: true });
}

/**
 * useSearchParams() forces this subtree to render on the client, which Next
 * requires us to declare with a Suspense boundary. The default export below
 * supplies it.
 */
function ChatPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, roles, loading: authLoading } = useAuth();
  const allowed = canUseInstallerChat(roles);

  // Start from what the bottom bar already fetched while the app was open
  // (src/lib/chat-cache), so the list shows instantly; the effects below then
  // refresh it quietly.
  const [connection, setConnectionState] = useState<ConnectionState | null>(
    () => readChatCache(user?.id)?.connection ?? null
  );
  // null until the first answer, so the list doesn't flash "no chats".
  const [chats, setChatsState] = useState<ChatRow[] | null>(
    () => readChatCache(user?.id)?.chats ?? null
  );
  const setConnection = useCallback(
    (next: ConnectionState) => {
      setConnectionState(next);
      writeChatCache(user?.id, { connection: next });
    },
    [user?.id]
  );
  const setChats = useCallback(
    (next: ChatRow[] | null) => {
      setChatsState(next ? applyLocalReads(next) : next);
      writeChatCache(user?.id, { chats: next });
    },
    [user?.id]
  );
  const [selected, setSelected] = useState<ChatRow | null>(null);
  /** Open a chat, showing it as read everywhere at once (src/lib/chat-cache). */
  const openChat = useCallback(
    (c: ChatRow) => {
      setSelected(c);
      markChatReadLocally(user?.id, c.id);
      setChatsState(readChatCache(user?.id)?.chats ?? null);
    },
    [user?.id]
  );
  // Opened straight from a link (job card's Messages button, or a buzz):
  // Back returns to where they came from instead of the chat list.
  const [openedFromLink, setOpenedFromLink] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { orders } = useData();
  // Every installer the calendar knows, for the bot's "which installer is
  // this chat for?" pick.
  const installerNames = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      if (o.installer?.trim()) set.add(o.installer.trim());
      for (const n of crewsForDate(o)) if (n?.trim()) set.add(n.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [orders]);
  // The notification menu under the header (GroupMe buzz + schedule).
  const [notifyOpen, setNotifyOpen] = useState(false);
  // Re-color the list every minute even when nothing new arrives.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Choose chats screen.
  const [choosing, setChoosing] = useState(false);
  const [groups, setGroups] = useState<GroupOption[] | null>(null);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);

  // Pasting an access token -- the fallback when GroupMe's sign-in misbehaves.
  const [tokenInput, setTokenInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // Admins + GroupMe Chat role only -- same redirect pattern as legacy-links.
  // Wait for the sign-in check to finish first: until then `roles` is empty, so
  // an admin opening /chat directly (a refresh, a bookmark) was bounced to
  // Settings before their roles had loaded.
  useEffect(() => {
    if (!authLoading && user && !allowed) router.replace("/settings");
  }, [authLoading, user, allowed, router]);

  // Surface the result of the GroupMe redirect, then drop it from the URL so
  // a refresh doesn't replay the banner.
  useEffect(() => {
    const status = searchParams.get("connect");
    if (!status) return;
    setNotice(CONNECT_MESSAGES[status] ?? null);
    router.replace("/chat");
  }, [searchParams, router]);

  // /chat?open=<group id>: go straight into that conversation once the list
  // knows it.
  const openParam = searchParams.get("open");
  useEffect(() => {
    if (!openParam || !chats) return;
    const hit = chats.find((c) => c.id === openParam);
    if (hit) {
      openChat(hit);
      setOpenedFromLink(true);
    } else {
      setNotice("That chat isn't one of your chosen chats. Add it under Choose chats.");
    }
    router.replace("/chat");
  }, [openParam, chats, router, openChat]);

  const loadConnection = useCallback(async () => {
    const next = await fetchChatConnection(user?.id);
    if (next) setConnectionState(next);
  }, [user?.id]);

  const loadChats = useCallback(async () => {
    try {
      const res = await fetch("/api/groupme/unread");
      if (!res.ok) return;
      const body = await res.json();
      setChats((body.chats || []) as ChatRow[]);
    } catch {
      // Leave the last known list rather than clearing it.
    }
  }, [setChats]);

  // Both at once on open, rather than waiting for one before asking the other.
  useEffect(() => {
    if (!allowed) return;
    loadConnection();
    loadChats();
  }, [allowed, loadConnection, loadChats]);

  // Refresh the list whenever it is on screen -- including coming back from a
  // conversation, which should have just cleared its dot -- and every 30 s
  // while it stays open.
  useEffect(() => {
    if (!allowed || selected || choosing || !connection?.connected) return;
    loadChats();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") loadChats();
    }, 30_000);
    return () => clearInterval(timer);
  }, [allowed, selected, choosing, connection?.connected, loadChats]);

  // Load the top few conversations in the background (unread ones first), so
  // tapping one opens it straight away. Each is fetched once per app session.
  useEffect(() => {
    if (!chats?.length || selected || choosing || !user?.id) return;
    const top = [...chats.filter((c) => c.unread), ...chats.filter((c) => !c.unread)]
      .slice(0, 5);
    for (const c of top) prefetchMessages(user.id, c.id);
  }, [chats, selected, choosing, user?.id]);

  async function openChoosing() {
    setChoosing(true);
    setGroupsError(null);
    setFilter("");
    try {
      const res = await fetch("/api/groupme/groups");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not load your groups.");
      const list = (body.groups || []) as GroupOption[];
      setGroups(list);
      setTicked(new Set(list.filter((g) => g.picked).map((g) => g.id)));
    } catch (e) {
      setGroupsError((e as Error).message);
    }
  }

  function toggle(id: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saveChoices() {
    setSaving(true);
    setGroupsError(null);
    try {
      const res = await fetch("/api/groupme/groups", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupIds: Array.from(ticked) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save your chats.");
      setChats(null);
      setChoosing(false);
    } catch (e) {
      setGroupsError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const shownGroups = useMemo(() => {
    if (!groups) return [];
    const q = filter.trim().toLowerCase();
    return q ? groups.filter((g) => g.name.toLowerCase().includes(q)) : groups;
  }, [groups, filter]);

  async function connectWithToken() {
    const token = tokenInput.trim();
    if (!token || connecting) return;

    setConnecting(true);
    setConnectError(null);
    try {
      const res = await fetch("/api/groupme/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not connect.");

      setTokenInput("");
      setNotice(
        `GroupMe connected as ${body.groupmeName || "that account"}. Now choose which of your chats to show here.`
      );
      await loadConnection();
    } catch (e) {
      setConnectError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  }

  async function toggleBuzz() {
    if (!connection) return;
    const next = !(connection.notifyMessages ?? true);
    setConnection({ ...connection, notifyMessages: next });
    const res = await fetch("/api/groupme/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notifyMessages: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setConnection({ ...connection, notifyMessages: !next });
      setNotice("Couldn't save that setting. Try again.");
    }
  }

  async function disconnect() {
    await fetch("/api/groupme/connection", { method: "DELETE" });
    setGroups(null);
    setChats(null);
    setNotice(
      "Your GroupMe is disconnected here (nobody else's is affected). This doesn't revoke access at GroupMe — do that in your GroupMe account if you need to."
    );
    loadConnection();
  }

  if (!allowed) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center text-muted text-sm">
          Redirecting…
        </div>
        <BottomNav />
      </div>
    );
  }

  // --- A conversation is open ---
  if (selected) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0">
          <InstallerChat
            groupId={selected.id}
            title={selected.name}
            imageUrl={selected.imageUrl}
            lastReadId={selected.unread ? selected.lastReadId : null}
            userId={user?.id}
            installerNames={installerNames}
            onBotChanged={loadChats}
            onBack={() => {
              setSelected(null);
              if (openedFromLink) {
                setOpenedFromLink(false);
                if (window.history.length > 1) router.back();
              }
            }}
          />
        </div>
        <BottomNav />
      </div>
    );
  }

  // --- Choose chats ---
  if (choosing) {
    return (
      <div className="flex flex-col h-full">
        <header className="bg-background border-b border-border px-4 py-3 shrink-0">
          <button
            onClick={() => setChoosing(false)}
            className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors mb-1"
          >
            <ChevronLeft className="w-4 h-4" />
            Chat
          </button>
          <div className="flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-primary" />
            <h1 className="text-lg font-semibold">Choose chats</h1>
          </div>
          <p className="text-xs text-muted mt-1">
            Tick the GroupMe groups you want in Duck Force. Only you see this
            list and your choices. Anything you leave unticked stays out.
          </p>
          {groups && groups.length > 8 && (
            <div className="relative mt-2">
              <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Find a group"
                className="w-full bg-surface border border-border rounded-lg pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          )}
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {groupsError && (
            <p className="text-sm text-red-600 px-4 py-3">{groupsError}</p>
          )}
          {!groups && !groupsError && (
            <div className="flex items-center gap-2 text-muted text-sm px-4 py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading your GroupMe groups…
            </div>
          )}
          {groups && groups.length === 0 && (
            <p className="text-sm text-muted px-4 py-4">
              Your GroupMe account isn&apos;t in any groups yet.
            </p>
          )}
          {groups && (
            <ul className="divide-y divide-border">
              {shownGroups.map((g) => {
                const on = ticked.has(g.id);
                return (
                  <li key={g.id}>
                    <button
                      onClick={() => toggle(g.id)}
                      className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-surface transition-colors"
                    >
                      <span
                        className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                          on ? "bg-primary border-primary text-white" : "border-border"
                        }`}
                      >
                        {on && <Check className="w-3.5 h-3.5" />}
                      </span>
                      <span className="text-sm truncate">{g.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border shrink-0">
          <button
            onClick={saveChoices}
            disabled={!groups || saving}
            className="w-full inline-flex items-center justify-center gap-2 bg-primary text-white rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-40"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save: show {ticked.size} chat{ticked.size === 1 ? "" : "s"}
          </button>
        </div>
        <BottomNav />
      </div>
    );
  }

  // --- Main list ---
  return (
    <div className="flex flex-col h-full">
      <header className="bg-background border-b border-border px-4 py-3 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-primary" />
            <h1 className="text-lg font-semibold">Chat</h1>
          </div>
          {connection?.connected && (
            <button
              onClick={openChoosing}
              className="text-xs text-primary inline-flex items-center gap-1"
            >
              <ListChecks className="w-3.5 h-3.5" />
              Choose chats
            </button>
          )}
        </div>
        {connection?.connected && (
          <div className="flex items-center justify-between gap-2 mt-1">
            <p className="text-xs text-muted truncate">
              {connection.groupmeName
                ? `Connected to GroupMe as ${connection.groupmeName}`
                : "Connected to GroupMe"}
            </p>
            {/* Opens the notification menu: GroupMe buzz on/off, plus the
                account-wide schedule (same one as Settings). */}
            <button
              onClick={() => setNotifyOpen((o) => !o)}
              className="text-xs text-muted hover:text-foreground inline-flex items-center gap-1 shrink-0"
              aria-expanded={notifyOpen}
            >
              {connection.notifyMessages !== false ? (
                <Bell className="w-3.5 h-3.5 text-primary" />
              ) : (
                <BellOff className="w-3.5 h-3.5" />
              )}
              Notifications
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${notifyOpen ? "rotate-180" : ""}`}
              />
            </button>
          </div>
        )}
      </header>

      {connection?.connected && notifyOpen && (
        <div className="border-b border-border bg-surface px-4 py-3 space-y-3 shrink-0 max-h-[60vh] overflow-y-auto">
          {/* Once-a-minute check: one buzz per chat with new messages. */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Buzz me for GroupMe messages</p>
              <p className="text-xs text-muted">
                One buzz per chat when something new arrives in your chosen chats.
              </p>
            </div>
            <button
              onClick={toggleBuzz}
              role="switch"
              aria-checked={connection.notifyMessages !== false}
              className={`relative w-10 h-6 rounded-full shrink-0 transition-colors ${
                connection.notifyMessages !== false ? "bg-primary" : "bg-border"
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
                  connection.notifyMessages !== false ? "left-[18px]" : "left-0.5"
                }`}
              />
            </button>
          </div>

          <div>
            <p className="text-sm font-medium mb-1">When Duck Force can buzz you</p>
            <NotificationScheduleEditor compact />
            <p className="text-[11px] text-muted mt-2">
              This is your account&apos;s schedule for ALL Duck Force notifications. You can also
              change it in Settings. Phones must be turned on in Settings to buzz at all.
            </p>
          </div>
        </div>
      )}

      {notice && (
        <div className="px-4 py-2 text-xs bg-surface border-b border-border text-muted shrink-0">
          {notice}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {!connection ? (
          <div className="h-full flex items-center justify-center text-muted text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        ) : !connection.configured ? (
          <div className="px-6 py-10 text-center text-sm text-muted">
            <p className="mb-2 font-medium text-foreground">
              GroupMe isn&apos;t set up on the server yet.
            </p>
            <p>
              It needs <code>GROUPME_CLIENT_ID</code> and{" "}
              <code>GROUPME_TOKEN_KEY</code> before anyone can connect.
            </p>
          </div>
        ) : !connection.connected ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-muted mb-1">
              Sign in to your own GroupMe to read and reply to your chats here.
            </p>
            <p className="text-xs text-muted mb-5">
              Messages you send go out under your own GroupMe name. You choose
              which of your groups show up; direct messages never do.
            </p>
            {/* Signing in through GroupMe is the main path: each person logs
                in to their OWN GroupMe account from here. GroupMe uses the
                browser's existing GroupMe login, so someone already signed
                in to a different GroupMe account on this browser should use
                a private window. Pasting a token stays as a fallback. */}
            <div className="max-w-sm mx-auto text-left">
              <a
                href="/api/groupme/connect"
                className="w-full inline-flex items-center justify-center gap-2 bg-primary text-white rounded-xl px-4 py-2.5 text-sm font-medium"
              >
                <MessageCircle className="w-4 h-4" />
                Sign in with GroupMe
              </a>
              {/* Plain steps for people who don't live in GroupMe settings. */}
              <ol className="text-xs text-muted mt-3 space-y-1 list-decimal pl-5">
                <li>Tap the button. GroupMe&apos;s own sign-in page opens.</li>
                <li>
                  Enter the <strong>phone number or email</strong> and{" "}
                  <strong>GroupMe password</strong> you use in the GroupMe app.
                </li>
                <li>If GroupMe texts you a code, type it in.</li>
                <li>Tap <strong>Allow</strong>. You&apos;ll come straight back here, connected.</li>
              </ol>
              <p className="text-[11px] text-muted mt-3">
                Wrong password, or you normally sign in to GroupMe with Microsoft? Use{" "}
                <strong>Forgot password</strong> in the GroupMe app to set a GroupMe
                password, then try again. Already signed in to someone else&apos;s
                GroupMe on this device? Use a private window.
              </p>
              <a
                href="/api/groupme/connect?via=dialog"
                className="block text-center text-[11px] text-muted underline mt-3 hover:text-foreground"
              >
                Sign-in page not working? Try GroupMe&apos;s other sign-in page
              </a>

              {connectError && (
                <p className="text-xs text-red-600 mt-3 text-center">
                  {connectError}
                </p>
              )}

              <details className="mt-6 text-center">
                <summary className="text-[11px] text-muted cursor-pointer hover:text-foreground">
                  Trouble signing in? Paste an access token instead
                </summary>
                <div className="mt-3 text-left">
                  <label
                    htmlFor="groupme-token"
                    className="block text-xs font-medium mb-1"
                  >
                    Access token
                  </label>
                  <input
                    id="groupme-token"
                    type="password"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && connectWithToken()}
                    placeholder="Paste from dev.groupme.com"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <p className="text-[11px] text-muted mt-1.5 mb-3">
                    Sign in at{" "}
                    <a
                      href="https://dev.groupme.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      dev.groupme.com
                    </a>{" "}
                    with your own GroupMe login, then click{" "}
                    <strong>Access Token</strong> at the top right and copy it
                    here. Treat it like a password.
                  </p>
                  <button
                    onClick={connectWithToken}
                    disabled={!tokenInput.trim() || connecting}
                    className="w-full inline-flex items-center justify-center gap-2 bg-surface border border-border rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-40"
                  >
                    {connecting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <MessageCircle className="w-4 h-4" />
                    )}
                    Connect with token
                  </button>
                </div>
              </details>
            </div>
          </div>
        ) : !chats ? (
          <div className="h-full flex items-center justify-center text-muted text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking your GroupMe chats…
          </div>
        ) : chats.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-muted">
            <p className="mb-4">
              Pick which of your GroupMe chats to show here. Only the ones you
              tick will appear.
            </p>
            <button
              onClick={openChoosing}
              className="inline-flex items-center gap-2 bg-primary text-white rounded-xl px-4 py-2.5 text-sm font-medium"
            >
              <ListChecks className="w-4 h-4" />
              Choose chats
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {chats.map((c) => {
              const age = c.unread ? ageStyle(c.unreadSince, now) : null;
              return (
                <li key={c.id}>
                  <button
                    onClick={() => openChat(c)}
                    className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-surface transition-colors"
                  >
                    <ChatAvatar name={c.name} url={c.imageUrl} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        {/* The chat's name in a pill. Unread: colored by how
                            long it's been waiting. Read: plain. */}
                        <span
                          title={age ? `Unread ${age.label}` : undefined}
                          className={`inline-block max-w-full truncate rounded-full border px-2.5 py-0.5 text-sm ${
                            age ? `${age.pill} font-semibold` : `${READ_PILL} font-medium`
                          }`}
                        >
                          {c.name}
                        </span>
                        {/* How many messages you've missed in this chat. */}
                        {c.unread &&
                          ((c.unreadCount ?? 0) > 0 ? (
                            <span
                              title={`${c.unreadCount} unread message${c.unreadCount === 1 ? "" : "s"}`}
                              className="min-w-[20px] h-5 px-1.5 rounded-full bg-rba-green text-white text-[11px] font-bold leading-5 text-center shrink-0"
                            >
                              {(c.unreadCount ?? 0) >= 100 ? "99+" : c.unreadCount}
                            </span>
                          ) : (
                            <span aria-label="Unread" className="w-2.5 h-2.5 rounded-full bg-rba-green shrink-0" />
                          ))}
                        {c.lastAt > 0 && (
                          <span className="ml-auto text-[11px] text-muted shrink-0">
                            {ago(c.lastAt)}
                          </span>
                        )}
                      </div>
                      {c.preview && (
                        <div
                          className={`mt-1 pl-1 text-xs truncate ${
                            c.unread ? "text-foreground" : "text-muted"
                          }`}
                        >
                          <span className="font-medium">{c.preview.name}:</span>{" "}
                          {c.preview.text}
                        </div>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted shrink-0" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="px-4 py-2 border-t border-border shrink-0 flex items-center justify-between gap-3">
        {/* min-w-0 lets the notice wrap rather than squeezing the button off
            the edge on a narrow phone. */}
        <GroupMeAttribution className="min-w-0" />
        {connection?.connected && (
          <button
            onClick={disconnect}
            className="text-xs text-muted hover:text-foreground inline-flex items-center gap-1.5 shrink-0"
          >
            <Unlink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Disconnect GroupMe</span>
            <span className="sm:hidden">Disconnect</span>
          </button>
        )}
      </div>

      <BottomNav />
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col h-full">
          <div className="flex-1 flex items-center justify-center text-muted text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading…
          </div>
          <BottomNav />
        </div>
      }
    >
      <ChatPageInner />
    </Suspense>
  );
}
