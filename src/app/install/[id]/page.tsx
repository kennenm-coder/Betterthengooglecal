"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { MaterialJobData, MaterialUnit } from "@/lib/types";
import { getSupabase } from "@/lib/supabase";
import { buildNwoRows, buildBoardSummaryByUnit, fetchCatalogAndOffsets, fetchPOsForJob, NwoRow, BoardSummaryEntry, PurchaseOrder } from "@/lib/nwo-builder";
import { ArrowLeft, Loader2, AlertTriangle, Package, CheckCircle2, Clock, AlertCircle } from "lucide-react";

function fracToString(frac: number): string {
  if (frac === 0.125) return "1/8";
  if (frac === 0.25) return "1/4";
  if (frac === 0.375) return "3/8";
  if (frac === 0.5) return "1/2";
  if (frac === 0.625) return "5/8";
  if (frac === 0.75) return "3/4";
  if (frac === 0.875) return "7/8";
  if (frac === 0) return "";
  return String(frac);
}

function formatSize(u: MaterialUnit): string {
  const w = u.widthWhole + (u.widthFrac ? ` ${fracToString(u.widthFrac)}` : "");
  const h = u.heightWhole + (u.heightFrac ? ` ${fracToString(u.heightFrac)}` : "");
  return `${w}" x ${h}"`;
}

function getAbbrev(u: MaterialUnit): string {
  if (u.abbrev) return u.abbrev;
  if (u.summaryAbbrev) return u.summaryAbbrev;
  const t = u.type || "";
  return t
    .replace(/Double Hung/i, "DH")
    .replace(/Casement/i, "CAS")
    .replace(/Patio Door/i, "PTD")
    .replace(/Picture/i, "PIC")
    .replace(/Sliding/i, "SLD")
    .replace(/Bay/i, "BAY")
    .replace(/Bow/i, "BOW")
    .replace(/Awning/i, "AWN")
    .replace(/Entry Door/i, "ED")
    .replace(/Gliding/i, "GLD")
    .replace(/Screen/i, "SN")
    .replace(/Specialty/i, "SPW");
}

function getExterior(u: MaterialUnit): string {
  return u.exteriorColor || u.summaryExterior || u.extColor || "";
}

function getInterior(u: MaterialUnit): string {
  return u.interiorColor || u.summaryInterior || u.intColor || "";
}

function getIntFinish(u: MaterialUnit): string {
  return u.intFinish || "";
}

function getSubType(u: MaterialUnit): string {
  return u.subType || u.summarySubType || "";
}

function getFrame(u: MaterialUnit): string {
  return u.frame || u.summaryFrameType || "";
}

interface SummaryRow {
  qty: number;
  abbrev: string;
  exterior: string;
  interior: string;
  interiorFinish: string;
  subType: string;
  frame: string;
}

function formatUnitLabels(labels: string[]): string {
  const nums = labels.map(l => parseInt(l)).filter(n => !isNaN(n)).sort((a, b) => a - b);
  const nonNums = labels.filter(l => isNaN(parseInt(l)));
  const ranges: string[] = [];
  let start: number | null = null, end: number | null = null;
  for (const n of nums) {
    if (start === null) { start = end = n; continue; }
    if (n === end! + 1) { end = n; }
    else { ranges.push(start === end ? String(start) : `${start}-${end}`); start = end = n; }
  }
  if (start !== null) ranges.push(start === end ? String(start) : `${start}-${end}`);
  return [...ranges, ...nonNums].join(", ");
}

function buildSummaryRows(units: MaterialUnit[]): SummaryRow[] {
  const grouped = new Map<string, SummaryRow>();
  for (const u of units) {
    if (u.isMisc) continue;
    const abbrev = getAbbrev(u);
    if (!abbrev) continue;
    const ext = getExterior(u);
    const int_ = getInterior(u);
    const fin = getIntFinish(u);
    const frame = getFrame(u);
    const key = [abbrev, ext, int_, fin, frame].join("|").toLowerCase();
    if (!grouped.has(key)) {
      grouped.set(key, {
        qty: u.qty || 1,
        abbrev,
        exterior: ext,
        interior: int_,
        interiorFinish: fin,
        subType: getSubType(u),
        frame,
      });
    } else {
      grouped.get(key)!.qty += u.qty || 1;
    }
  }
  return Array.from(grouped.values());
}

export default function InstallInstructionsPage() {
  const params = useParams();
  const router = useRouter();
  const [job, setJob] = useState<MaterialJobData | null>(null);
  const [nwoRows, setNwoRows] = useState<NwoRow[]>([]);
  const [boardSummary, setBoardSummary] = useState<BoardSummaryEntry[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      if (!supabase || !params.id) {
        setLoading(false);
        return;
      }

      try {
        const [jobRes, catalogData] = await Promise.all([
          supabase.from("jobs").select("id, data").eq("id", params.id).single(),
          fetchCatalogAndOffsets(),
        ]);

        if (!jobRes.error && jobRes.data?.data) {
          const d = jobRes.data.data;
          const jobData: MaterialJobData = {
            id: jobRes.data.id,
            job: d.job || {},
            units: d.units || [],
            globalTrim: d.globalTrim || {},
            submitted: d.submitted ?? false,
            status: d.status || "draft",
            savedAt: d.savedAt || "",
          };
          setJob(jobData);
          setNwoRows(buildNwoRows(d.job || {}, d.units || [], catalogData.catalog, catalogData.offsets));
          setBoardSummary(buildBoardSummaryByUnit(d.job || {}, d.units || [], catalogData.catalog, catalogData.offsets));

          // Fetch PO tracking data for this job
          const pos = await fetchPOsForJob(jobRes.data.id);
          setPurchaseOrders(pos);
        }
      } catch {
        // Network or query failure — job stays null, shows "Job not found"
      }
      setLoading(false);
    }
    load();
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-muted">Job not found</p>
        <button onClick={() => router.back()} className="text-primary underline text-sm">
          Go back
        </button>
      </div>
    );
  }

  const summaryRows = buildSummaryRows(job.units);
  const miscUnits = job.units.filter((u) => u.isMisc && u.approved);
  const totalQty =
    summaryRows.reduce((s, r) => s + r.qty, 0) +
    miscUnits.reduce((s, u) => s + (u.qty || 1), 0);

  const thStyle =
    "px-2.5 py-1.5 text-[10px] font-bold tracking-wider uppercase text-white text-left";
  const tdStyle = "px-2.5 py-2 text-xs border-b border-border";

  return (
    <div className="min-h-screen bg-background">
      {/* Back button */}
      <div className="sticky top-0 bg-background z-20 border-b border-border px-3 py-2">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-primary"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
      </div>

      <div className="max-w-[900px] mx-auto px-4 py-6">
        {/* Header */}
        <div className="border-b-[3px] border-[#6DB344] pb-4 mb-7">
          <div className="flex justify-between items-start">
            <div>
              <div className="text-xs text-muted tracking-widest uppercase">
                Install Instructions
              </div>
              <div className="text-xs text-muted mt-1">
                {job.units.length} unit{job.units.length !== 1 ? "s" : ""}
              </div>
            </div>
            <div className="text-right text-sm leading-relaxed">
              <div className="font-bold text-foreground">{job.job.customerName || "—"}</div>
              <div className="text-muted">{job.job.address || "—"}</div>
              <div className="text-muted">PO# {job.job.poNumber || "—"}</div>
              <div className="text-xs text-muted">
                Tech: {job.job.techMeasurer || "—"} | {job.job.date || "—"}
              </div>
            </div>
          </div>
        </div>

        {/* Install Notes */}
        {(job.job.installNotes || job.job.leadPaint) && (
          <div className="mb-5">
            {job.job.installNotes && (
              <>
                <div className="bg-[#1a1a1a] text-white text-[11px] font-bold tracking-wider uppercase px-3.5 py-1.5">
                  Install Notes
                </div>
                <div className="px-3.5 py-3 text-sm text-foreground whitespace-pre-wrap leading-relaxed border-b-2 border-[#6DB344]">
                  {job.job.installNotes}
                </div>
              </>
            )}
            {job.job.leadPaint && (
              <div className="text-right text-xl font-black text-red-700 mt-1 flex items-center justify-end gap-1">
                <AlertTriangle className="w-5 h-5" />
                LEAD
              </div>
            )}
          </div>
        )}

        {/* PO Tracking Status */}
        {purchaseOrders.length > 0 && (
          <div className="mb-5">
            <div className="bg-[#1a1a1a] text-white text-[11px] font-bold tracking-wider uppercase px-3.5 py-1.5 flex items-center gap-2">
              <Package className="w-3.5 h-3.5" />
              Purchase Orders
            </div>
            <div className="border border-border rounded-b-lg overflow-hidden">
              {purchaseOrders.map((po) => {
                const isReceived = po.status === "received";
                const isPartial = po.status === "partial";
                const isOrdered = po.status === "ordered";
                const isOverdue = po.estimated_arrival_max && new Date(po.estimated_arrival_max) < new Date();
                const itemCount = (po.line_items || []).length;
                const totalLF = (po.line_items || []).reduce((s: number, it: any) => s + (it.total_lf || 0), 0);

                return (
                  <div
                    key={po.id}
                    className={`flex items-center gap-3 px-3.5 py-2.5 border-b border-border last:border-b-0 ${
                      isReceived ? "bg-green-50 dark:bg-green-950/20" :
                      isOverdue ? "bg-red-50 dark:bg-red-950/20" :
                      isPartial ? "bg-amber-50 dark:bg-amber-950/20" :
                      "bg-surface"
                    }`}
                  >
                    {isReceived ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                    ) : isOverdue ? (
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                    ) : (
                      <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold font-mono text-foreground">{po.id}</span>
                        <span className="text-[10px] font-bold text-[#6DB344]">{po.vendor}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          isReceived ? "bg-green-600/15 text-green-700" :
                          isPartial ? "bg-amber-500/15 text-amber-700" :
                          isOverdue ? "bg-red-600/15 text-red-700" :
                          "bg-blue-500/15 text-blue-700"
                        }`}>
                          {isReceived ? "RECEIVED" : isPartial ? "PARTIAL" : isOverdue ? "OVERDUE" : "ORDERED"}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted mt-0.5 flex items-center gap-3 flex-wrap">
                        <span>Ordered {new Date(po.ordered_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                        {isReceived && po.received_at && (
                          <span>Received {new Date(po.received_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                        )}
                        {!isReceived && po.estimated_arrival_min && po.estimated_arrival_max && (
                          <span className={isOverdue ? "text-red-600 font-semibold" : ""}>
                            Expected {new Date(po.estimated_arrival_min).toLocaleDateString("en-US", { month: "short", day: "numeric" })}–{new Date(po.estimated_arrival_max).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            {isOverdue && " ⚠️"}
                          </span>
                        )}
                        <span>{itemCount} item{itemCount !== 1 ? "s" : ""}{totalLF > 0 ? ` • ${totalLF} LF` : ""}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Board Summary by Unit */}
        {boardSummary.length > 0 && (
          <div className="mb-5 bg-[#fafcf8] px-3.5 py-2 text-sm leading-relaxed border-b-2 border-[#6DB344]">
            <strong>Board Summary: </strong>
            {boardSummary.map((entry, i) => (
              <span key={i}>
                {i > 0 && "   "}
                <strong>{formatUnitLabels(entry.unitLabels)}</strong>
                {` — ${entry.sig}`}
              </span>
            ))}
          </div>
        )}

        {/* Unit Summary Table */}
        {(summaryRows.length > 0 || miscUnits.length > 0) && (
          <div className="mb-5 overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-[#1a1a1a]">
                  <th className={thStyle} style={{ width: 50 }}>
                    QTY: {totalQty}
                  </th>
                  <th className={thStyle} style={{ width: 60 }}>
                    Type
                  </th>
                  <th className={thStyle}>Exterior</th>
                  <th className={thStyle}>Interior</th>
                  <th className={thStyle}>Int. Finish</th>
                  <th className={thStyle}>Details</th>
                  <th className={thStyle} style={{ width: 60 }}>
                    Frame
                  </th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((r, i) => (
                  <tr
                    key={i}
                    className={i % 2 === 0 ? "bg-surface" : "bg-background"}
                  >
                    <td className={`${tdStyle} font-bold`}>{r.qty}</td>
                    <td className={tdStyle}>
                      <span className="bg-[#6DB344] text-white text-[11px] font-bold px-1.5 py-0.5 rounded">
                        {r.abbrev}
                      </span>
                    </td>
                    <td className={tdStyle}>{r.exterior || "—"}</td>
                    <td className={tdStyle}>{r.interior || "—"}</td>
                    <td
                      className={`${tdStyle} ${
                        r.interiorFinish ? "text-red-600" : "text-muted"
                      }`}
                    >
                      {r.interiorFinish || "—"}
                    </td>
                    <td className={tdStyle}>{r.subType || "—"}</td>
                    <td className={tdStyle}>{r.frame || "—"}</td>
                  </tr>
                ))}
                {miscUnits.map((u, i) => (
                  <tr key={`misc-${i}`} className="bg-[#f0f8ec] dark:bg-[#2a3a25]">
                    <td className={`${tdStyle} font-bold`}>{u.qty || 1}</td>
                    <td className={tdStyle}>
                      <span className="bg-gray-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                        MISC
                      </span>
                    </td>
                    <td className={tdStyle} colSpan={5}>
                      {u.description || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-b-2 border-[#6DB344]" />
          </div>
        )}

        {/* NWO Material List */}
        {nwoRows.length > 0 && (
          <div className="mb-5 overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-[#1a1a1a]">
                  <th className={thStyle} style={{ width: 55 }}>
                    QTY
                  </th>
                  <th className={thStyle} style={{ width: 60 }}>
                    Unit
                  </th>
                  <th className={thStyle}>Item</th>
                  <th className={thStyle}>Color</th>
                  <th className={thStyle} style={{ width: 90 }}>
                    Species
                  </th>
                  <th className={thStyle}>Lengths</th>
                  <th className={thStyle} style={{ width: 110 }}>
                    Vendor
                  </th>
                </tr>
              </thead>
              <tbody>
                {nwoRows.map((r, i) => (
                  <tr
                    key={i}
                    className={i % 2 === 0 ? "bg-surface" : "bg-background"}
                  >
                    <td className={`${tdStyle} font-bold`}>{r.qty}</td>
                    <td className={`${tdStyle} text-muted`}>{r.unit}</td>
                    <td className={`${tdStyle} font-semibold`}>{r.item || "—"}</td>
                    <td className={`${tdStyle} text-muted`}>{r.color || "—"}</td>
                    <td className={`${tdStyle} text-muted`}>{r.species || "—"}</td>
                    <td className={`${tdStyle} text-muted font-mono text-[11px]`}>{r.lengths || "—"}</td>
                    <td className={`${tdStyle} font-bold text-[#6DB344] text-[11px]`}>{r.vendor || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-b-2 border-[#6DB344]" />
          </div>
        )}

        {/* Prefinish / Warehouse Notes */}
        {(job.job.prefinishNotes || job.job.pfWindowsNeeded) && (
          <div className="mb-5">
            <div className="bg-[#1a1a1a] text-white text-[11px] font-bold tracking-wider uppercase px-3.5 py-1.5">
              Prefinish / Warehouse Notes
            </div>
            {job.job.prefinishNotes && (
              <div className="px-3.5 py-3 text-sm font-bold bg-[rgba(109,179,68,0.15)] border-b border-[#c5e0b4]">
                {job.job.prefinishNotes}
              </div>
            )}
            <div className="px-3.5 py-2.5 text-sm border-b border-border">
              <strong>Windows needing PF:</strong>{" "}
              {job.job.pfWindowsNeeded ? "Yes" : "No"}
              {job.job.pfWindowsNeeded && job.job.pfWindowsList && (
                <span> — {job.job.pfWindowsList}</span>
              )}
            </div>
          </div>
        )}

        {/* Bay Material */}
        {(job.job.bayMaterials || []).length > 0 && (
          <div className="mb-5">
            <div className="bg-[#1a1a1a] text-white text-[11px] font-bold tracking-wider uppercase px-3.5 py-1.5">
              Bay Material
            </div>
            {job.job.bayMaterials!
              .filter((item: any) => item.description)
              .map((item: any, j: number) => (
                <div
                  key={j}
                  className="flex items-center justify-between px-3.5 py-2.5 border-b border-border"
                >
                  <span className="text-sm font-bold">{item.description}</span>
                  <span className="text-sm">{item.quantity}</span>
                </div>
              ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 pt-4 border-t border-border flex justify-between text-xs text-muted">
          <span>Install Instructions | {job.job.address || ""}</span>
          <span>Page 1 / 1</span>
        </div>
      </div>
    </div>
  );
}
