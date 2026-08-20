"use client";

import { useEffect, useRef, useState } from "react";
import { WorkOrder, MaterialUnit } from "@/lib/types";
import { searchWorkOrders, fetchMaterialJobs } from "@/lib/store";
import { WriteUpTarget } from "./WriteUpModal";
import { X, Search, Loader2, ChevronRight, PenLine, Building2 } from "lucide-react";

interface Props {
  onPick: (target: WriteUpTarget, units: MaterialUnit[]) => void;
  onClose: () => void;
}

/**
 * "Start a write-up" picker. Search any existing job or imported account by
 * customer name, account name, order #, or work order #, and attach a write-up
 * to it — or, when nothing matches, create one manually under whatever details
 * the field manager types.
 */
export default function WriteUpPicker({ onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WorkOrder[]>([]);
  const [searching, setSearching] = useState(false);
  const [manual, setManual] = useState(false);
  const [pickingId, setPickingId] = useState<string | null>(null);
  const jobsRef = useRef<Map<string, unknown> | null>(null);
  const jobsPromiseRef = useRef<Promise<Map<string, unknown>> | null>(null);

  // Warm the material-jobs lookup as soon as the picker opens. It's a heavy
  // fetch (every job's full data blob), so kicking it off in the background
  // means it's usually ready by the time a result is tapped — no long wait on
  // the first pick. Reuse the in-flight promise so we never fetch it twice.
  useEffect(() => {
    if (!jobsPromiseRef.current) {
      jobsPromiseRef.current = fetchMaterialJobs()
        .then((m) => {
          jobsRef.current = m;
          return m;
        })
        .catch(() => new Map<string, unknown>());
    }
  }, []);

  // Manual-entry fields
  const [mName, setMName] = useState("");
  const [mOrder, setMOrder] = useState("");
  const [mWo, setMWo] = useState("");
  const [mAddress, setMAddress] = useState("");

  // Debounced search
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const rows = await searchWorkOrders(q);
      setResults(rows);
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  async function pickOrder(o: WorkOrder) {
    if (pickingId) return; // ignore double-taps while a pick is loading
    setPickingId(o.id);
    // Look up the material job so programmed units show up in the write-up.
    // Await the shared warm-up promise (already in flight since the picker
    // opened) rather than starting a fresh fetch.
    const jobs = jobsRef.current || (jobsPromiseRef.current ? await jobsPromiseRef.current : await fetchMaterialJobs());
    jobsRef.current = jobs;
    const mat = (jobs.get(o.orderNumber) as WorkOrder["materialJob"]) || null;
    const target: WriteUpTarget = {
      orderNumber: o.orderNumber || o.accountName || o.customerName,
      workOrderNumber: o.workOrderNumber || "",
      customerName: o.customerName || o.accountName || "",
      address: o.address || "",
      materialJob: mat,
    };
    onPick(target, mat?.units || []);
  }

  function submitManual() {
    const name = mName.trim();
    if (!name) return;
    const target: WriteUpTarget = {
      orderNumber: mOrder.trim() || name,
      workOrderNumber: mWo.trim(),
      customerName: name,
      address: mAddress.trim(),
      materialJob: null,
    };
    onPick(target, []);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-background w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl h-[90vh] sm:h-auto sm:max-h-[88vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h2 className="text-base font-semibold">
            {manual ? "Manual write-up" : "Start a write-up"}
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface text-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        {manual ? (
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            <p className="text-xs text-muted">
              No job or account on file? Enter what you know — you&apos;ll add the units on the next screen.
            </p>
            <Field label="Customer / account name" value={mName} onChange={setMName} placeholder="e.g. Janet Huffman" autoFocus />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Order / job # (optional)" value={mOrder} onChange={setMOrder} placeholder="04732921" />
              <Field label="Work order # (optional)" value={mWo} onChange={setMWo} />
            </div>
            <Field label="Address (optional)" value={mAddress} onChange={setMAddress} />

            <div className="flex gap-2 pt-2">
              <button onClick={() => setManual(false)} className="flex-1 py-3 rounded-xl border border-border text-sm font-medium">
                Back to search
              </button>
              <button
                onClick={submitManual}
                disabled={!mName.trim()}
                className="flex-1 py-3 rounded-xl bg-amber-500 text-white text-sm font-semibold disabled:opacity-40"
              >
                Start write-up
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="px-4 pt-3 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Customer, account, order #, or WO #…"
                  className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {searching && (
                <div className="flex items-center justify-center py-6 text-muted">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              )}

              {!searching && query.trim().length >= 2 && results.length === 0 && (
                <p className="text-sm text-muted text-center py-4">No matches for “{query.trim()}”.</p>
              )}

              {results.map((o) => {
                const isAccount = o.workOrderType === "Account";
                const title = o.customerName || o.accountName || "—";
                return (
                  <button
                    key={o.id}
                    onClick={() => pickOrder(o)}
                    disabled={pickingId !== null}
                    className="w-full text-left px-3 py-3 rounded-xl border border-border bg-surface flex items-center gap-3 active:bg-background disabled:opacity-60"
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isAccount ? "bg-rba-green/15 text-rba-green" : "bg-primary/15 text-primary"}`}>
                      {isAccount ? <Building2 className="w-4 h-4" /> : <Search className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{title}</p>
                      <p className="text-xs text-muted truncate">
                        {[o.orderNumber && `#${o.orderNumber}`, o.workOrderNumber && `WO ${o.workOrderNumber}`, o.workOrderType, o.address]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    {pickingId === o.id ? (
                      <Loader2 className="w-4 h-4 text-amber-500 shrink-0 animate-spin" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Always-available manual escape hatch */}
            <div className="px-4 py-3 border-t border-border shrink-0">
              <button
                onClick={() => {
                  setMName(query.trim());
                  setManual(true);
                }}
                className="w-full py-3 rounded-xl border-2 border-dashed border-amber-500/50 text-amber-600 text-sm font-semibold flex items-center justify-center gap-2"
              >
                <PenLine className="w-4 h-4" />
                Can&apos;t find it — enter manually
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-muted block mb-1">{label}</label>
      <input
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-400/50"
      />
    </div>
  );
}
