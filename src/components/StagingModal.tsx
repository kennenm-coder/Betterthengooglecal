"use client";

import { useEffect, useState } from "react";
import { Truck, X, Loader2 } from "lucide-react";
import type { WorkOrder, MaterialUnit } from "@/lib/types";
import { fetchInstallDoc, type InstallDocRow } from "@/lib/install-doc";
import StagingSection from "./StagingSection";

/**
 * The warehouse list for one job, opened from its tile.
 *
 * It lives here rather than on the install paperwork because the question it
 * answers — is everything for this job actually in the building — gets asked
 * days before anyone opens the paperwork, and usually by the office rather
 * than the crew.
 *
 * The cross-check needs the job's unit list and its material list. Both come
 * from the install document, which is fetched here; the tile itself only
 * carries the units. Without a document the list still works, it just has
 * less to compare against.
 */
export default function StagingModal({
  order,
  materialJobId,
  units,
  onClose,
}: {
  order: WorkOrder;
  materialJobId: string | null;
  units: MaterialUnit[];
  onClose: () => void;
}) {
  const [docUnits, setDocUnits] = useState<MaterialUnit[]>(units);
  const [nwoRows, setNwoRows] = useState<InstallDocRow[]>([]);
  const [loadingDoc, setLoadingDoc] = useState(!!materialJobId);

  useEffect(() => {
    let alive = true;
    if (!materialJobId) return;
    fetchInstallDoc(materialJobId)
      .then((rec) => {
        if (!alive || !rec) return;
        if (rec.doc.units?.length) setDocUnits(rec.doc.units);
        setNwoRows(rec.doc.nwoRows || []);
      })
      .catch(() => {
        // No document, or no access to it. The staging list is still useful;
        // only the vendor half of the cross-check goes quiet.
      })
      .finally(() => {
        if (alive) setLoadingDoc(false);
      });
    return () => {
      alive = false;
    };
  }, [materialJobId]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative bg-background w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] flex flex-col shadow-xl">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Truck className="w-4 h-4 text-amber-600" />
              <h2 className="font-semibold">In the warehouse</h2>
            </div>
            <p className="text-xs text-muted mt-0.5 truncate">
              {order.customerName || "—"} · PO {order.orderNumber}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-muted" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pt-4">
          {loadingDoc ? (
            <div className="flex items-center gap-2 px-3.5 py-3 text-sm text-muted">
              <Loader2 className="w-4 h-4 animate-spin" />
              Reading the job&apos;s paperwork…
            </div>
          ) : (
            <StagingSection
              orderNumber={(order.orderNumber || "").trim()}
              units={docUnits}
              nwoRows={nwoRows}
            />
          )}
        </div>
      </div>
    </div>
  );
}
