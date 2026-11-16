"use client";

import { useEffect, useState } from "react";
import { fetchWriteUpsByIds } from "@/lib/work-order-store";

/**
 * "Kennen M." from an account — its email ("kennen.m@rbanwo.com") or the name
 * the check-off stamped, which is the same thing minus the domain. First name
 * plus last initial; a lone name stays as it is.
 */
export function shortPersonName(emailOrName: string): string {
  const local = emailOrName.split("@")[0].trim();
  const parts = local.split(/[._\-\s]+/).filter(Boolean);
  if (parts.length === 0) return "";
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  if (parts.length === 1) return cap(parts[0]);
  return `${cap(parts[0])} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

/**
 * The people who have checked off work on these write-ups, as one line above
 * the Active Write-Ups button: "Write-ups completed by Kennen M., Dana R.".
 * Renders nothing until someone has checked something off (or while loading),
 * so a tile with no completed work looks exactly as it did.
 */
export default function WriteUpCompletedBy({ ids, refreshKey }: { ids: string[]; refreshKey?: number }) {
  const [names, setNames] = useState<string[]>([]);
  const idKey = [...ids].sort().join(",");

  useEffect(() => {
    let cancelled = false;
    if (!idKey) {
      setNames([]);
      return;
    }
    fetchWriteUpsByIds(idKey.split(","))
      .then((rows) => {
        if (cancelled) return;
        // One entry per person, in the order they first appear.
        const seen = new Map<string, string>();
        for (const row of rows) {
          for (const li of row.lineItems || []) {
            if (!li.completed) continue;
            const who = li.completedBy || li.completedByName;
            if (!who) continue;
            const key = who.toLowerCase();
            if (seen.has(key)) continue;
            const short = shortPersonName(who);
            if (short) seen.set(key, short);
          }
        }
        setNames([...seen.values()]);
      })
      .catch(() => {
        if (!cancelled) setNames([]);
      });
    return () => {
      cancelled = true;
    };
  }, [idKey, refreshKey]);

  if (names.length === 0) return null;
  return (
    <p className="mt-3 text-xs text-muted text-center">
      Write-ups completed by <span className="font-medium text-foreground">{names.join(", ")}</span>
    </p>
  );
}
