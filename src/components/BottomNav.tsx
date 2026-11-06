"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calendar, Search, ScrollText, Wrench, BadgeDollarSign } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useMfmNotices } from "@/hooks/useMfmNotices";
import { canSeeWriteUps, isAdmin, isInstaller, isInstallerLead } from "@/lib/roles";

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
];

/**
 * `previewRoles` draws the bar as if signed in with those roles. Only the
 * /dev-* harness pages pass it (to check how a role's tabs fit on a phone);
 * it decides what is DRAWN, never what anyone may open.
 */
export default function BottomNav({ previewRoles }: { previewRoles?: string[] } = {}) {
  const pathname = usePathname();
  const auth = useAuth();
  const roles = previewRoles ?? auth.roles;
  // Sheets payroll sent back that this lead still has to fix.
  const { rejectedCount } = useMfmNotices();
  // Hide the Write-Ups tab from regular members during the soft rollout.
  const items = NAV_ITEMS.filter(
    (i) =>
      (!i.writeUps || canSeeWriteUps(roles)) &&
      (!i.notInstaller || !(isInstaller(roles) || (isInstallerLead(roles) && !isAdmin(roles)))) &&
      // Admins always see everything, so they get it without the role.
      (!i.installerLead || isInstallerLead(roles) || isAdmin(roles))
  );

  return (
    <nav
      className="sticky bottom-0 bg-background border-t border-border flex items-stretch z-40 safe-area-bottom"
      style={{
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
      }}
    >
      {items.map(({ href, label, icon: Icon }) => {
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
              {href === "/more-for-more" && rejectedCount > 0 && (
                <span
                  className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] rounded-full bg-danger text-white text-[10px] font-bold leading-[18px] text-center px-1"
                  aria-label={`${rejectedCount} sent back to fix`}
                >
                  {rejectedCount}
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
