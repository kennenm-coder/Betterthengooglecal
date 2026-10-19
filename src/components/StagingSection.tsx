"use client";

import { useCallback, useEffect, useState } from "react";
import { Package, CheckCircle2, AlertTriangle, Loader2, Truck } from "lucide-react";
import type { MaterialUnit } from "@/lib/types";
import type { InstallDocRow } from "@/lib/install-doc";
import {
  applyLocal,
  StagingData,
  StagingRow,
  buildCrossReference,
  fetchStagingForOrder,
  isLoaded,
  isTickable,
  stateLabel,
  LOADING_LOADED,
  LOADING_STAGED,
} from "@/lib/orca-staging";

/**
 * What the warehouse has for this job, and whether it matches the paperwork.
 *
 * Two halves, and the second is the one that catches real mistakes:
 *
 *   Staging      every Orca inventory row for this job, with a tick per row as
 *                the installer loads it. Units and parts from the Inventory
 *                sheet, trim bundles from the Trim sheet.
 *   Cross-check  the install document's unit list and vendors set against those
 *                rows, so a window with nothing in the warehouse shows up here
 *                rather than on the morning of the install.
 *
 * Ticking is view-only unless the server says otherwise: /api/orca/scan
 * answers `canWrite` per login, and writes are off entirely until
 * ORCA_SCAN_TEST_EMAILS names someone. Live warehouse inventory is the thing
 * being protected.
 *
 * The presentation is split out as StagingView so it can be rendered from the
 * /dev-staging harness with sample rows, with no login and no mirror.
 */
export default function StagingSection({
  orderNumber,
  units,
  nwoRows,
}: {
  orderNumber: string;
  units: MaterialUnit[];
  nwoRows: InstallDocRow[];
}) {
  const [staging, setStaging] = useState<StagingData | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [canWrite, setCanWrite] = useState(false);
  const [writeReason, setWriteReason] = useState<string | null>(null);
  const [trimSheetId, setTrimSheetId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(
    async (trimId: string | null) => {
      const result = await fetchStagingForOrder(orderNumber, trimId);
      if (result.kind === "ok") {
        setStaging(result.data);
        setUnavailable(null);
      } else {
        setStaging(null);
        setUnavailable(result.detail);
      }
    },
    [orderNumber]
  );

  useEffect(() => {
    let alive = true;
    async function load() {
      // One call answers both "do I get checkboxes" and "which sheet is trim".
      // Keeping the allowlist server-side means it isn't a client flag.
      let trimId: string | null = null;
      try {
        const res = await fetch("/api/orca/scan");
        if (res.ok) {
          const j = await res.json();
          if (!alive) return;
          setCanWrite(j.canWrite === true);
          setWriteReason(j.reason ?? null);
          trimId = j.trimSheetId ?? null;
          setTrimSheetId(trimId);
        }
      } catch {
        // Offline or not signed in — the list still renders read-only.
      }
      await reload(trimId);
      if (alive) setLoading(false);
    }
    load();
    return () => {
      alive = false;
    };
  }, [reload]);

  async function toggle(row: StagingRow, next: boolean) {
    setBusy(row.barcode);
    setMessage(null);

    // Optimistic, because a phone in a warehouse is not on good wifi. The
    // reload below replaces this with what Orca actually stored.
    setStaging((s) => (s ? applyLocal(s, row, next) : s));

    try {
      const res = await fetch("/api/orca/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetId: row.sheetId, barcode: row.barcode, checked: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setMessage(j.error || "That didn't go through.");
      }
      // Either way, go and see what Orca actually holds. A 409 means the row
      // changed under us — the warehouse moved it while this screen was open.
      await reload(trimSheetId);
    } catch {
      setMessage("No connection — nothing was changed.");
      await reload(trimSheetId);
    }
    setBusy(null);
  }

  if (loading) {
    return (
      <div className="mb-5 flex items-center gap-2 px-3.5 py-3 text-sm text-muted border border-border rounded-lg">
        <Loader2 className="w-4 h-4 animate-spin" />
        Checking the warehouse…
      </div>
    );
  }

  // Three different nothings, and saying "nothing is staged" for any of them
  // would be a lie the installer acts on.
  if (!orderNumber) {
    return (
      <Notice>
        This job has no order number on it, so there is nothing to match against
        the warehouse.
      </Notice>
    );
  }
  if (unavailable) {
    return (
      <Notice>
        The warehouse list isn&apos;t available on this job.
        <span className="block mt-1 text-[11px] font-mono opacity-70">{unavailable}</span>
      </Notice>
    );
  }
  if (!staging || staging.totalCount === 0) {
    return (
      <Notice>
        Nothing in the warehouse is matched to this job yet. That usually means
        the Orca rows for it carry the factory&apos;s job number rather than our
        order number — it does <strong>not</strong> mean nothing has arrived.
      </Notice>
    );
  }

  return (
    <StagingView
      staging={staging}
      units={units}
      nwoRows={nwoRows}
      canWrite={canWrite}
      writeReason={writeReason}
      busy={busy}
      message={message}
      onToggle={toggle}
    />
  );
}

/** The whole section, with the data already in hand. */
export function StagingView({
  staging,
  units,
  nwoRows,
  canWrite,
  writeReason,
  busy,
  message,
  onToggle,
}: {
  staging: StagingData;
  units: MaterialUnit[];
  nwoRows: InstallDocRow[];
  canWrite: boolean;
  writeReason: string | null;
  busy: string | null;
  message: string | null;
  onToggle: (row: StagingRow, next: boolean) => void;
}) {
  const xref = buildCrossReference(units, nwoRows, staging);
  const tickable = [...staging.units, ...staging.trim].filter(isTickable).length;

  return (
    <div className="mb-5">
      <div className="bg-[#1a1a1a] text-white text-[11px] font-bold tracking-wider uppercase px-3.5 py-1.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <Truck className="w-3.5 h-3.5" />
          Staging
        </span>
        <span className="font-mono text-[10px] tracking-normal">
          {staging.loadedCount} of {staging.totalCount} loaded
        </span>
      </div>

      <div className="border border-border border-t-0 rounded-b-lg">
        {/* Why the ticks aren't there, when they aren't. */}
        {!canWrite && writeReason && (
          <div className="px-3.5 py-2 text-[11px] text-muted bg-surface border-b border-border">
            {writeReason === "role"
              ? "View only — your role doesn't scan items out."
              : writeReason === "not-enabled"
                ? "View only — scan-out isn't switched on yet."
                : "View only — your account isn't on the scan-out test list yet."}
          </div>
        )}
        {canWrite && tickable === 0 && (
          <div className="px-3.5 py-2 text-[11px] text-muted bg-surface border-b border-border">
            Nothing here is staged yet, so there is nothing to tick. Staging is
            the warehouse&apos;s call.
          </div>
        )}
        {message && (
          <div className="px-3.5 py-2 text-[11px] text-red-700 bg-red-50 border-b border-border flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {message}
          </div>
        )}

        <RowGroup
          title="Units & parts"
          rows={staging.units}
          canWrite={canWrite}
          busy={busy}
          onToggle={onToggle}
        />
        <RowGroup
          title="Trim"
          rows={staging.trim}
          canWrite={canWrite}
          busy={busy}
          onToggle={onToggle}
        />

        {/* Cross-reference. Counts, not a per-unit match: nothing reliably
            ties an Orca row to one of our units yet, so a claimed match would
            be a guess. A mismatch is still the signal worth acting on. */}
        <div className="px-3.5 py-3 border-t-2 border-[#6DB344] bg-surface">
          <div className="text-[10px] font-bold tracking-wider uppercase text-muted mb-1.5">
            Cross-check against the paperwork
          </div>
          {xref.agrees ? (
            <div className="flex items-center gap-1.5 text-xs text-[#6DB344] font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {xref.docUnitCount} units on the job, {xref.orcaUnitCount} in the
              warehouse, every vendor&apos;s trim accounted for.
            </div>
          ) : (
            <div className="space-y-1 text-xs">
              {xref.docUnitCount !== xref.orcaUnitCount && (
                <div className="flex items-start gap-1.5 text-amber-700">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    The job lists <strong>{xref.docUnitCount}</strong> units; the
                    warehouse has <strong>{xref.orcaUnitCount}</strong>{" "}
                    {xref.orcaUnitCount === 1 ? "row" : "rows"}.{" "}
                    {xref.docUnitCount > xref.orcaUnitCount
                      ? "Something on this job has nothing in the warehouse."
                      : "There is more in the warehouse than the job asks for."}
                  </span>
                </div>
              )}
              {xref.vendorsMissingTrim.length > 0 && (
                <div className="flex items-start gap-1.5 text-amber-700">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    Nothing in the warehouse for trim from{" "}
                    <strong>{xref.vendorsMissingTrim.join(", ")}</strong>.
                  </span>
                </div>
              )}
              {xref.trimWithoutVendor.length > 0 && (
                <div className="flex items-start gap-1.5 text-muted">
                  <Package className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    In the warehouse but not on the material list:{" "}
                    {xref.trimWithoutVendor.join(", ")}.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="bg-[#1a1a1a] text-white text-[11px] font-bold tracking-wider uppercase px-3.5 py-1.5 flex items-center gap-2">
        <Truck className="w-3.5 h-3.5" />
        Staging
      </div>
      <div className="border border-border border-t-0 rounded-b-lg px-3.5 py-3 text-xs text-muted leading-relaxed">
        {children}
      </div>
    </div>
  );
}

function RowGroup({
  title,
  rows,
  canWrite,
  busy,
  onToggle,
}: {
  title: string;
  rows: StagingRow[];
  canWrite: boolean;
  busy: string | null;
  onToggle: (row: StagingRow, next: boolean) => void;
}) {
  if (rows.length === 0) return null;

  return (
    <div>
      <div className="px-3.5 py-1.5 text-[10px] font-bold tracking-wider uppercase text-muted bg-surface border-b border-border">
        {title} ({rows.length})
      </div>
      <div className="divide-y divide-border">
        {rows.map((row) => {
          const loaded = isLoaded(row);
          const tickable = isTickable(row);
          const working = busy === row.barcode;

          return (
            <div
              key={`${row.sheetId}:${row.barcode}`}
              className="flex items-start gap-2.5 px-3.5 py-2.5"
            >
              {/* A row the stager hasn't released is shown but never tickable:
                  not-staged means not ready to leave, and that is the
                  warehouse's call, not the installer's. */}
              <div className="pt-0.5 shrink-0 w-5">
                {working ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted" />
                ) : canWrite && tickable ? (
                  <input
                    type="checkbox"
                    checked={loaded}
                    onChange={(e) => onToggle(row, e.target.checked)}
                    className="w-4 h-4 accent-[#6DB344] cursor-pointer"
                    aria-label={`Mark ${row.description || row.barcode} loaded`}
                  />
                ) : loaded ? (
                  <CheckCircle2 className="w-4 h-4 text-[#6DB344]" />
                ) : (
                  // A circle, not a square: this one is a state marker, not a
                  // control, and a checkbox shape on a phone invites a tap
                  // that will never do anything.
                  <div className="w-4 h-4 rounded-full border border-border" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-foreground truncate">
                  {row.description || row.name || row.barcode}
                </div>
                <div className="text-[11px] text-muted flex flex-wrap gap-x-2.5">
                  {row.soLineItem && <span>Line {row.soLineItem}</span>}
                  {row.location && <span>{row.location}</span>}
                  {row.status && <span>{row.status}</span>}
                  {row.stager && <span>Staged by {row.stager}</span>}
                  {loaded && row.installer && <span>Out with {row.installer}</span>}
                </div>
              </div>

              <StatePill row={row} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatePill({ row }: { row: StagingRow }) {
  const style =
    row.loadingStatus === LOADING_LOADED
      ? "bg-[#6DB344]/15 text-[#4a7d2c]"
      : row.loadingStatus === LOADING_STAGED
        ? "bg-blue-500/15 text-blue-700"
        : "bg-surface text-muted";

  return (
    <span
      className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${style}`}
    >
      {stateLabel(row)}
    </span>
  );
}
