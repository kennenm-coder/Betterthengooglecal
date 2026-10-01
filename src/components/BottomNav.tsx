"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calendar, Search, ScrollText, Wrench, MessageCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { canSeeWriteUps, canUseInstallerChat } from "@/lib/roles";

// Settings lives in the top-right of the calendar header, not the bottom nav.
const NAV_ITEMS = [
  { href: "/", label: "Calendar", icon: Calendar },
  { href: "/search", label: "Search", icon: Search },
  { href: "/log", label: "Changes", icon: ScrollText },
  // Write-Ups is gated below (admin + field-manager only for now).
  { href: "/work-orders", label: "Write-Ups", icon: Wrench, writeUps: true },
  // Chat (GroupMe installer threads) is gated below — admin only during the
  // pilot. Stays last so it reads as the newest, least-established tab.
  { href: "/chat", label: "Chat", icon: MessageCircle, chat: true },
];

/** How often to ask whether anything new has arrived. */
const UNREAD_POLL_MS = 60_000;

export default function BottomNav() {
  const pathname = usePathname();
  const { roles } = useAuth();
  const [unread, setUnread] = useState(0);
  const canChat = canUseInstallerChat(roles);

  // Unread count for the Chat tab. Per signed-in user, so one person reading a
  // conversation never clears anyone else's badge.
  //
  // Polled rather than pushed: the app runs on serverless hosting that cannot
  // hold a connection open. A minute is deliberately unhurried -- this is a
  // "someone is waiting on you" hint, not a live ticker, and the server caches
  // the GroupMe side anyway so extra polling would buy nothing.
  useEffect(() => {
    if (!canChat) return;

    let cancelled = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/groupme/unread");
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled) setUnread(Number(body.total) || 0);
      } catch {
        // Offline or GroupMe hiccuping. Leave the last known count alone
        // rather than flashing it to zero.
      }
    };

    check();
    const timer = setInterval(check, UNREAD_POLL_MS);
    // Catch up straight away when someone comes back to the tab.
    document.addEventListener("visibilitychange", check);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [canChat, pathname]);
  // Hide the Write-Ups tab from regular members during the soft rollout, and
  // the Chat tab from everyone but admins during the GroupMe pilot.
  const items = NAV_ITEMS.filter(
    (i) => (!i.writeUps || canSeeWriteUps(roles)) && (!i.chat || canChat)
  );

  return (
    <nav
      className="sticky bottom-0 bg-background border-t border-border flex items-stretch z-40 safe-area-bottom"
      style={{
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
      }}
    >
      {items.map(({ href, label, icon: Icon, chat }) => {
        const active = pathname === href;
        const badge = chat ? unread : 0;
        return (
          <Link
            key={href}
            href={href}
            className={`flex-1 min-w-0 flex flex-col items-center justify-center py-2.5 gap-1 transition-colors ${
              active ? "text-primary" : "text-muted"
            }`}
          >
            <span className="relative shrink-0">
              <Icon className="w-6 h-6 shrink-0" />
              {badge > 0 && (
                <span
                  aria-label={`${badge} conversation${badge === 1 ? "" : "s"} with new messages`}
                  className="absolute -top-1 -right-1.5 min-w-[1.05rem] h-[1.05rem] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold leading-[1.05rem] text-center"
                >
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
            </span>
            <span className="text-xs font-medium leading-none truncate max-w-full px-0.5">
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
