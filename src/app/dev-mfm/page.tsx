"use client";

// DEV-ONLY test harness for the More for More form. Renders nothing in
// production (NODE_ENV is "production" on Vercel), and the middleware only
// exempts /dev-* from auth in development — so this is inert and unreachable
// in production. Saving needs a signed-in session and migration 045, so it
// will fail here; everything else (layout, auto-fill, math, downloads) works.

import { useState } from "react";
import MoreForMoreForm from "@/components/MoreForMoreForm";
import type { WorkOrder } from "@/lib/types";
import { snapshotOf, type MoreForMore } from "@/lib/more-for-more";

const unit = (abbrev: string, frame: string, w: string, h: string, extra: Record<string, unknown> = {}) => ({
  label: abbrev,
  type: "",
  abbrev,
  frame,
  qty: 1,
  widthWhole: w,
  widthFrac: 0,
  heightWhole: h,
  heightFrac: 0,
  extColor: "",
  intColor: "",
  intFinish: "",
  grilles: false,
  tempered: false,
  ...extra,
});

const mockOrder = {
  id: "dev-1",
  status: "",
  orderNumber: "1234567",
  workOrderNumber: "WO-00981",
  address: "123 Main St, Toledo, OH 43604",
  bookingDate: null,
  customerName: "Smith, John",
  orderOwner: "",
  salesRep: "",
  techMeasure: "",
  installer: "Keith Morris",
  serviceRep: "",
  appointmentStatus: "",
  scheduledStart: "2026-11-03T08:00:00",
  scheduledEnd: null,
  contactName: "",
  email: "",
  phones: [],
  serviceDescription: "",
  primaryResource: "Keith Morris",
  workOrderType: "Install",
  description: "",
  combinedRetailTotal: 0,
  productCount: 12,
  totalUnits: 12,
  windows: 10,
  patioDoors: 1,
  doors: 1,
  orderAlerts: "",
  accountName: "",
  latitude: null,
  longitude: null,
  isMine: true,
  materialJob: {
    id: "m1",
    job: {} as never,
    units: [
      ...Array.from({ length: 7 }, () => unit("DH", "Insert", "30", "50")),
      unit("CS", "FF", "36", "60"),
      unit("PIC", "FF", "72", "60"),
      unit("BAY", "FF", "96", "60"),
      unit("PTD", "", "72", "80", { subType: "Gliding" }),
      unit("ED", "", "36", "80"),
    ],
    globalTrim: {} as never,
    submitted: true,
    status: "",
    savedAt: "",
  },
} as unknown as WorkOrder;

const mockSheet: MoreForMore = {
  id: "dev-sheet",
  sheet_type: "bonus",
  ...snapshotOf(mockOrder, "Keith Morris"),
  status: "submitted",
  lead_data: {
    leadName: "Keith Morris",
    leadTier: 2,
    leadQty: { insert: 7, fullFrame: 2, bayBow: 1, pdGlider: 1, entryDoor: 1 },
    apprentices: [{ name: "Tim Fitz", tier: 1, sameAsLead: true, qty: {} }],
    installerNote: "Hauled away old storms.",
  },
  office_data: {},
  lead_total: 0,
  final_total: null,
  created_by: "keith@example.com",
  created_by_name: "Keith Morris",
  created_at: "2026-11-04T15:00:00Z",
  submitted_at: "2026-11-04T15:00:00Z",
  submit_count: 2,
  updated_at: "2026-11-04T15:00:00Z",
  completed_at: null,
  completed_by: null,
  completed_by_name: null,
};

export default function DevMfmPage() {
  const [mode, setMode] = useState<"lead" | "office" | null>(null);
  if (process.env.NODE_ENV === "production") return null;
  return (
    <div className="p-4 space-y-3">
      <h1 className="text-lg font-semibold">More for More harness</h1>
      <button className="block rounded-lg bg-rba-green px-4 py-2 text-white" onClick={() => setMode("lead")}>
        Lead: new sheet (auto-filled)
      </button>
      <button className="block rounded-lg bg-primary px-4 py-2 text-white" onClick={() => setMode("office")}>
        Office: resubmitted sheet
      </button>
      {mode && (
        <MoreForMoreForm
          mode={mode}
          job={snapshotOf(mockOrder, "Keith Morris")}
          order={mode === "lead" ? mockOrder : null}
          sheet={mode === "office" ? mockSheet : null}
          onClose={() => setMode(null)}
          onSaved={() => {}}
        />
      )}
    </div>
  );
}
