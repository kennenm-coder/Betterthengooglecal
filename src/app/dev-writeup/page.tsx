"use client";

// DEV-ONLY test harness for the write-up modal. Renders nothing in production
// (NODE_ENV is "production" on Vercel), and the middleware only exempts /dev-*
// from auth in development — so this is inert and unreachable in production.

import { useState } from "react";
import WriteUpModal from "@/components/WriteUpModal";
import { MaterialUnit } from "@/lib/types";

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
          onClose={() => setOpen(false)}
          onSaved={() => setOpen(false)}
        />
      )}
    </div>
  );
}
