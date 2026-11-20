"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Building2, Check, ChevronLeft, Loader2, Unlink } from "lucide-react";

/**
 * Office setup -- ADMINS ONLY (migration 074).
 *
 *   1. The office GroupMe account: connect it once (Sign in with GroupMe as
 *      the office account, or paste its token), or disconnect it.
 *   2. Which of its chats each Duck Force ROLE sees. Everyone with the Chat
 *      tab gets the chats shared with their roles as soon as they sign in to
 *      Duck Force -- no GroupMe sign-in. Remove someone's role or account and
 *      the chats go with it.
 *   3. Your own GroupMe (optional, admins only): send as yourself in groups
 *      your own account is in.
 *
 * Saving shares a chat and adds the Duck Force Bot to it through the office
 * account, so everyone's buzzes and unread counts are instant.
 */

interface OfficeInfo {
  connected: boolean;
  name: string | null;
  connectedBy: string | null;
}
interface OfficeGroup {
  id: string;
  name: string;
  roles: string[];
  hasBot: boolean;
}

export default function OfficeSetup({
  onClose,
  personal,
  onChanged,
}: {
  onClose: () => void;
  /** The admin's own GroupMe connection, for the optional section. */
  personal: { connected: boolean; name: string | null; onDisconnect: () => void };
  /** Called after anything is saved, so the Chat list refreshes. */
  onChanged: () => void;
}) {
  const [office, setOffice] = useState<OfficeInfo | null>(null);
  const [groups, setGroups] = useState<OfficeGroup[]>([]);
  const [roleOptions, setRoleOptions] = useState<{ value: string; label: string }[]>([]);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [roles, setRoles] = useState<Record<string, string[]>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [tokenInput, setTokenInput] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/groupme/office");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage({ ok: false, text: body.error || "Couldn't load office setup." });
      return;
    }
    setOffice(body.office);
    setGroups(body.groups || []);
    setGroupsError(body.groupsError || null);
    setRoleOptions(body.roleOptions || []);
    setRoles(Object.fromEntries((body.groups || []).map((g: OfficeGroup) => [g.id, g.roles])));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function toggleRole(groupId: string, role: string) {
    setMessage(null);
    setRoles((prev) => {
      const cur = new Set(prev[groupId] || []);
      if (cur.has(role)) cur.delete(role);
      else cur.add(role);
      return { ...prev, [groupId]: [...cur] };
    });
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/groupme/office", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shared: groups.map((g) => ({ groupId: g.id, roles: roles[g.id] || [] })) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't save.");
      const bits = [`Saved. ${body.saved} chat${body.saved === 1 ? "" : "s"} shared.`];
      if (body.botsAdded) bits.push(`Duck Force Bot added to ${body.botsAdded}.`);
      if (body.botErrors?.length) bits.push(`Bot not added to: ${body.botErrors.join("; ")}`);
      setMessage({ ok: !body.botErrors?.length, text: bits.join(" ") });
      await load();
      onChanged();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function pasteToken() {
    const token = tokenInput.trim();
    if (!token) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/groupme/office", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't connect.");
      setTokenInput("");
      setMessage({ ok: true, text: `Office account connected as ${body.name || "GroupMe"}.` });
      await load();
      onChanged();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function disconnectOffice() {
    setSaving(true);
    await fetch("/api/groupme/office", { method: "DELETE" }).catch(() => null);
    setSaving(false);
    setMessage({ ok: true, text: "Office account disconnected. Shared chats are kept for when it's reconnected." });
    await load();
    onChanged();
  }

  const label = (v: string) => roleOptions.find((r) => r.value === v)?.label || v;

  return (
    <div className="flex flex-col h-full">
      <header className="bg-background border-b border-border px-4 py-3 shrink-0">
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors mb-1"
        >
          <ChevronLeft className="w-4 h-4" />
          Chat
        </button>
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-primary" />
          <h1 className="text-lg font-semibold">Office setup</h1>
        </div>
        <p className="text-xs text-muted mt-1">
          Admins only. Everyone with the Chat tab uses the office GroupMe account for the chats shared with their
          roles. No GroupMe sign-in for them, and their access ends with their role or account.
        </p>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-5">
        {/* 1. The office account */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">1. Office GroupMe account</h2>
          {!office ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : office.connected ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2">
              <p className="text-sm">
                Connected as <strong>{office.name || "GroupMe"}</strong>
                {office.connectedBy ? <span className="text-xs text-muted"> · by {office.connectedBy}</span> : null}
              </p>
              <button
                onClick={disconnectOffice}
                disabled={saving}
                className="text-xs text-muted hover:text-red-600 inline-flex items-center gap-1 shrink-0 disabled:opacity-50"
              >
                <Unlink className="w-3.5 h-3.5" /> Disconnect
              </button>
            </div>
          ) : (
            <div className="space-y-2 rounded-lg border border-border bg-surface px-3 py-3">
              <p className="text-xs text-muted">
                Sign in as the OFFICE account (e.g. RBANWO Office), not your own. If this browser is already signed in
                to a different GroupMe, use a private window.
              </p>
              <a
                href="/api/groupme/connect?as=office"
                className="inline-flex items-center gap-2 bg-primary text-white rounded-lg px-3 py-2 text-sm font-medium"
              >
                <Building2 className="w-4 h-4" /> Sign in with the office GroupMe
              </a>
              <details>
                <summary className="text-[11px] text-muted cursor-pointer">Or paste the office account&apos;s access token</summary>
                <div className="mt-2 flex gap-2">
                  <input
                    type="password"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder="From dev.groupme.com while signed in as the office account"
                    autoComplete="off"
                    spellCheck={false}
                    className="flex-1 min-w-0 bg-background border border-border rounded-lg px-2 py-1.5 text-sm font-mono"
                  />
                  <button
                    onClick={pasteToken}
                    disabled={!tokenInput.trim() || saving}
                    className="border border-border rounded-lg px-3 py-1.5 text-sm disabled:opacity-40"
                  >
                    Connect
                  </button>
                </div>
              </details>
            </div>
          )}
        </section>

        {/* 2. Chats by role */}
        {office?.connected && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">2. Which roles see each chat</h2>
            <p className="text-xs text-muted">
              Tap a chat, tick the roles that should have it, then Save. Admins see every shared chat. People still
              choose which shared chats show in their own list.
            </p>
            {groupsError && <p className="text-sm text-red-600">{groupsError}</p>}
            {groups.length === 0 && !groupsError && (
              <p className="text-sm text-muted">The office account isn&apos;t in any GroupMe chats yet.</p>
            )}
            <ul className="divide-y divide-border rounded-lg border border-border">
              {groups.map((g) => {
                const r = roles[g.id] || [];
                const open = openId === g.id;
                return (
                  <li key={g.id} className="px-3 py-2.5">
                    <button
                      onClick={() => setOpenId(open ? null : g.id)}
                      className="w-full flex items-center justify-between gap-2 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium truncate">{g.name}</span>
                        <span className="block text-xs text-muted truncate">
                          {r.length ? r.map(label).join(", ") : "Not shared"}
                        </span>
                      </span>
                      {g.hasBot && (
                        <span title="Duck Force Bot is in this chat" className="shrink-0 text-rba-green">
                          <Bot className="w-4 h-4" />
                        </span>
                      )}
                    </button>
                    {open && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {roleOptions.map((opt) => {
                          const on = r.includes(opt.value);
                          return (
                            <button
                              key={opt.value}
                              onClick={() => toggleRole(g.id, opt.value)}
                              aria-pressed={on}
                              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
                                on
                                  ? "bg-rba-green/15 border-rba-green/50 text-rba-green font-semibold"
                                  : "border-border text-muted hover:text-foreground"
                              }`}
                            >
                              {on && <Check className="w-3 h-3" />}
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <button
              onClick={save}
              disabled={saving || groups.length === 0}
              className="inline-flex items-center gap-1.5 bg-primary text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Save shared chats
            </button>
          </section>
        )}

        {/* 3. Admin's own GroupMe (optional) */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">3. Your own GroupMe (optional, admins only)</h2>
          {personal.connected ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2">
              <p className="text-sm">
                Connected as <strong>{personal.name || "you"}</strong>. In groups your own account is in, you send as
                yourself.
              </p>
              <button
                onClick={personal.onDisconnect}
                className="text-xs text-muted hover:text-red-600 inline-flex items-center gap-1 shrink-0"
              >
                <Unlink className="w-3.5 h-3.5" /> Disconnect
              </button>
            </div>
          ) : (
            <a
              href="/api/groupme/connect"
              className="inline-flex items-center gap-2 border border-border rounded-lg px-3 py-2 text-sm"
            >
              Sign in with your own GroupMe
            </a>
          )}
        </section>

        {message && (
          <p className={`text-xs ${message.ok ? "text-green-700 dark:text-green-400" : "text-danger"}`}>{message.text}</p>
        )}
      </div>
    </div>
  );
}
