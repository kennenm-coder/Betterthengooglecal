"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { canUseInbox, INBOX_DECIDED_EVENT, type InboxItem } from "@/lib/kiosk-inbox";

/** How often the approvals refresh while the page is open. */
const POLL_MS = 120_000;

/**
 * The kiosk approvals inbox (time off, time cards, forms, recognition
 * nominations) for the header bell — it used to be its own inbox-tray button
 * (TimeOffBell); Kennen had it folded into the one bell, 2026-11-19.
 *
 * Only for people whose roles can decide some kind of kiosk submission.
 * `unseen` counts what THIS person can decide that arrived since they last
 * opened the bell; markSeen() clears that count but not the list — items stay
 * until somebody decides them, so glancing never dismisses anybody's request.
 */
export function useKioskInbox() {
  const { roles, loading } = useAuth();
  const canReview = !loading && canUseInbox(roles);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [kioskUrl, setKioskUrl] = useState<string | null>(null);
  const [unseen, setUnseen] = useState(0);

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

  /** Opening the bell clears the badge, not the queue. */
  const markSeen = useCallback(() => {
    setUnseen(0);
    fetch("/api/kiosk-inbox", { method: "POST" }).catch(() => {});
  }, []);

  const handleDecided = useCallback((item: InboxItem) => {
    setItems((prev) =>
      prev.filter((i) => !(i.decision_table === item.decision_table && i.item_id === item.item_id))
    );
    // Let the Time Off page refresh itself if it is open behind this.
    window.dispatchEvent(new CustomEvent(INBOX_DECIDED_EVENT));
    if (item.kind === "time_off") window.dispatchEvent(new CustomEvent("time-off-decided"));
  }, []);

  return {
    canReview,
    items: canReview ? items : [],
    kioskUrl,
    unseen: canReview ? unseen : 0,
    refresh,
    markSeen,
    handleDecided,
  };
}
