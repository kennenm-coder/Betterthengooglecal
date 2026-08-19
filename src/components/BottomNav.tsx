"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calendar, Search, ScrollText, Wrench } from "lucide-react";

// Settings lives in the top-right of the calendar header, not the bottom nav.
// Write-Ups is visible to everyone allowlisted (view-only for non-editors).
const NAV_ITEMS = [
  { href: "/", label: "Calendar", icon: Calendar },
  { href: "/search", label: "Search", icon: Search },
  { href: "/log", label: "Changes", icon: ScrollText },
  { href: "/work-orders", label: "Write-Ups", icon: Wrench },
];

export default function BottomNav() {
  const pathname = usePathname();
  const items = NAV_ITEMS;

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
            className={`flex-1 min-w-0 flex flex-col items-center justify-center py-2.5 gap-1 transition-colors ${
              active ? "text-primary" : "text-muted"
            }`}
          >
            <Icon className="w-6 h-6 shrink-0" />
            <span className="text-xs font-medium leading-none truncate max-w-full px-0.5">
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
