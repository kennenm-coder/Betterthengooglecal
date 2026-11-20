"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, Loader2 } from "lucide-react";

/**
 * The Duck Force bot for one chat (migration 072), shown under a conversation's
 * header. Added ONCE per GroupMe group by anyone in it, and it works for
 * everyone who ticked the chat:
 *   - instant buzzes and exact unread counts
 *   - "which installer is this chat for?", so that installer's job cards get a
 *     Messages button that opens this chat
 */

interface BotInfo {
  installerName: string | null;
  addedByEmail: string | null;
  mine: boolean;
}

/** Best guess at the installer from the chat's name ("Mike's crew" -> Mike Smith). */
function guessInstaller(title: string, names: string[]): string {
  const t = title.toLowerCase();
  let best = "";
  let bestLen = 0;
  for (const n of names) {
    const full = n.toLowerCase().trim();
    if (!full) continue;
    const first = full.split(/\s+/)[0];
    const len = t.includes(full) ? full.length + 100 : first.length >= 3 && t.includes(first) ? first.length : 0;
    if (len > bestLen) {
      best = n;
      bestLen = len;
    }
  }
  return best;
}

export default function ChatBotPanel({
  groupId,
  title,
  installerNames,
  onChanged,
}: {
  groupId: string;
  title: string;
  installerNames: string[];
  /** Called after the bot or its installer link changes. */
  onChanged?: () => void;
}) {
  const [bot, setBot] = useState<BotInfo | null | undefined>(undefined);
  const [installer, setInstaller] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const guess = useMemo(() => guessInstaller(title, installerNames), [title, installerNames]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/groupme/bots?group=${encodeURIComponent(groupId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled) return;
        const b = (body?.bot ?? null) as BotInfo | null;
        setBot(b);
        setInstaller(b ? b.installerName ?? "" : guess);
      })
      .catch(() => !cancelled && setBot(null));
    return () => {
      cancelled = true;
    };
  }, [groupId, guess]);

  async function save(nextInstaller: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/groupme/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group: groupId, installerName: nextInstaller || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't save.");
      setBot((prev) =>
        prev
          ? { ...prev, installerName: nextInstaller || null }
          : { installerName: nextInstaller || null, addedByEmail: null, mine: true }
      );
      setMessage({
        ok: true,
        text: body.added
          ? "Bot added. Everyone who chose this chat now gets instant buzzes."
          : "Saved.",
      });
      onChanged?.();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/groupme/bots", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group: groupId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't remove it.");
      setBot(null);
      setInstaller(guess);
      setMessage({ ok: true, text: "Bot removed. This chat is back to the once-a-minute check." });
      onChanged?.();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const select = (
    <select
      value={installer}
      onChange={(e) => {
        setInstaller(e.target.value);
        if (bot) save(e.target.value);
      }}
      disabled={busy}
      className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-sm"
    >
      <option value="">Not an installer chat</option>
      {/* Keep a saved name visible even if it's not on the calendar right now. */}
      {installer && !installerNames.includes(installer) && <option value={installer}>{installer}</option>}
      {installerNames.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );

  return (
    <div className="border-b border-border bg-surface px-4 py-3 space-y-2 shrink-0">
      <div className="flex items-center gap-2">
        <Bot className="w-4 h-4 text-primary" />
        <p className="text-sm font-medium">Duck Force bot</p>
      </div>

      {bot === undefined ? (
        <div className="flex items-center gap-2 text-xs text-muted">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking…
        </div>
      ) : bot ? (
        <>
          <p className="text-xs text-muted">
            In this chat{bot.addedByEmail ? ` (added by ${bot.mine ? "you" : bot.addedByEmail})` : ""}. Everyone who
            chose it gets instant buzzes and unread counts.
          </p>
          <label className="block text-xs font-medium">This chat is for</label>
          {select}
          <p className="text-[11px] text-muted">
            Linked to an installer, their job cards get a Messages button that opens this chat.
          </p>
          {bot.mine && (
            <button
              onClick={remove}
              disabled={busy}
              className="text-xs text-muted hover:text-red-600 disabled:opacity-50"
            >
              Remove the bot from this chat
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-muted">
            Add the bot once and it works for everyone who chose this chat: instant buzzes (instead of up to a
            minute later), exact unread counts, and a Messages button on the installer&apos;s job cards. Group
            members will see &quot;Duck Force&quot; in the chat.
          </p>
          <label className="block text-xs font-medium">This chat is for</label>
          {select}
          <button
            onClick={() => save(installer)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 bg-primary text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
            Add Duck Force bot
          </button>
        </>
      )}

      {message && (
        <p className={`text-xs ${message.ok ? "text-green-700 dark:text-green-400" : "text-danger"}`}>{message.text}</p>
      )}
    </div>
  );
}
