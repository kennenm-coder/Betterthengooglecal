"use client";

// DEV-ONLY test harness for the More for More form. Renders nothing in
// production (NODE_ENV is "production" on Vercel), and the middleware only
// exempts /dev-* from auth in development — so this is inert and unreachable
// in production. Saving needs a signed-in session and migration 045, so it
// will fail here; everything else (layout, auto-fill, math, downloads) works.

import { useState } from "react";
import MoreForMoreForm from "@/components/MoreForMoreForm";
import BottomNav from "@/components/BottomNav";
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
    additionalJobs: ["Jones service call"],
    jipInstallRelated: true,
    jipLittle: false,
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

const mockRejected: MoreForMore = {
  ...mockSheet,
  id: "dev-rejected",
  status: "rejected",
  reject_reason: "Bay was a bow, not a bay. Also add the second apprentice (Sam).",
  rejected_at: "2026-11-05T15:00:00Z",
  rejected_by_name: "Payroll Pat",
};

type Mode = "lead" | "office" | "lead-rejected" | "office-rejected" | "office-paper";

export default function DevMfmPage() {
  const [mode, setMode] = useState<Mode | null>(null);
  if (process.env.NODE_ENV === "production") return null;
  const sheetFor: Record<Mode, MoreForMore | null> = {
    lead: null,
    office: mockSheet,
    "lead-rejected": mockRejected,
    "office-rejected": mockRejected,
    "office-paper": null,
  };
  return (
    <div className="p-4 space-y-3">
      <h1 className="text-lg font-semibold">More for More harness</h1>
      <button className="block rounded-lg bg-rba-green px-4 py-2 text-white" onClick={() => setMode("lead")}>
        Lead: new sheet (auto-filled)
      </button>
      <button className="block rounded-lg bg-primary px-4 py-2 text-white" onClick={() => setMode("office")}>
        Office: resubmitted sheet
      </button>
      <button className="block rounded-lg bg-danger px-4 py-2 text-white" onClick={() => setMode("lead-rejected")}>
        Lead: sent-back sheet
      </button>
      <button className="block rounded-lg border border-danger px-4 py-2 text-danger" onClick={() => setMode("office-rejected")}>
        Office: sent-back sheet
      </button>
      <button className="block rounded-lg border border-border px-4 py-2" onClick={() => setMode("office-paper")}>
        Office: type in a paper sheet
      </button>
      <div className="space-y-2 pt-4">
        {[
          ["Admin", ["admin"]],
          ["Admin + measure tech", ["admin", "measure-tech"]],
          ["Lead + field manager", ["installer-lead", "field-manager"]],
          ["Lead", ["installer-lead"]],
        ].map(([label, roles]) => (
          <div key={label as string} data-nav-preview={label as string}>
            <p className="text-xs text-muted">{label as string}</p>
            <BottomNav previewRoles={roles as string[]} />
          </div>
        ))}
      </div>
      {mode && (
        <MoreForMoreForm
          mode={mode.startsWith("office") ? "office" : "lead"}
          job={snapshotOf(mockOrder, "Keith Morris")}
          order={mode === "lead" || mode === "office-paper" ? mockOrder : null}
          sheet={sheetFor[mode]}
          onClose={() => setMode(null)}
          onSaved={() => {}}
          previewPeople={[
            { id: "p1", name: "Keith Morris", kind: "lead", tier: 2, active: true },
            { id: "p2", name: "Kevin Hart", kind: "lead", tier: 1, active: true },
            { id: "p3", name: "Tim Fitz", kind: "apprentice", tier: 1, active: true },
            { id: "p4", name: "Sam Lee", kind: "apprentice", tier: 3, active: true },
            { id: "p5", name: "Kyle Old", kind: "either", tier: 2, active: false },
          ]}
        />
      )}
    </div>
  );
}
