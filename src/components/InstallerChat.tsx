"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bot, ChevronLeft, Loader2, RefreshCw, Send } from "lucide-react";
import { format, isSameYear, isToday, isYesterday } from "date-fns";
import GroupMeAttribution from "@/components/GroupMeAttribution";
import ChatBotPanel from "@/components/ChatBotPanel";
import PhotoViewer from "@/components/PhotoViewer";
import { readMessages, writeMessages, type CachedMessage } from "@/lib/chat-cache";

/**
 * One GroupMe conversation (a group the person chose), read and written live.
 *
 * Nothing is cached in our database -- every message on screen came from
 * GroupMe just now, and anything sent goes straight into the installer's real
 * group. GroupMe stays the source of truth; this is only a nicer window onto
 * it, and the installer carries on using GroupMe exactly as before.
 *
 * Replies arrive by polling, because the app runs on serverless hosting that
 * cannot hold a live connection open. Polling only runs while this view is on
 * screen and the tab is visible, so an idle phone in a pocket costs nothing.
 */

const POLL_MS = 5000;

interface ChatMessage {
  id: string;
  text: string;
  name: string;
  createdAt: string;
  isMine: boolean;
  isSystem: boolean;
  avatarUrl: string | null;
  images: string[];
}

interface Member {
  userId: string;
  nickname: string;
}

/**
 * Find an in-progress "@..." immediately before the cursor.
 *
 * The "@" only counts at the start of the box or after a space, so an email
 * address never opens the picker. Nicknames can contain spaces ("Greg Lyons"),
 * so the query may too -- it just stops at a newline, and is capped so a whole
 * paragraph doesn't get treated as a name being typed.
 */
function findMentionQuery(
  text: string,
  cursor: number
): { start: number; query: string } | null {
  const upToCursor = text.slice(0, cursor);
  const at = upToCursor.lastIndexOf("@");
  if (at === -1) return null;

  const before = at === 0 ? "" : upToCursor[at - 1];
  if (before && !/\s/.test(before)) return null;

  const query = upToCursor.slice(at + 1);
  if (query.includes("\n") || query.length > 25) return null;

  return { start: at, query };
}

/** Just the clock time -- the day is carried by the separator above the run. */
function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "Today" / "Yesterday" / "Mon, 29 Sep" for the separators between days. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, isSameYear(d, new Date()) ? "EEE, d MMM" : "d MMM yyyy");
}

/** Up to two initials, for when someone has no avatar set. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * GroupMe photo links carry the photo's size ("i.groupme.com/1024x768.jpeg.…").
 * Reading it lets the bubble reserve the right space BEFORE the photo arrives,
 * so messages don't jump around as photos load. Unknown size: a square.
 */
function photoAspect(url: string): string {
  const m = url.match(/\/(\d{2,5})x(\d{2,5})\./);
  if (!m) return "1 / 1";
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? `${w} / ${h}` : "1 / 1";
}

/**
 * A run of consecutive messages from one person, close together in time.
 *
 * Real messaging apps don't repeat the sender's name and picture on every line;
 * they show it once and let the rest stack underneath. Same here: a name and
 * avatar open each run, and only the final bubble carries a timestamp. Five
 * minutes is the usual break point -- long enough that rapid back-and-forth
 * stays as one block, short enough that a reply an hour later reads as new.
 */
const RUN_GAP_MS = 5 * 60 * 1000;

type Block =
  | { kind: "day"; key: string; label: string }
  | {
      kind: "run";
      key: string;
      sender: string;
      avatarUrl: string | null;
      isMine: boolean;
      messages: ChatMessage[];
    }
  | { kind: "system"; key: string; message: ChatMessage }
  | { kind: "new"; key: string; label: string };

/** GroupMe message ids are increasing numbers: is `a` newer than `b`? */
function isNewer(a: string, b: string): boolean {
  try {
    return BigInt(a) > BigInt(b);
  } catch {
    return a > b;
  }
}

/** Web links in a message. */
const URL_RE = /(https?:\/\/[^\s]+)/g;

/** Message text with web links made tappable (and allowed to wrap). */
function MessageText({ text, mine }: { text: string; mine: boolean }) {
  if (!text) return null;
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className={`underline break-all ${mine ? "text-white" : "text-primary"}`}
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function buildBlocks(
  messages: ChatMessage[],
  firstUnreadId: string | null,
  newLabel: string
): Block[] {
  const blocks: Block[] = [];
  let lastDay = "";

  for (const m of messages) {
    const day = new Date(m.createdAt).toDateString();
    if (day !== lastDay) {
      blocks.push({ kind: "day", key: `day-${m.id}`, label: dayLabel(m.createdAt) });
      lastDay = day;
    }

    // The "New messages" line, right above the first one you haven't read.
    if (m.id === firstUnreadId) {
      blocks.push({ kind: "new", key: `new-${m.id}`, label: newLabel });
    }

    if (m.isSystem) {
      blocks.push({ kind: "system", key: m.id, message: m });
      continue;
    }

    const prev = blocks[blocks.length - 1];
    const canJoin =
      m.id !== firstUnreadId &&
      prev?.kind === "run" &&
      prev.sender === m.name &&
      prev.isMine === m.isMine &&
      new Date(m.createdAt).getTime() -
        new Date(prev.messages[prev.messages.length - 1].createdAt).getTime() <
        RUN_GAP_MS;

    if (canJoin && prev.kind === "run") {
      prev.messages.push(m);
    } else {
      blocks.push({
        kind: "run",
        key: m.id,
        sender: m.name,
        avatarUrl: m.avatarUrl,
        isMine: m.isMine,
        messages: [m],
      });
    }
  }

  return blocks;
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  if (url) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        className="w-7 h-7 rounded-full object-cover shrink-0 mt-auto"
      />
    );
  }
  return (
    <span className="w-7 h-7 rounded-full bg-surface border border-border shrink-0 mt-auto flex items-center justify-center text-[10px] font-semibold text-muted">
      {initials(name)}
    </span>
  );
}

export default function InstallerChat({
  groupId,
  title: installerName,
  userId,
  installerNames = [],
  onBotChanged,
  imageUrl,
  lastReadId,
  onBack,
}: {
  /** The signed-in Duck Force user, for the in-memory message cache. */
  userId?: string | null;
  /** Calendar installers, for the bot's "which installer is this chat for?". */
  installerNames?: string[];
  /** Called after the bot is added/removed or its installer changes. */
  onBotChanged?: () => void;
  /** The group's GroupMe picture, for the header. */
  imageUrl?: string | null;
  /** The last message you'd read before opening, when the chat was unread:
   *  messages after it get the "New messages" line and a highlight. */
  lastReadId?: string | null;
  /** The GroupMe group to show -- one the person ticked under Choose chats. */
  groupId: string;
  /** Shown in the header and the composer placeholder (the group's name). */
  title: string;
  onBack: () => void;
}) {
  // A chat opened before (or pre-loaded from the list) draws at once from
  // memory; only what's new is fetched. See src/lib/chat-cache.ts.
  const [messages, setMessages] = useState<ChatMessage[]>(
    () => (readMessages(userId, groupId) as unknown as ChatMessage[] | null) ?? []
  );
  const [loading, setLoading] = useState(() => !readMessages(userId, groupId));
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showBot, setShowBot] = useState(false);
  // A photo opened full screen inside the app (instead of a browser tab).
  const [viewing, setViewing] = useState<string | null>(null);

  // --- @-mentions ---
  const [members, setMembers] = useState<Member[]>([]);
  // Everyone picked from the @ list so far. Kept even if the text is edited --
  // the server drops any whose "@name" no longer appears, so a deleted mention
  // can never notify the wrong person.
  const [picked, setPicked] = useState<Member[]>([]);
  const [mentionQuery, setMentionQuery] = useState<{
    start: number;
    query: string;
  } | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Only auto-scroll when the reader is already at the bottom, so a new
  // message never yanks them away from something they're reading further up.
  const pinnedToBottom = useRef(true);

  const newestId = messages.length ? messages[messages.length - 1].id : null;

  // Where "New messages" starts. Fixed when the chat opens (opening it marks
  // it read, which mustn't make the line vanish while you're reading).
  const [readUpTo] = useState(() => lastReadId ?? null);
  const firstUnreadId = readUpTo
    ? messages.find((m) => !m.isMine && !m.isSystem && isNewer(m.id, readUpTo))?.id ?? null
    : null;
  const unreadIds = new Set(
    firstUnreadId
      ? messages
          .filter((m) => !m.isMine && !m.isSystem && !isNewer(firstUnreadId, m.id))
          .map((m) => m.id)
      : []
  );
  const newLabel = `${unreadIds.size} new message${unreadIds.size === 1 ? "" : "s"}`;
  const newLineRef = useRef<HTMLDivElement>(null);
  const jumpedToNew = useRef(false);
  const oldestId = messages.length ? messages[0].id : null;

  const load = useCallback(
    async (opts: { sinceId?: string | null } = {}) => {
      const params = new URLSearchParams({ group: groupId });
      if (opts.sinceId) params.set("since_id", opts.sinceId);

      const res = await fetch(`/api/groupme/messages?${params}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not load messages.");
      return (body.messages || []) as ChatMessage[];
    },
    [groupId]
  );

  // First load. From memory when we have it -- then just catch up on what's
  // new -- otherwise the latest 50 from GroupMe.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    const cached = readMessages(userId, groupId) as unknown as ChatMessage[] | null;

    if (cached && cached.length > 0) {
      setMessages(cached);
      setLoading(false);
      load({ sinceId: cached[cached.length - 1].id })
        .then((fresh) => {
          if (cancelled || fresh.length === 0) return;
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const added = fresh.filter((m) => !seen.has(m.id));
            return added.length ? [...prev, ...added] : prev;
          });
        })
        .catch(() => {
          // The remembered history is still valid; polling will catch up.
        });
    } else {
      setLoading(true);
      setMessages([]);
      setHasMore(true);
      load()
        .then((msgs) => {
          if (cancelled) return;
          setMessages(msgs);
          setHasMore(msgs.length >= 50);
        })
        .catch((e: Error) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setLoading(false));
    }

    return () => {
      cancelled = true;
    };
  }, [load, userId, groupId]);

  // Remember what's on screen, so coming back to this chat is instant.
  useEffect(() => {
    if (messages.length > 0) {
      writeMessages(userId, groupId, messages as unknown as CachedMessage[]);
    }
  }, [messages, userId, groupId]);

  // Who's in this group, for the @ picker. A failure here is not worth
  // surfacing -- it only means mentions aren't offered, and plain messages
  // still send fine.
  useEffect(() => {
    let cancelled = false;
    setMembers([]);
    setPicked([]);

    fetch(`/api/groupme/members?group=${encodeURIComponent(groupId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body?.members) setMembers(body.members as Member[]);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [groupId]);

  // Poll for replies while this view is open and the tab is visible.
  useEffect(() => {
    if (loading || error || !newestId) return;

    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const fresh = await load({ sinceId: newestId });
        if (fresh.length === 0) return;
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const added = fresh.filter((m) => !seen.has(m.id));
          return added.length ? [...prev, ...added] : prev;
        });
      } catch {
        // A single failed poll is not worth showing an error for -- the next
        // one usually succeeds, and the visible history is still valid.
      }
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [load, loading, error, newestId]);

  // Mark this conversation read as far as the newest message on screen.
  //
  // Runs on open and again every time something new arrives while the reader is
  // here, so a chat you are actively watching never accumulates a phantom
  // unread badge. Only an id is sent -- never any message content.
  useEffect(() => {
    if (!newestId) return;

    fetch("/api/groupme/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group: groupId, messageId: newestId }),
    }).catch(() => {
      // Worst case the badge lingers until the next time they open it.
    });
  }, [groupId, newestId]);

  // Keep the newest message in view when the reader is already at the bottom.
  //
  // Scrolls ONLY the message box. (scrollIntoView, used before, also scrolled
  // the page around it, which made the whole screen jump on phones.) A layout
  // effect, so it lands before the screen is drawn -- no flash of the top of
  // the conversation on open.
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  useLayoutEffect(() => {
    // First time there's a "New messages" line: open the chat right there,
    // so you start reading from the first one you missed.
    if (!jumpedToNew.current && !loading && newLineRef.current && scrollRef.current) {
      jumpedToNew.current = true;
      const el = scrollRef.current;
      el.scrollTop = Math.max(0, newLineRef.current.offsetTop - 12);
      pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      return;
    }
    if (pinnedToBottom.current) scrollToBottom();
  }, [messages, loading, scrollToBottom]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    pinnedToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function loadOlder() {
    if (!oldestId || loadingOlder) return;
    setLoadingOlder(true);
    const el = scrollRef.current;
    const heightBefore = el?.scrollHeight ?? 0;

    try {
      const params = new URLSearchParams({
        group: groupId,
        before_id: oldestId,
      });
      const res = await fetch(`/api/groupme/messages?${params}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not load older messages.");

      const older = (body.messages || []) as ChatMessage[];
      if (older.length === 0) {
        setHasMore(false);
      } else {
        pinnedToBottom.current = false;
        setMessages((prev) => [...older, ...prev]);
        // Hold the reader's place: new content was added above them.
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight - heightBefore;
        });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingOlder(false);
    }
  }

  /** Update the draft and work out whether an @ list should be showing. */
  function handleDraftChange(value: string, cursor: number) {
    setDraft(value);
    setMentionQuery(members.length > 0 ? findMentionQuery(value, cursor) : null);
  }

  /** Replace the half-typed "@gre" with the full "@Greg Lyons ". */
  function insertMention(member: Member) {
    if (!mentionQuery) return;
    const input = inputRef.current;
    const cursor = input?.selectionStart ?? draft.length;

    const before = draft.slice(0, mentionQuery.start);
    const after = draft.slice(cursor);
    const inserted = `@${member.nickname} `;
    const next = `${before}${inserted}${after}`;

    setDraft(next);
    setMentionQuery(null);
    setPicked((prev) =>
      prev.some((p) => p.userId === member.userId) ? prev : [...prev, member]
    );

    // Put the caret after the name just inserted, not at the end of the box.
    const caret = before.length + inserted.length;
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(caret, caret);
    });
  }

  // Only the people whose "@name" actually survives in the text still count.
  const activeMentions = picked.filter((p) => draft.includes(`@${p.nickname}`));

  const suggestions = mentionQuery
    ? members
        .filter((m) =>
          m.nickname.toLowerCase().startsWith(mentionQuery.query.toLowerCase())
        )
        .slice(0, 6)
    : [];

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    setError(null);
    setMentionQuery(null);
    try {
      const res = await fetch("/api/groupme/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group: groupId,
          text,
          mentions: activeMentions,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not send the message.");

      setDraft("");
      setPicked([]);
      pinnedToBottom.current = true;
      // Pull it back from GroupMe rather than faking it locally, so what's on
      // screen is always what actually landed in the group.
      const fresh = await load({ sinceId: newestId });
      if (fresh.length) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...fresh.filter((m) => !seen.has(m.id))];
        });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {viewing && <PhotoViewer url={viewing} onClose={() => setViewing(null)} />}
      {/* Back arrow, avatar, name -- the layout anyone recognises from a phone
          messaging app, built from our own styles rather than GroupMe's. */}
      <header className="bg-background border-b border-border px-2 py-2 flex items-center gap-2 shrink-0">
        <button
          onClick={onBack}
          aria-label="Back to chats"
          className="w-9 h-9 rounded-full flex items-center justify-center text-muted hover:text-foreground hover:bg-surface transition-colors shrink-0"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <Avatar name={installerName} url={imageUrl ? `${imageUrl}.avatar` : null} />
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold truncate leading-tight">
            {installerName}
          </h1>
          <GroupMeAttribution compact className="leading-tight" />
        </div>
        <button
          onClick={() => setShowBot((v) => !v)}
          aria-expanded={showBot}
          aria-label="Duck Force bot"
          title="Duck Force bot"
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors shrink-0 ${
            showBot ? "text-primary bg-surface" : "text-muted hover:text-foreground hover:bg-surface"
          }`}
        >
          <Bot className="w-5 h-5" />
        </button>
      </header>

      {showBot && (
        <ChatBotPanel
          groupId={groupId}
          title={installerName}
          installerNames={installerNames}
          onChanged={onBotChanged}
        />
      )}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-3 space-y-2"
      >
        {loading ? (
          <div className="h-full flex items-center justify-center text-muted text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading conversation…
          </div>
        ) : (
          <>
            {hasMore && messages.length > 0 && (
              <button
                onClick={loadOlder}
                disabled={loadingOlder}
                className="w-full text-xs text-muted hover:text-foreground py-2 inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {loadingOlder ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                Load older messages
              </button>
            )}

            {messages.length === 0 && !error && (
              <div className="h-full flex items-center justify-center text-muted text-sm text-center px-6">
                No messages in this group yet.
              </div>
            )}

            {buildBlocks(messages, firstUnreadId, newLabel).map((block) => {
              if (block.kind === "new") {
                return (
                  <div
                    key={block.key}
                    ref={newLineRef}
                    className="flex items-center gap-2 py-2"
                    role="separator"
                  >
                    <div className="flex-1 h-px bg-rba-green/50" />
                    <span className="text-[11px] font-semibold text-rba-green bg-rba-green/10 border border-rba-green/40 rounded-full px-2.5 py-0.5">
                      {block.label}
                    </span>
                    <div className="flex-1 h-px bg-rba-green/50" />
                  </div>
                );
              }
              if (block.kind === "day") {
                return (
                  <div key={block.key} className="flex justify-center py-2">
                    <span className="text-[11px] text-muted bg-surface border border-border rounded-full px-2.5 py-0.5">
                      {block.label}
                    </span>
                  </div>
                );
              }

              if (block.kind === "system") {
                return (
                  <div
                    key={block.key}
                    className="text-center text-[11px] text-muted py-1 px-6"
                  >
                    {block.message.text}
                  </div>
                );
              }

              const last = block.messages[block.messages.length - 1];
              return (
                <div
                  key={block.key}
                  className={`flex gap-2 ${
                    block.isMine ? "flex-row-reverse" : "flex-row"
                  }`}
                >
                  {/* Avatar only on incoming runs: on your own messages the
                      right-hand side already says who sent it. */}
                  {!block.isMine && (
                    <Avatar name={block.sender} url={block.avatarUrl} />
                  )}

                  <div
                    className={`flex flex-col gap-0.5 min-w-0 max-w-[78%] ${
                      block.isMine ? "items-end" : "items-start"
                    }`}
                  >
                    {!block.isMine && (
                      <span className="text-[11px] text-muted px-1">
                        {block.sender}
                      </span>
                    )}

                    {block.messages.map((m, i) => {
                      const first = i === 0;
                      const final = i === block.messages.length - 1;
                      // Square off the inner corner on the side the run sits,
                      // so stacked bubbles read as one block rather than a pile.
                      const corners = block.isMine
                        ? `${first ? "rounded-tr-2xl" : "rounded-tr-md"} ${
                            final ? "rounded-br-2xl" : "rounded-br-md"
                          }`
                        : `${first ? "rounded-tl-2xl" : "rounded-tl-md"} ${
                            final ? "rounded-bl-2xl" : "rounded-bl-md"
                          }`;

                      return (
                        <div
                          key={m.id}
                          className={`max-w-full rounded-2xl ${corners} px-3 py-1.5 text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${
                            block.isMine
                              ? "bg-primary text-white"
                              : unreadIds.has(m.id)
                                ? "bg-rba-green/10 border border-rba-green/40"
                                : "bg-surface border border-border"
                          }`}
                        >
                          <MessageText text={m.text} mine={block.isMine} />
                          {m.images.map((url) => (
                            <button
                              key={url}
                              type="button"
                              onClick={() => setViewing(url)}
                              aria-label="Open photo"
                              className="block mt-1.5"
                            >
                              {/* Space reserved from the size in the link, so
                                  the chat doesn't jump as photos arrive. */}
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={url}
                                alt="Shared photo"
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                decoding="async"
                                style={{ aspectRatio: photoAspect(url) }}
                                onLoad={() => {
                                  if (pinnedToBottom.current) scrollToBottom();
                                }}
                                className="rounded-xl w-60 max-w-full h-auto max-h-72 object-cover bg-background"
                              />
                            </button>
                          ))}
                        </div>
                      );
                    })}

                    {/* One timestamp per run, not per bubble. */}
                    <span className="text-[10px] text-muted px-1">
                      {timeLabel(last.createdAt)}
                    </span>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {error && (
        <div className="px-4 py-2 text-xs text-red-600 bg-red-500/10 border-t border-red-500/20 shrink-0">
          {error}
        </div>
      )}

      <div className="border-t border-border p-2 flex items-end gap-2 shrink-0 relative">
        {suggestions.length > 0 && (
          <ul className="absolute bottom-full left-2 right-2 mb-1 bg-background border border-border rounded-xl overflow-hidden shadow-lg max-h-56 overflow-y-auto">
            {suggestions.map((m) => (
              <li key={m.userId}>
                <button
                  type="button"
                  // onMouseDown, not onClick: the textarea would blur first and
                  // the caret position used for the insert would be lost.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertMention(m);
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-surface transition-colors"
                >
                  {m.nickname}
                </button>
              </li>
            ))}
          </ul>
        )}

        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) =>
            handleDraftChange(e.target.value, e.target.selectionStart ?? 0)
          }
          onKeyUp={(e) => {
            // Arrow keys and clicks move the caret without changing the text,
            // which can take it out of (or back into) an "@..." being typed.
            const el = e.currentTarget;
            handleDraftChange(el.value, el.selectionStart ?? 0);
          }}
          onBlur={() => setMentionQuery(null)}
          onKeyDown={(e) => {
            // While the @ list is open, Enter picks the top name instead of
            // sending a half-typed mention.
            if (e.key === "Enter" && !e.shiftKey && suggestions.length > 0) {
              e.preventDefault();
              insertMention(suggestions[0]);
              return;
            }
            if (e.key === "Escape" && mentionQuery) {
              e.preventDefault();
              setMentionQuery(null);
              return;
            }
            // Enter sends; Shift+Enter makes a new line.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          maxLength={1000}
          placeholder={`Message ${installerName}…`}
          // Grows with the text up to a few lines, then scrolls -- a fixed
          // one-line box makes anything longer than a sentence unreadable
          // while you type it on a phone.
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
          }}
          className="flex-1 resize-none bg-surface border border-border rounded-2xl px-3.5 py-2 text-sm max-h-32 focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          onClick={send}
          disabled={!draft.trim() || sending}
          aria-label="Send"
          className="shrink-0 w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center disabled:opacity-40 transition-opacity"
        >
          {sending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>

    </div>
  );
}
