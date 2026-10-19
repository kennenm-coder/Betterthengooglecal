"use client";

// DEV-ONLY harness for the Staging section. Renders nothing in production
// (NODE_ENV is "production" on Vercel), and the middleware only exempts /dev-*
// from auth in development — so this is inert and unreachable in production.
//
// There is no Supabase and no Orca behind this page. The rows are made up and
// the ticks only move local state, so it is safe to click: nothing here can
// reach the live Inventory 2026 sheet. It exists to answer "what will this
// look like" before migration 039 is applied and the mirror has anything in
// it.

import { useState } from "react";
import { StagingView } from "@/components/StagingSection";
import {
  StagingData,
  StagingRow,
  applyLocal,
  LOADING_NOT_STAGED,
  LOADING_LOADED,
  LOADING_STAGED,
} from "@/lib/orca-staging";
import type { MaterialUnit } from "@/lib/types";
import type { InstallDocRow } from "@/lib/install-doc";

const INVENTORY_SHEET = "sheet-inventory";
const TRIM_SHEET = "sheet-trim";

function row(
  barcode: string,
  description: string,
  loadingStatus: string | null,
  extra: Partial<StagingRow> = {}
): StagingRow {
  return {
    sheetId: INVENTORY_SHEET,
    barcode,
    name: "Abbott,Kelly",
    description,
    soLineItem: null,
    location: null,
    status: "Received",
    loadingStatus,
    installer: null,
    stager: null,
    stagedOut: null,
    ...extra,
  };
}

// A job part way through loading: some out the door, some staged and waiting,
// one the warehouse hasn't released and one that hasn't even arrived.
const SAMPLE: StagingData = {
  units: [
    row("98124444.001", "DH 24 1/2 x 48 White/Pine Stain", LOADING_LOADED, {
      soLineItem: "1",
      location: "Rack B2",
      stager: "Jake",
      installer: "Josh Maas",
      stagedOut: "2026-10-19",
    }),
    row("98124444.002", "DH 24 1/2 x 48 White/Pine Stain", LOADING_LOADED, {
      soLineItem: "2",
      location: "Rack B2",
      stager: "Jake",
      installer: "Josh Maas",
      stagedOut: "2026-10-19",
    }),
    row("98124444.003", "CAS 30 x 60 White/White", LOADING_STAGED, {
      soLineItem: "3",
      location: "Rack B3",
      stager: "Jake",
    }),
    row("98124444.004", "PTD 72 x 80 White/Pine", LOADING_STAGED, {
      soLineItem: "4",
      location: "Floor 1",
      stager: "Tait",
    }),
    row("98124444.005", "PIC 48 x 36 White/White", LOADING_NOT_STAGED, {
      soLineItem: "5",
      location: "Receiving",
    }),
    // The commonest value in the real sheet is blank — nobody has said either
    // way. It must read as "not staged yet" and never be tickable.
    row("98124444.006", "Hardware pack — sash locks", null, {
      soLineItem: "6",
    }),
    row("98124444.007", "AWN 36 x 24 White/White", null, {
      soLineItem: "7",
      status: "Backordered",
    }),
  ],
  trim: [
    row("RBA-04717321-WC-1910261436", "Trim bundle — Woodcraft", LOADING_STAGED, {
      sheetId: TRIM_SHEET,
      name: "04717321 Woodcraft",
      stager: "Greg",
      status: "Stock",
    }),
  ],
  loadedCount: 2,
  totalCount: 8,
};

// Eight units on the job against seven unit rows in the warehouse, and a
// second vendor on the material list with no bundle — so the cross-check has
// something to say. That is the case worth looking at; the all-clear is easy.
const SAMPLE_UNITS = Array.from({ length: 8 }, (_, i) =>
  ({ label: String(101 + i), qty: 1, isMisc: false }) as unknown as MaterialUnit
);

const SAMPLE_NWO: InstallDocRow[] = [
  { qty: 4, unit: "101", item: "Casing", color: "White", species: "Pine", lengths: "8'", vendor: "Woodcraft" },
  { qty: 2, unit: "104", item: "Stool", color: "White", species: "Pine", lengths: "6'", vendor: "Parr" },
];

export default function DevStagingPage() {
  const [staging, setStaging] = useState<StagingData>(SAMPLE);
  const [canWrite, setCanWrite] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function toggle(r: StagingRow, next: boolean) {
    // Fake the round trip so the spinner and the optimistic tick are visible.
    setBusy(r.barcode);
    setMessage(null);
    setStaging((s) => applyLocal(s, r, next));
    setTimeout(() => setBusy(null), 350);
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[900px] mx-auto px-4 py-6">
        <div className="mb-5 rounded-lg border border-amber-500/40 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
          <strong>Dev harness.</strong> Made-up rows, no database, no Orca.
          Ticking moves local state only — nothing here can touch live
          inventory.
        </div>

        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          <button
            onClick={() => setCanWrite((v) => !v)}
            className="rounded border border-border px-2.5 py-1 font-semibold"
          >
            {canWrite ? "Showing: can tick" : "Showing: view only"}
          </button>
          <button
            onClick={() => setStaging(SAMPLE)}
            className="rounded border border-border px-2.5 py-1"
          >
            Reset
          </button>
          <button
            onClick={() =>
              setMessage("The warehouse hasn't staged this one yet.")
            }
            className="rounded border border-border px-2.5 py-1"
          >
            Show an error
          </button>
        </div>

        <StagingView
          staging={staging}
          units={SAMPLE_UNITS}
          nwoRows={SAMPLE_NWO}
          canWrite={canWrite}
          writeReason={canWrite ? null : "not-enabled"}
          busy={busy}
          message={message}
          onToggle={toggle}
        />
      </div>
    </div>
  );
}
