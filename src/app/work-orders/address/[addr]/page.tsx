"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FieldWorkOrder } from "@/lib/types";
import {
  fetchActiveWriteUpAddressIndex,
  fetchWriteUpsByIds,
  getSignedPhotoUrl,
} from "@/lib/work-order-store";
import { addressKey } from "@/lib/address-match";
import WriteUpDocView from "@/components/WriteUpDocView";
import { useData } from "@/components/DataProvider";
import { useAuth } from "@/hooks/useAuth";
import { canSeeWriteUps } from "@/lib/roles";
import { AlertTriangle, Loader2 } from "lucide-react";

/**
 * Every ACTIVE write-up at one address, across order numbers.
 *
 * A service work order carries its own number, so the write-ups a crew needs
 * were filed against the original install and can't be reached from the service
 * PO. This page gathers them by address instead — which is why the caveat at
 * the top matters: these are all the open issues at the house, not a list
 * scoped to the work order the crew happens to be assigned.
 */
export default function AddressWriteUpsPage() {
  const params = useParams();
  const router = useRouter();
  const { roles, loading: authLoading } = useAuth();
  const { activeWriteUpsAt } = useData();
  const [writeUps, setWriteUps] = useState<FieldWorkOrder[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const address = decodeURIComponent(String(params.addr || ""));
  const canView = canSeeWriteUps(roles);

  // The ids the calendar already knows about. Joined into a string so the
  // effect keys off the actual ids rather than a fresh array each render.
  const knownIds = activeWriteUpsAt(address)
    .map((r) => r.id)
    .sort()
    .join(",");

  useEffect(() => {
    if (!address || authLoading || !canView) return;
    let cancelled = false;

    (async () => {
      let ids = knownIds ? knownIds.split(",") : [];
      // Opened from a tile, the index is already in memory and this is skipped.
      // On a hard refresh or a shared link it hasn't loaded yet, so pull it.
      if (ids.length === 0) {
        const index = await fetchActiveWriteUpAddressIndex();
        const key = addressKey(address);
        ids = (index.get(key.street) || [])
          .filter((h) => !key.zip || !h.zip || h.zip === key.zip)
          .map((h) => h.id);
      }
      if (cancelled) return;

      const rows = await fetchWriteUpsByIds(ids);
      if (cancelled) return;
      // Keep each order's submissions together, units in order within them.
      rows.sort(
        (a, b) =>
          (a.orderNumber || "").localeCompare(b.orderNumber || "") ||
          (a.unitLabel || "~").localeCompare(b.unitLabel || "~")
      );
      setWriteUps(rows);
      setLoading(false);

      const paths = rows.flatMap((x) => x.photos.map((p) => p.path));
      const entries = await Promise.all(
        paths.map(async (path) => [path, (await getSignedPhotoUrl(path)) || ""] as const)
      );
      if (cancelled) return;
      setPhotoUrls(Object.fromEntries(entries.filter(([, u]) => u)));
    })();

    return () => {
      cancelled = true;
    };
  }, [address, authLoading, canView, knownIds]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3 px-6 text-center">
        <p className="text-muted">Write-ups aren&apos;t available for your account.</p>
        <button onClick={() => router.push("/")} className="text-primary underline text-sm">
          Back to calendar
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (writeUps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3 px-6 text-center">
        <p className="text-muted">No active write-ups at {address || "this address"}.</p>
        <button onClick={() => router.back()} className="text-primary underline text-sm">
          Go back
        </button>
      </div>
    );
  }

  const first = writeUps[0];
  const orderNumbers = Array.from(new Set(writeUps.map((w) => w.orderNumber).filter(Boolean)));
  const customers = Array.from(new Set(writeUps.map((w) => w.customerName).filter(Boolean)));

  return (
    <WriteUpDocView
      writeUps={writeUps}
      photoUrls={photoUrls}
      showSectionOrder
      docContext={{
        orderNumber: orderNumbers.join(", "),
        customerName: customers.join(", "),
        address: first.address || address,
        workOrderNumber: "",
      }}
      header={
        <>
          <div className="font-bold text-foreground">{customers.join(" / ") || "—"}</div>
          <div className="text-muted">{first.address || address}</div>
          <div className="text-muted">
            PO# {orderNumbers.length ? orderNumbers.join(" · ") : "—"}
          </div>
        </>
      }
      caveat={
        <div className="mb-5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-3 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-700" />
          <div className="text-xs leading-relaxed text-amber-800">
            <span className="font-bold uppercase tracking-wide block mb-0.5">
              All active write-ups at this address
            </span>
            {`These are every open write-up on record for this house, pulled by address${
              orderNumbers.length > 1 ? ` across ${orderNumbers.length} order numbers` : ""
            }. They are not necessarily specific to the work order you were assigned — check with your manager before working anything that isn't on your own order.`}
          </div>
        </div>
      }
    />
  );
}
