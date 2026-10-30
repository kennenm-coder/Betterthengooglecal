"use client";

// DEV-ONLY test harness for the write-up modal. Renders nothing in production
// (NODE_ENV is "production" on Vercel), and the middleware only exempts /dev-*
// from auth in development — so this is inert and unreachable in production.

import { useState } from "react";
import WriteUpModal from "@/components/WriteUpModal";
import JobReferencePanel from "@/components/JobReferencePanel";
import { MaterialUnit, WorkOrder } from "@/lib/types";

const mockUnits: MaterialUnit[] = [
  {
    label: "101",
    type: "Double Hung",
    unitType: "Double Hung",
    qty: 1,
    exteriorColor: "White[RBA]",
    interiorColor: "Pine",
    intFinish: "Stain",
    frame: "Insert",
    widthWhole: "24",
    widthFrac: 0.5,
    heightWhole: "48",
    heightFrac: 0,
    grilles: false,
    tempered: false,
    widthFrac2: 0,
  } as unknown as MaterialUnit,
  {
    label: "102",
    type: "Casement",
    unitType: "Casement",
    qty: 1,
    exteriorColor: "Dark Bronze",
    interiorColor: "Oak",
    intFinish: "Stain",
    frame: "Full Frame",
    widthWhole: "30",
    widthFrac: 0,
    heightWhole: "60",
    heightFrac: 0,
    grilles: true,
    tempered: false,
  } as unknown as MaterialUnit,
  {
    label: "103",
    type: "Picture",
    unitType: "Picture",
    qty: 1,
    exteriorColor: "Canvas",
    interiorColor: "White[RBA]",
    intFinish: "Paint",
    frame: "Insert",
    widthWhole: "36",
    widthFrac: 0,
    heightWhole: "72",
    heightFrac: 0,
    grilles: false,
    tempered: true,
  } as unknown as MaterialUnit,
];

export default function DevWriteUpHarness() {
  const [open, setOpen] = useState(true);
  if (process.env.NODE_ENV !== "development") return null;

  const order = {
    orderNumber: "TEST-04793692",
    workOrderNumber: "WO-001",
    customerName: "Baker, Diana and Dennis",
    address: "2128 S Lake St Findlay, Ohio 45840",
    materialJob: null,
  };

  // Enough of a job for the desktop split view to have something in its left
  // pane. The calendar passes a real WorkOrder; this is the harness standing
  // in for one.
  const refOrder = {
    ...order,
    id: "dev-1",
    status: "Scheduled",
    appointmentStatus: "Scheduled",
    workOrderType: "Install",
    scheduledStart: new Date().toISOString(),
    scheduledEnd: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
    primaryResource: "Crew 4",
    orderOwner: "Dana Office",
    salesRep: "Pat Sales",
    techMeasure: "Mo Measure",
    installer: "Crew 4",
    serviceRep: "",
    contactName: "Diana Baker",
    email: "diana.baker@example.com",
    phones: [{ label: "Mobile", number: "(419) 555-0142" }],
    serviceDescription: "",
    dayCrews: null,
    materialJob: {
      id: "dev-mat",
      units: mockUnits,
      job: { installNotes: "Side door is the way in. Dog in the back." },
    },
    isMine: true,
  } as unknown as WorkOrder;

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold mb-4">Write-up modal — dev harness</h1>
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 rounded-lg bg-amber-500 text-white font-semibold"
      >
        Open write-up
      </button>
      {open && (
        <WriteUpModal
          order={order}
          units={mockUnits}
          reference={<JobReferencePanel order={refOrder} />}
          onClose={() => setOpen(false)}
          onSaved={() => setOpen(false)}
        />
      )}
    </div>
  );
}
