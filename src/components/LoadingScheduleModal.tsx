"use client";

import { useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { X, Download, Truck, Sunrise, Info } from "lucide-react";
import { useData } from "./DataProvider";
import {
  LoadingRow,
  buildLoadingRows,
  countEarly,
  sortedForRender,
  downloadSchedulePng,
  scheduleTitle,
  MAX_EARLY_BIRD,
  SLOT_TIMES,
} from "@/lib/loading-schedule";

/** Loading sheets are built the day before, so default to tomorrow. */
function defaultDateISO(): string {
  return format(addDays(new Date(), 1), "yyyy-MM-dd");
}

/** Parse a yyyy-MM-dd input value as a LOCAL date (no UTC shift). */
function parseLocalDate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export default function LoadingScheduleModal({ onClose }: { onClose: () => void }) {
  const { orders } = useData();
  const [dateStr, setDateStr] = useState(defaultDateISO());
  const [rows, setRows] = useState<LoadingRow[] | null>(null);

  const date = useMemo(() => parseLocalDate(dateStr), [dateStr]);

  function generate() {
    setRows(buildLoadingRows(orders, date));
  }

  const earlyCount = rows ? countEarly(rows) : 0;
  const atCap = earlyCount >= MAX_EARLY_BIRD;

  function setShift(id: string, shift: LoadingRow["shift"]) {
    setRows((prev) =>
      prev
        ? prev.map((r) => {
            if (r.id !== id) return r;
            // Block a 6th early bird.
            if (shift === "early" && r.shift !== "early" && countEarly(prev) >= MAX_EARLY_BIRD) {
              return r;
            }
            return { ...r, shift };
          })
        : prev
    );
  }

  const ordered = rows ? sortedForRender(rows) : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-amber-600" />
            <h2 className="text-base font-semibold">Loading Schedule</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface">
            <X className="w-5 h-5 text-muted" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Date + generate */}
          <div className="flex items-end gap-2">
            <label className="flex-1">
              <span className="text-xs text-muted">Install date</span>
              <input
                type="date"
                value={dateStr}
                onChange={(e) => {
                  setDateStr(e.target.value);
                  setRows(null);
                }}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
            </label>
            <button
              onClick={generate}
              className="px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-semibold active:scale-[0.98] transition-transform"
            >
              Generate
            </button>
          </div>

          {rows && rows.length === 0 && (
            <p className="text-sm text-muted text-center py-6">
              No installs scheduled for {format(date, "EEEE, MMM d")}.
            </p>
          )}

          {rows && rows.length > 0 && (
            <>
              <div className="flex items-center gap-2 text-xs text-muted">
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Early bird defaults to the {MAX_EARLY_BIRD} longest drives from the office. Tap a
                  crew&apos;s slot to override.
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{scheduleTitle(date)}</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    atCap
                      ? "bg-amber-500/15 text-amber-600"
                      : "bg-surface text-muted border border-border"
                  }`}
                >
                  {earlyCount}/{MAX_EARLY_BIRD} early bird
                </span>
              </div>

              {/* Rows */}
              <div className="space-y-1.5">
                {ordered.map((r) => {
                  const early = r.shift === "early";
                  const lockRegular = !early && atCap;
                  return (
                    <div
                      key={r.id}
                      className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {early && <Sunrise className="w-3.5 h-3.5 text-amber-600 shrink-0" />}
                          <span className="text-sm font-medium truncate">{r.crew}</span>
                        </div>
                        <div className="text-xs text-muted truncate">
                          {r.job}
                          {r.location ? ` · ${r.location}` : ""}
                          {r.distanceMi != null ? ` · ${Math.round(r.distanceMi)} mi` : " · no location"}
                        </div>
                      </div>
                      <div className="flex rounded-lg overflow-hidden border border-border shrink-0">
                        <button
                          onClick={() => setShift(r.id, "early")}
                          disabled={!early && atCap}
                          className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                            early
                              ? "bg-amber-500 text-white"
                              : lockRegular
                                ? "text-muted/40 cursor-not-allowed"
                                : "text-muted hover:bg-amber-500/10"
                          }`}
                        >
                          Early
                        </button>
                        <button
                          onClick={() => setShift(r.id, "regular")}
                          className={`px-2.5 py-1.5 text-xs font-medium transition-colors border-l border-border ${
                            !early ? "bg-foreground text-background" : "text-muted hover:bg-surface"
                          }`}
                        >
                          Regular
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="text-[11px] text-muted">
                Early Bird {SLOT_TIMES.early} · Regular {SLOT_TIMES.regular}
              </p>
            </>
          )}
        </div>

        {/* Footer */}
        {rows && rows.length > 0 && (
          <div className="p-4 border-t border-border">
            <button
              onClick={() => downloadSchedulePng(date, rows)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-500 text-white text-sm font-semibold active:scale-[0.98] transition-transform"
            >
              <Download className="w-4 h-4" />
              Download PNG
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
