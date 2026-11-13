"use client";

import { useEffect, useState } from "react";
import { fetchLinkedTrimOrdersCached, orderVendorsFrom, type OrderVendors } from "@/lib/trim-order-handoff";

/**
 * The vendors on each job's trim order(s), keyed by order number — what the
 * material list app is actually buying from, so a write-up's Vendor column can
 * show it (see shownVendor). null until loaded, and while `enabled` is false:
 * a closed tile on the Write-Ups list asks nothing, so the page doesn't fire a
 * request per job just by opening.
 */
export function useOrderVendors(
  orderNumbers: string[],
  enabled = true
): Record<string, OrderVendors> | null {
  const key = [...new Set(orderNumbers.map((s) => String(s || "").trim()).filter(Boolean))].sort().join(",");
  const [state, setState] = useState<{ key: string; byOrder: Record<string, OrderVendors> } | null>(null);

  useEffect(() => {
    if (!enabled || !key) return;
    let live = true;
    const orders = key.split(",");
    Promise.all(orders.map((o) => fetchLinkedTrimOrdersCached(o))).then((lists) => {
      if (!live) return;
      const byOrder: Record<string, OrderVendors> = {};
      orders.forEach((o, i) => (byOrder[o] = orderVendorsFrom(lists[i])));
      setState({ key, byOrder });
    });
    return () => {
      live = false;
    };
  }, [key, enabled]);

  return state && state.key === key ? state.byOrder : null;
}

/** All the orders' vendors as one lookup — for the job material total, whose
 *  merged lines no longer say which order they came from. */
export function unionOrderVendors(byOrder: Record<string, OrderVendors> | null): OrderVendors | null {
  if (!byOrder) return null;
  const out: OrderVendors = new Map();
  for (const ov of Object.values(byOrder)) {
    for (const [k, list] of ov) {
      const into = out.get(k) || [];
      for (const v of list) if (!into.some((x) => x.toLowerCase() === v.toLowerCase())) into.push(v);
      out.set(k, into);
    }
  }
  return out;
}
