"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calendar, Search, ScrollText, UserCog, Wrench } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { canDoFieldWork, canReviewWriteUps } from "@/lib/roles";

const NAV_ITEMS = [
  { href: "/", label: "Calendar", icon: Calendar },
  { href: "/search", label: "Search", icon: Search },
  { href: "/log", label: "Changes", icon: ScrollText },
  { href: "/settings", label: "Settings", icon: UserCog },
];

export default function BottomNav() {
  const pathname = usePathname();
  const { role } = useAuth();
  const showWriteUps = canDoFieldWork(role) || canReviewWriteUps(role);

  const items = showWriteUps
    ? [
        ...NAV_ITEMS.slice(0, 3),
        { href: "/work-orders", label: "Write-Ups", icon: Wrench },
        ...NAV_ITEMS.slice(3),
      ]
    : NAV_ITEMS;

  return (
    <nav className="sticky bottom-0 bg-background border-t border-border flex items-stretch z-40 safe-area-bottom">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors ${
              active ? "text-primary" : "text-muted"
            }`}
          >
            <Icon className="w-5 h-5" />
            <span className="text-[11px] font-medium">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
