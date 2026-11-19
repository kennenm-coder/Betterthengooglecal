"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getSupabase } from "@/lib/supabase";
import { usePanelPosition } from "@/hooks/usePanelPosition";
import { useKioskInbox } from "@/hooks/useKioskInbox";
import InboxItemCard from "@/components/kiosk-inbox/InboxItemCard";

/** Refresh the badge this often while the page is open (a push refreshes it
 *  straight away, so this only matters for people without buzzes turned on). */
const POLL_MS = 120_000;
const SHOW = 50;

interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  url: string | null;
  created_at: string;
  read_at: string | null;
}

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The ONE bell at the top of the calendar (Kennen, 2026-11-19: the separate
 * kiosk inbox button was folded in here). Two parts:
 *   1. "Waiting on you" — kiosk requests this person can decide (time off,
 *      time cards, forms, nominations), with the same decide buttons as the
 *      Time Off inbox. Only for approvers (useKioskInbox).
 *   2. "Notifications" — everything this account was notified about, newest
 *      first, kept 90 days, whether or not phone buzzes are on (migration 063;
 *      a person reads only their own rows).
 * The red number counts unread notifications plus new requests waiting.
 */
export default function NotificationBell() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const inbox = useKioskInbox();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  // Kept on screen: the bell isn't at the right edge of a phone.
  const panelStyle = usePanelPosition(panelRef, open, 448);
  const signedIn = !loading && !!user;

  const refresh = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data } = await supabase
      .from("notifications")
      .select("id, kind, title, body, url, created_at, read_at")
      .eq("app", "calendar")
      .order("created_at", { ascending: false })
      .limit(SHOW);
    if (data) setRows(data as NotificationRow[]);
  }, []);

  // Load, poll, and refresh when the tab comes back or a push lands.
  useEffect(() => {
    if (!signedIn) return;
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    const onFocus = () => refresh();
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "notification-received") refresh();
    };
    window.addEventListener("focus", onFocus);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, [signedIn, refresh]);

  // Close when tapping away, so the panel doesn't sit over the calendar.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!signedIn) return null;

  const unread = rows.filter((r) => !r.read_at).length;
  const badge = unread + inbox.unseen;
  const waiting = inbox.items;

  async function markRead(ids: string[]) {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    setRows((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, read_at: now } : r)));
    await getSupabase()?.from("notifications").update({ read_at: now }).in("id", ids);
  }

  function openRow(r: NotificationRow) {
    if (!r.read_at) markRead([r.id]);
    setOpen(false);
    if (r.url) router.push(r.url);
  }

  function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    refresh();
    if (inbox.canReview) {
      inbox.refresh();
      inbox.markSeen();
    }
  }

  const title = [
    unread ? `${unread} unread notification${unread === 1 ? "" : "s"}` : "",
    waiting.length ? `${waiting.length} request${waiting.length === 1 ? "" : "s"} waiting on you` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="relative shrink-0" ref={panelRef}>
      <button
        onClick={toggle}
        className="relative p-1.5 rounded-md hover:bg-surface text-muted hover:text-foreground"
        title={title || "Notifications"}
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {badge > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>

      {open && (
        <div style={panelStyle} className="overflow-auto rounded-xl border border-border bg-background shadow-xl z-50">
          {/* 1. Kiosk requests this person can decide (approvers only). */}
          {inbox.canReview && waiting.length > 0 && (
            <>
              <div className="sticky top-0 z-10 flex items-center gap-2 bg-background border-b border-border px-4 py-2.5">
                <p className="text-sm font-semibold flex-1">Waiting on you ({waiting.length})</p>
                <Link
                  href="/time-off"
                  onClick={() => setOpen(false)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Open inbox
                </Link>
              </div>
              <ul className="divide-y divide-border border-b border-border">
                {waiting.map((item) => (
                  <li key={`${item.decision_table}:${item.item_id}`} className="px-4 py-3">
                    <InboxItemCard item={item} kioskUrl={inbox.kioskUrl} compact onDecided={inbox.handleDecided} />
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* 2. Notification history. */}
          <div className="sticky top-0 z-10 flex items-center gap-2 bg-background border-b border-border px-4 py-2.5">
            <p className="text-sm font-semibold flex-1">Notifications</p>
            {unread > 0 && (
              <button
                onClick={() => markRead(rows.filter((r) => !r.read_at).map((r) => r.id))}
                className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </button>
            )}
          </div>

          {rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">
              Nothing yet. Anything you&apos;re notified about will show up here.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => openRow(r)}
                    className={`w-full text-left px-4 py-3 flex gap-2.5 hover:bg-surface ${r.read_at ? "" : "bg-primary/5"}`}
                  >
                    <span
                      className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${r.read_at ? "bg-transparent" : "bg-primary"}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${r.read_at ? "font-medium" : "font-semibold"}`}>{r.title}</span>
                      {r.body && (
                        <span className="block text-xs text-muted mt-0.5 whitespace-pre-line">{r.body}</span>
                      )}
                      <span className="block text-[11px] text-muted mt-1">{ago(r.created_at)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="px-4 py-2 text-[11px] text-muted border-t border-border">
            Kept for 90 days. Want a buzz on your phone too? Settings → Phone Notifications.
          </p>
        </div>
      )}
    </div>
  );
}
