"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { usePanelPosition } from "@/hooks/usePanelPosition";
import { useAuth } from "@/hooks/useAuth";
import { canUseInbox, INBOX_DECIDED_EVENT, type InboxItem } from "@/lib/kiosk-inbox";
import InboxItemCard from "@/components/kiosk-inbox/InboxItemCard";

/** How often the badge refreshes while the page is open. */
const POLL_MS = 120_000;

/**
 * The kiosk approvals inbox, in the header.
 *
 * Shown to anyone whose roles can decide some kind of kiosk submission (time
 * off, time cards, forms, recognition nominations). The badge counts only
 * what THIS person can decide that arrived since they last opened it.
 *
 * Opening it clears the badge but not the list: items stay until somebody
 * decides them, so glancing at the bell never silently dismisses anybody's
 * request.
 */
export default function TimeOffBell() {
  const { roles, loading } = useAuth();
  const canReview = !loading && canUseInbox(roles);

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [kioskUrl, setKioskUrl] = useState<string | null>(null);
  const [unseen, setUnseen] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  // Kept on screen (see usePanelPosition): this button isn't at the right edge either.
  const panelStyle = usePanelPosition(panelRef, open, 448);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/kiosk-inbox");
      if (!res.ok) return;
      const json = await res.json();
      setItems(((json.items ?? []) as InboxItem[]).filter((i) => i.can_decide));
      setKioskUrl(json.kioskUrl ?? null);
      setUnseen(json.unseen ?? 0);
    } catch {
      // A badge that cannot refresh is not worth an error message.
    }
  }, []);

  useEffect(() => {
    if (!canReview) return;
    let cancelled = false;
    const tick = () => {
      if (!cancelled) refresh();
    };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [canReview, refresh]);

  // Close when clicking away, so the panel does not sit over the calendar.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!canReview) return null;

  async function openPanel() {
    setOpen(true);
    await refresh();
    // Clear the badge, not the queue.
    setUnseen(0);
    fetch("/api/kiosk-inbox", { method: "POST" }).catch(() => {});
  }

  function handleDecided(item: InboxItem) {
    setItems((prev) =>
      prev.filter(
        (i) => !(i.decision_table === item.decision_table && i.item_id === item.item_id)
      )
    );
    // Let the Time Off page refresh itself if it is open behind this.
    window.dispatchEvent(new CustomEvent(INBOX_DECIDED_EVENT));
    if (item.kind === "time_off") {
      window.dispatchEvent(new CustomEvent("time-off-decided"));
    }
  }

  return (
    <div className="relative shrink-0" ref={panelRef}>
      <button
        onClick={() => (open ? setOpen(false) : openPanel())}
        className="relative p-1.5 rounded-md hover:bg-surface text-muted hover:text-foreground"
        title={
          items.length
            ? `${items.length} kiosk request${items.length === 1 ? "" : "s"} waiting`
            : "Kiosk approvals"
        }
      >
        {/* An inbox tray, not a bell: the bell next to it is the notification
            history (NotificationBell), and two bells side by side read as one. */}
        <Inbox className="w-5 h-5" />
        {unseen > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center">
            {unseen > 99 ? "99+" : unseen}
          </span>
        )}
      </button>

      {open && (
        <div style={panelStyle} className="overflow-auto rounded-xl border border-border bg-background shadow-xl z-50">
          <div className="sticky top-0 z-10 flex items-center gap-2 bg-background border-b border-border px-4 py-2.5">
            <p className="text-sm font-semibold flex-1">
              {items.length === 0
                ? "Nothing waiting"
                : `${items.length} to decide`}
            </p>
            <Link
              href="/time-off"
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-primary hover:underline"
            >
              Open inbox
            </Link>
          </div>

          {items.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted">
              No kiosk requests are waiting on you.
            </p>
          )}

          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={`${item.decision_table}:${item.item_id}`} className="px-4 py-3">
                <InboxItemCard
                  item={item}
                  kioskUrl={kioskUrl}
                  compact
                  onDecided={handleDecided}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
