"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FieldWorkOrder } from "@/lib/types";
import { fetchWriteUpsForOrder, getSignedPhotoUrl } from "@/lib/work-order-store";
import WriteUpDocView from "@/components/WriteUpDocView";
import { useAuth } from "@/hooks/useAuth";
import { canSeeWriteUps } from "@/lib/roles";
import { Loader2 } from "lucide-react";

export default function WorkOrderDocPage() {
  const params = useParams();
  const router = useRouter();
  const { roles, loading: authLoading } = useAuth();
  const [writeUps, setWriteUps] = useState<FieldWorkOrder[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const orderNumber = decodeURIComponent(String(params.order || ""));
  // Soft rollout: only admin + field-manager can view a write-up doc.
  const canView = canSeeWriteUps(roles);

  useEffect(() => {
    if (!orderNumber || authLoading || !canView) return;
    fetchWriteUpsForOrder(orderNumber).then(async (w) => {
      // Newest issues first, whole-job entries last.
      w.sort((a, b) => (a.unitLabel || "~").localeCompare(b.unitLabel || "~"));
      setWriteUps(w);
      setLoading(false);

      // Resolve signed URLs for all photos (private bucket).
      const paths = w.flatMap((x) => x.photos.map((p) => p.path));
      const entries = await Promise.all(
        paths.map(async (path) => [path, (await getSignedPhotoUrl(path)) || ""] as const)
      );
      setPhotoUrls(Object.fromEntries(entries.filter(([, u]) => u)));
    });
  }, [orderNumber, authLoading, canView]);

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
      <div className="flex flex-col items-center justify-center h-screen gap-3">
        <p className="text-muted">No write-ups found for #{orderNumber}</p>
        <button onClick={() => router.back()} className="text-primary underline text-sm">
          Go back
        </button>
      </div>
    );
  }

  const first = writeUps[0];

  return (
    <WriteUpDocView
      writeUps={writeUps}
      photoUrls={photoUrls}
      docContext={{
        orderNumber: first.orderNumber || orderNumber,
        customerName: first.customerName || "",
        address: first.address || "",
        workOrderNumber: first.workOrderNumber || "",
      }}
      header={
        <>
          <div className="font-bold text-foreground">{first.customerName || "—"}</div>
          <div className="text-muted">{first.address || "—"}</div>
          <div className="text-muted">PO# {first.orderNumber || "—"}</div>
          {first.workOrderNumber && (
            <div className="text-xs text-muted">WO# {first.workOrderNumber}</div>
          )}
        </>
      }
    />
  );
}
