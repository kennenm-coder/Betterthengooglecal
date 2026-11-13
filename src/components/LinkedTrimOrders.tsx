"use client";

import { useEffect, useState } from "react";
import { Loader2, PackageCheck } from "lucide-react";
import { fetchLinkedTrimOrdersCached, LinkedTrimOrder, trimMatchKey as key } from "@/lib/trim-order-handoff";
import type { WriteUpMaterialItem } from "@/lib/types";

const STATUS_TEXT: Record<string, string> = {
  ready_to_order: "Not ordered yet",
  on_hold: "On hold",
  ordered: "Ordered",
};

/**
 * The trim order(s) this write-up opened, as they stand in trim ordering right
 * now -- status and the vendor on every line. Read-only: the order is worked in
 * the material list app, and whatever vendor is picked there shows up here.
 * Where it differs from the vendor the write-up was written with, it says so.
 *
 * Renders nothing when the job has no linked order (no trim to order, or an
 * order opened before migration 044 that could not be matched).
 */
export default function LinkedTrimOrders({
  orderNumber,
  materials,
}: {
  orderNumber: string;
  materials: WriteUpMaterialItem[];
}) {
  const [orders, setOrders] = useState<LinkedTrimOrder[] | null>(null);

  useEffect(() => {
    let live = true;
    fetchLinkedTrimOrdersCached(orderNumber).then((o) => {
      if (live) setOrders(o);
    });
    return () => {
      live = false;
    };
  }, [orderNumber]);

  if (orders === null) {
    return (
      <div className="px-4 py-2 border-t border-border text-[11px] text-muted flex items-center gap-1.5 no-print">
        <Loader2 className="w-3 h-3 animate-spin" /> Checking trim ordering…
      </div>
    );
  }
  if (orders.length === 0) return null;

  const writeupVendor = new Map<string, string>();
  for (const m of materials) {
    if (m.kind === "part") continue;
    writeupVendor.set(key(m.item, m.species, m.color), (m.vendor || "").trim());
  }

  return (
    <div className="px-4 py-3 border-t border-border bg-primary/5 space-y-2.5 no-print">
      {orders.map((o) => (
        <div key={o.po}>
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <PackageCheck className="w-4 h-4 text-primary shrink-0" />
            Trim order <span className="font-mono">{o.po}</span>
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                o.status === "ordered"
                  ? "bg-green-600/15 text-green-700"
                  : o.status === "on_hold"
                    ? "bg-surface border border-border text-muted"
                    : "bg-blue-500/15 text-blue-600"
              }`}
            >
              {STATUS_TEXT[o.status] || o.status}
            </span>
          </p>
          <ul className="mt-1 space-y-0.5">
            {o.lines.map((l, i) => {
              const was = writeupVendor.get(key(l.profile, l.species, l.color));
              const moved = was !== undefined && was !== "" && l.vendor && was !== l.vendor;
              return (
                <li key={i} className="text-[11px] text-muted">
                  <span className="text-foreground">{l.profile}</span>
                  {l.color ? ` · ${l.color}` : ""}
                  {l.lengths ? ` · ${l.lengths}` : ` · ×${l.qty}`}
                  {" — "}
                  <span className="font-semibold text-foreground">{l.vendor || "no vendor yet"}</span>
                  {moved && <span> (write-up said {was})</span>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
