"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calendar, Search, ScrollText, Wrench, BadgeDollarSign, ClipboardCheck, MessageCircle } from "lucide-react";
import { readRememberedRoles, useAuth } from "@/hooks/useAuth";
import { useMfmNotices } from "@/hooks/useMfmNotices";
import { useJobCompleteTodo } from "@/hooks/useJobCompleteTodo";
import { fetchChatConnection, readChatCache, writeChatCache } from "@/lib/chat-cache";
import {
  canSeeWriteUps,
  canUseInstallerChat,
  isAdmin,
  isInstaller,
  isInstallerLead,
  isMfmSubmitter,
} from "@/lib/roles";

/** How often to ask whether anything new has arrived in Chat. */
const UNREAD_POLL_MS = 60_000;

/**
 * The red number on the Duck Force icon on the phone's home screen: how many
 * chats have unread messages. Works where the browser supports app badges
 * (iPhone home-screen apps with notifications allowed, installed desktop
 * Chrome/Edge); elsewhere these calls don't exist and it quietly does nothing.
 * It updates while Duck Force is open, so the number reflects the last check.
 */
function setIconBadge(count: number) {
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (count > 0) nav.setAppBadge?.(count)?.catch(() => {});
    else nav.clearAppBadge?.()?.catch(() => {});
  } catch {
    // Not supported here.
  }
}

// Settings lives in the top-right of the calendar header, not the bottom nav.
const NAV_ITEMS = [
  { href: "/", label: "Calendar", icon: Calendar },
  { href: "/search", label: "Search", icon: Search },
  // Changes lists every job that moved, on every crew, with customer names —
  // and it is served with the service-role key, so none of the installer
  // restrictions reach it. Hidden here; the route refuses them outright.
  // Also hidden from install leads (even a lead who is a field manager): their
  // More for More tab takes its place.
  { href: "/log", label: "Changes", icon: ScrollText, notInstaller: true },
  // Install leads' bonus sheets (and admins'). Sits where Changes was, left
  // of Write-Ups.
  { href: "/more-for-more", label: "More for More", icon: BadgeDollarSign, installerLead: true },
  // Write-Ups is gated below (admin + field-manager only for now).
  { href: "/work-orders", label: "Write-Ups", icon: Wrench, writeUps: true },
  // Chat (GroupMe installer threads) is gated below — admin only during the
  // pilot. Stays last so it reads as the newest, least-established tab.
  { href: "/chat", label: "Chat", icon: MessageCircle, chat: true },
];

/**
 * `previewRoles` draws the bar as if signed in with those roles. Only the
 * /dev-* harness pages pass it (to check how a role's tabs fit on a phone);
 * it decides what is DRAWN, never what anyone may open.
 */
export default function BottomNav({ previewRoles }: { previewRoles?: string[] } = {}) {
  const pathname = usePathname();
  const auth = useAuth();
  // Until the sign-in check has a real answer, draw with the roles this phone
  // was given last time; with neither, draw only the tabs everyone gets.
  // Without this the bar opened as "no roles" and tabs popped in and out.
  // Read in a layout effect (not during render) so the server-drawn page and
  // the first phone-drawn frame match, and it still lands before paint.
  const known = !auth.loading && !!auth.user;
  const [remembered, setRemembered] = useState<string[] | null>(null);
  useLayoutEffect(() => {
    // Syncing from phone storage into React; intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!known) setRemembered(readRememberedRoles());
  }, [known]);
  const roles: string[] | null = previewRoles ?? (known ? auth.roles : remembered);
  // Sheets payroll sent back that this lead still has to fix, plus installs
  // that reached their last day with no Job Complete filed yet.
  const { rejectedCount } = useMfmNotices();
  const jobCompleteDue = useJobCompleteTodo().length;
  const badgeCount = rejectedCount + jobCompleteDue;
  // Install leads (and admins) get the combined tab; a More for More Submitter
  // who isn't a lead still just sees More for More.
  const submissions = !!roles && (isInstallerLead(roles) || isAdmin(roles));
  const canChat = canUseInstallerChat(roles);
  // Real signed-in roles, not previewRoles: the harness pages must not start
  // polling GroupMe just because they draw an admin's bar.
  const pollChat = !previewRoles && canUseInstallerChat(auth.roles);
  const [chatUnread, setChatUnread] = useState(0);

  // Unread count for the Chat tab. Per signed-in user, so one person reading a
  // conversation never clears anyone else's badge.
  //
  // Polled rather than pushed: the app runs on serverless hosting that cannot
  // hold a connection open. A minute is deliberately unhurried -- this is a
  // "someone is waiting on you" hint, not a live ticker.
  //
  // The same answer also fills the Chat tab's memory cache (src/lib/chat-cache),
  // so the Chat list is already there when it's tapped instead of waiting on
  // GroupMe. The connection state is fetched once up front for the same reason.
  const userId = auth.user?.id ?? null;
  useEffect(() => {
    if (!pollChat) return;

    let cancelled = false;
    if (!readChatCache(userId)?.connection) fetchChatConnection(userId);
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/groupme/unread");
        if (!res.ok) return;
        const body = await res.json();
        const total = Number(body.total) || 0;
        if (Array.isArray(body.chats)) writeChatCache(userId, { chats: body.chats });
        if (!cancelled) setChatUnread(total);
        setIconBadge(total);
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
  }, [pollChat, pathname, userId]);

  // Hide the Write-Ups tab from regular members during the soft rollout, and
  // the Chat tab from everyone but admins during the GroupMe pilot.
  const items = NAV_ITEMS.filter((i) =>
    !roles
      ? // Roles not known yet: only the tabs nobody is ever denied.
        !i.writeUps && !i.notInstaller && !i.installerLead && !i.chat
      : (!i.writeUps || canSeeWriteUps(roles)) &&
      (!i.notInstaller || !(isInstaller(roles) || (isInstallerLead(roles) && !isAdmin(roles)))) &&
      // Admins always see everything, so they get it without the role.
      (!i.installerLead || isInstallerLead(roles) || isAdmin(roles) || isMfmSubmitter(roles)) &&
      (!i.chat || canChat)
  );

  return (
    <nav
      className="sticky bottom-0 bg-background border-t border-border flex items-stretch z-40 safe-area-bottom"
      style={{
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
      }}
    >
      {items.map((item) => {
        const { href } = item;
        const isSubs = href === "/more-for-more" && submissions;
        const label = isSubs ? "Submissions" : item.label;
        const Icon = isSubs ? ClipboardCheck : item.icon;
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`flex-1 min-w-0 flex flex-col items-center justify-start py-2.5 gap-1 transition-colors ${
              active ? "text-primary" : "text-muted"
            }`}
          >
            <span className="relative shrink-0">
              <Icon className="w-6 h-6" />
              {href === "/more-for-more" && badgeCount > 0 && (
                <span
                  className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] rounded-full bg-danger text-white text-[10px] font-bold leading-[18px] text-center px-1"
                  aria-label={`${badgeCount} need your attention`}
                >
                  {badgeCount}
                </span>
              )}
              {href === "/chat" && chatUnread > 0 && (
                <span
                  className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] rounded-full bg-danger text-white text-[10px] font-bold leading-[18px] text-center px-1"
                  aria-label={`${chatUnread} conversation${chatUnread === 1 ? "" : "s"} with new messages`}
                >
                  {chatUnread > 9 ? "9+" : chatUnread}
                </span>
              )}
            </span>
            {/* Wraps to a second line rather than cutting off ("More for More"
                on a five- or six-tab bar); icons stay lined up across the top. */}
            <span className="text-xs font-medium leading-tight text-center line-clamp-2 break-words max-w-full px-0.5">
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
