"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Link2,
  Loader2,
  MessageCircle,
  Unlink,
} from "lucide-react";
import { useData } from "@/components/DataProvider";
import { useAuth } from "@/hooks/useAuth";
import { canUseInstallerChat } from "@/lib/roles";
import { crewsForDate } from "@/lib/format-utils";
import BottomNav from "@/components/BottomNav";
import InstallerChat from "@/components/InstallerChat";
import GroupMeAttribution from "@/components/GroupMeAttribution";
import {
  deleteInstallerChat,
  fetchInstallerChats,
  upsertInstallerChat,
  type InstallerChat as Mapping,
} from "@/lib/installer-chat-store";

/**
 * Chat tab -- GroupMe conversations with lead installers.
 *
 * Admin only for now (canUseInstallerChat). Three screens:
 *   1. Connect   -- link your own GroupMe account, once
 *   2. Installers -- the people who have a group linked
 *   3. Linking   -- admin screen pairing an installer with an existing group
 *
 * The installer never has to do anything differently: these are their existing
 * groups and they keep using GroupMe as they always have.
 */

interface ConnectionState {
  configured: boolean;
  connected: boolean;
  groupmeName: string | null;
}

interface GroupOption {
  id: string;
  name: string;
}

const CONNECT_MESSAGES: Record<string, string> = {
  ok: "GroupMe connected.",
  denied: "GroupMe connection was cancelled.",
  invalid: "GroupMe rejected that connection. Try again.",
  nokey: "The server is missing its encryption key, so the connection wasn't saved.",
  error: "Something went wrong connecting to GroupMe.",
};

/**
 * useSearchParams() forces this subtree to render on the client, which Next
 * requires us to declare with a Suspense boundary. The default export below
 * supplies it.
 */
function ChatPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { orders } = useData();
  const { user, role, roles } = useAuth();
  const allowed = canUseInstallerChat(roles);

  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [groups, setGroups] = useState<GroupOption[] | null>(null);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Pasting an access token -- the way round GroupMe's broken OAuth sign-in.
  const [tokenInput, setTokenInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // Which installers have something THIS user hasn't seen. Personal to the
  // signed-in account, not shared across everyone using the office GroupMe.
  const [unread, setUnread] = useState<Record<string, boolean>>({});
  const [otherError, setOtherError] = useState<string | null>(null);

  // Admin only -- same redirect pattern as the legacy-links screen.
  useEffect(() => {
    if (role && !allowed) router.replace("/settings");
  }, [role, allowed, router]);

  // Surface the result of the GroupMe redirect, then drop it from the URL so
  // a refresh doesn't replay the banner.
  useEffect(() => {
    const status = searchParams.get("connect");
    if (!status) return;
    setNotice(CONNECT_MESSAGES[status] ?? null);
    router.replace("/chat");
  }, [searchParams, router]);

  const loadConnection = useCallback(async () => {
    const res = await fetch("/api/groupme/connection");
    if (!res.ok) {
      setConnection({ configured: false, connected: false, groupmeName: null });
      return;
    }
    setConnection(await res.json());
  }, []);

  const loadUnread = useCallback(async () => {
    try {
      const res = await fetch("/api/groupme/unread");
      if (!res.ok) return;
      const body = await res.json();
      setUnread(body.byInstaller || {});
    } catch {
      // Leave the last known state rather than clearing the markers.
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    loadConnection();
    fetchInstallerChats().then(setMappings);
  }, [allowed, loadConnection]);

  // Refresh the markers whenever the list is on screen -- including coming back
  // from a conversation, which should have just cleared one.
  useEffect(() => {
    if (!allowed || selected || linking) return;
    loadUnread();
  }, [allowed, selected, linking, loadUnread]);

  // Every installer the calendar knows about, including extra crews the
  // scheduling app adds. Same source the filter dropdown uses.
  const installerNames = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      if (o.installer?.trim()) {
        set.add(o.installer);
        for (const name of crewsForDate(o)) if (name) set.add(name);
      }
    }
    return Array.from(set).sort();
  }, [orders]);

  const mappedByName = useMemo(
    () => new Map(mappings.map((m) => [m.installerName, m])),
    [mappings]
  );

  const installerChats = useMemo(
    () =>
      mappings
        .filter((m) => m.isInstaller)
        .sort((a, b) => a.installerName.localeCompare(b.installerName)),
    [mappings]
  );

  const otherChats = useMemo(
    () =>
      mappings
        .filter((m) => !m.isInstaller)
        .sort((a, b) => a.installerName.localeCompare(b.installerName)),
    [mappings]
  );

  async function openLinking() {
    setLinking(true);
    if (groups) return;
    setGroupsError(null);
    try {
      const res = await fetch("/api/groupme/groups");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not load your groups.");
      setGroups(body.groups || []);
    } catch (e) {
      setGroupsError((e as Error).message);
    }
  }

  async function link(installerName: string, groupId: string) {
    setSavingName(installerName);
    if (!groupId) {
      if (await deleteInstallerChat(installerName)) {
        setMappings((prev) =>
          prev.filter((m) => m.installerName !== installerName)
        );
      }
    } else {
      const groupName = groups?.find((g) => g.id === groupId)?.name ?? null;
      if (
        await upsertInstallerChat(
          installerName,
          groupId,
          groupName,
          user?.email ?? undefined,
          true
        )
      ) {
        setMappings((prev) => [
          ...prev.filter((m) => m.installerName !== installerName),
          { installerName, groupId, groupName, isInstaller: true },
        ]);
      }
    }
    setSavingName(null);
  }

  /**
   * Add a conversation that isn't about one installer -- an office group, a
   * vendor, whatever. The group's own GroupMe name becomes its label, which is
   * also its key, so a clash with an existing entry has to be refused rather
   * than silently overwriting it.
   */
  async function addOtherChat(groupId: string) {
    if (!groupId) return;
    const group = groups?.find((g) => g.id === groupId);
    if (!group) return;

    setOtherError(null);
    if (mappedByName.has(group.name)) {
      setOtherError(`"${group.name}" is already in the list.`);
      return;
    }

    setSavingName(group.name);
    const ok = await upsertInstallerChat(
      group.name,
      group.id,
      group.name,
      user?.email ?? undefined,
      false
    );
    if (ok) {
      setMappings((prev) => [
        ...prev,
        {
          installerName: group.name,
          groupId: group.id,
          groupName: group.name,
          isInstaller: false,
        },
      ]);
    } else {
      setOtherError("Could not add that chat.");
    }
    setSavingName(null);
  }

  async function removeOtherChat(label: string) {
    setSavingName(label);
    if (await deleteInstallerChat(label)) {
      setMappings((prev) => prev.filter((m) => m.installerName !== label));
    }
    setSavingName(null);
  }

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
      setNotice(`GroupMe connected as ${body.groupmeName || "that account"}.`);
      await loadConnection();
    } catch (e) {
      setConnectError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    await fetch("/api/groupme/connection", { method: "DELETE" });
    setGroups(null);
    setNotice(
      "Disconnected here. Note this doesn't revoke access at GroupMe — do that in your GroupMe account if you need to."
    );
    loadConnection();
  }

  /** One block of conversations, with an optional heading above it. */
  function renderChatSection(chats: Mapping[], heading: string | null) {
    if (chats.length === 0) return null;
    return (
      <>
        {heading && (
          <h2 className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">
            {heading}
          </h2>
        )}
        <ul className="divide-y divide-border">
          {chats.map((m) => (
            <li key={m.installerName}>
              <button
                onClick={() => setSelected(m.installerName)}
                className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-surface transition-colors"
              >
                <div className="min-w-0 flex items-center gap-2.5">
                  {unread[m.installerName] && (
                    <span
                      aria-label="New messages"
                      className="w-2 h-2 rounded-full bg-red-600 shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <div
                      className={`text-sm truncate ${
                        unread[m.installerName] ? "font-semibold" : "font-medium"
                      }`}
                    >
                      {m.installerName}
                    </div>
                    {/* Redundant for an "other" chat, where the label already
                        IS the group name. */}
                    {m.groupName && m.groupName !== m.installerName && (
                      <div className="text-xs text-muted truncate">
                        {m.groupName}
                      </div>
                    )}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      </>
    );
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
            installerName={selected}
            onBack={() => setSelected(null)}
          />
        </div>
        <BottomNav />
      </div>
    );
  }

  // --- Linking screen ---
  if (linking) {
    return (
      <div className="flex flex-col h-full">
        <header className="bg-background border-b border-border px-4 py-3 shrink-0">
          <button
            onClick={() => setLinking(false)}
            className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors mb-1"
          >
            <ChevronLeft className="w-4 h-4" />
            Chat
          </button>
          <div className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-primary" />
            <h1 className="text-lg font-semibold">Link GroupMe groups</h1>
          </div>
          <p className="text-xs text-muted mt-1">
            Pick the group each installer already uses. Only linked installers
            show up in Chat.
          </p>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          {groupsError && (
            <p className="text-sm text-red-600 py-2">{groupsError}</p>
          )}
          {!groups && !groupsError && (
            <div className="flex items-center gap-2 text-muted text-sm py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading your GroupMe groups…
            </div>
          )}
          {groups && (
            <ul className="divide-y divide-border">
              {installerNames.map((name) => {
                const current = mappedByName.get(name);
                return (
                  <li
                    key={name}
                    className="py-2.5 flex items-center justify-between gap-3"
                  >
                    <span className="text-sm truncate">{name}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      {savingName === name && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-muted" />
                      )}
                      <select
                        value={current?.groupId ?? ""}
                        onChange={(e) => link(name, e.target.value)}
                        className="bg-surface border border-border rounded-lg px-2 py-1.5 text-xs max-w-[55vw]"
                      >
                        <option value="">Not linked</option>
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </li>
                );
              })}
              {installerNames.length === 0 && (
                <li className="py-4 text-sm text-muted">
                  No installers found on the calendar yet.
                </li>
              )}
            </ul>
          )}

          {/* Conversations that aren't about one installer. Added by picking a
              group outright rather than pairing it with a calendar name. */}
          {groups && (
            <div className="mt-6 pt-4 border-t border-border">
              <h2 className="text-sm font-semibold mb-1">Other chats</h2>
              <p className="text-xs text-muted mb-3">
                Any other GroupMe group you want in the Chat tab — office,
                scheduling, vendors. These aren&apos;t tied to an installer.
              </p>

              {otherChats.length > 0 && (
                <ul className="divide-y divide-border mb-3">
                  {otherChats.map((c) => (
                    <li
                      key={c.installerName}
                      className="py-2.5 flex items-center justify-between gap-3"
                    >
                      <span className="text-sm truncate">{c.installerName}</span>
                      <button
                        onClick={() => removeOtherChat(c.installerName)}
                        disabled={savingName === c.installerName}
                        className="text-xs text-muted hover:text-red-600 shrink-0 disabled:opacity-50"
                      >
                        {savingName === c.installerName ? "Removing…" : "Remove"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <select
                value=""
                onChange={(e) => addOtherChat(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-2 py-2 text-sm"
              >
                <option value="">Add a chat…</option>
                {groups
                  .filter((g) => !mappings.some((m) => m.groupId === g.id))
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
              </select>

              {otherError && (
                <p className="text-xs text-red-600 mt-2">{otherError}</p>
              )}
            </div>
          )}
        </div>
        <div className="px-4 py-2 border-t border-border shrink-0">
          <GroupMeAttribution />
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
              onClick={openLinking}
              className="text-xs text-primary inline-flex items-center gap-1"
            >
              <Link2 className="w-3.5 h-3.5" />
              Link groups
            </button>
          )}
        </div>
        {connection?.connected && connection.groupmeName && (
          <p className="text-xs text-muted mt-1">
            Connected to GroupMe as {connection.groupmeName}
          </p>
        )}
      </header>

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
              Connect the office GroupMe account to read and reply to installer
              groups here.
            </p>
            <p className="text-xs text-muted mb-5">
              Sign in as the office account — not your personal GroupMe. Everyone
              in the app shares this one connection, and only groups linked to an
              installer are ever shown.
            </p>
            {/* Pasting the token is the PRIMARY path, not a fallback:
                GroupMe's OAuth sign-in loops on its own broken http redirect.
                See the POST handler in /api/groupme/connection. */}
            <div className="max-w-sm mx-auto text-left">
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
                Sign in to dev.groupme.com as the account you want the app to
                use, then copy its Access Token.
              </p>

              {connectError && (
                <p className="text-xs text-red-600 mb-3">{connectError}</p>
              )}

              <button
                onClick={connectWithToken}
                disabled={!tokenInput.trim() || connecting}
                className="w-full inline-flex items-center justify-center gap-2 bg-primary text-white rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-40"
              >
                {connecting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <MessageCircle className="w-4 h-4" />
                )}
                Connect GroupMe
              </button>

              <a
                href="/api/groupme/connect"
                className="block text-center text-[11px] text-muted mt-3 hover:text-foreground"
              >
                Or try signing in through GroupMe instead
              </a>
            </div>
          </div>
        ) : mappings.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-muted">
            <p className="mb-4">No chats linked to a GroupMe group yet.</p>
            <button
              onClick={openLinking}
              className="inline-flex items-center gap-2 bg-primary text-white rounded-xl px-4 py-2.5 text-sm font-medium"
            >
              <Link2 className="w-4 h-4" />
              Link groups
            </button>
          </div>
        ) : (
          <>
            {/* Headings only once both kinds exist -- a list of nothing but
                installers shouldn't be forced under a redundant label. */}
            {renderChatSection(
              installerChats,
              otherChats.length > 0 ? "Installers" : null
            )}
            {renderChatSection(
              otherChats,
              installerChats.length > 0 ? "Other chats" : null
            )}
          </>
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
