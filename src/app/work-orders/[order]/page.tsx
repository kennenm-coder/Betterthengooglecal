"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FieldWorkOrder } from "@/lib/types";
import { fetchWriteUpsForOrder, getSignedPhotoUrl, writeUpsToPlainText } from "@/lib/work-order-store";
import { groupWriteUpSections, padSeq } from "@/lib/writeup-sections";
import { downloadWriteUpZip } from "@/lib/writeup-export";
import { useAuth } from "@/hooks/useAuth";
import { canSeeWriteUps } from "@/lib/roles";
import { ArrowLeft, Loader2, Printer, Wrench, Download, Copy, Check } from "lucide-react";
import { format, parseISO } from "date-fns";

// Work-order accent — the install-instructions doc's green (#6DB344) reskinned
// to gold so the doc reads as "issues to fix", not a new install.
const ACCENT = "#EAB308"; // borders / badges / fills
const ACCENT_TEXT = "#A16207"; // small text (vendor, etc.) for print contrast

export default function WorkOrderDocPage() {
  const params = useParams();
  const router = useRouter();
  const { role, loading: authLoading } = useAuth();
  const [writeUps, setWriteUps] = useState<FieldWorkOrder[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);

  const orderNumber = decodeURIComponent(String(params.order || ""));
  // Soft rollout: only admin + field-manager can view a write-up doc.
  const canView = canSeeWriteUps(role);

  useEffect(() => {
    if (!orderNumber || authLoading || !canView) return;
    fetchWriteUpsForOrder(orderNumber).then(async (w) => {
      // Newest issues first, whole-job entries last.
      w.sort((a, b) => (a.unitLabel || "~").localeCompare(b.unitLabel || "~"));
      setWriteUps(w);
      setLoading(false);

      // Resolve signed URLs for all photos (private bucket).
      const paths = w.flatMap((x) => x.photos.map((p) => p.path));
      const entries = await Promise.all(
        paths.map(async (path) => [path, (await getSignedPhotoUrl(path)) || ""] as const)
      );
      setPhotoUrls(Object.fromEntries(entries.filter(([, u]) => u)));
    });
  }, [orderNumber, authLoading, canView]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3 px-6 text-center">
        <p className="text-muted">Field write-ups aren&apos;t available for your account.</p>
        <button onClick={() => router.push("/")} className="text-primary underline text-sm">
          Back to calendar
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (writeUps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3">
        <p className="text-muted">No write-ups found for #{orderNumber}</p>
        <button onClick={() => router.back()} className="text-primary underline text-sm">
          Go back
        </button>
      </div>
    );
  }

  const first = writeUps[0];
  const sections = groupWriteUpSections(writeUps);
  const openCount = writeUps.filter((w) => w.status !== "closed").length;

  async function handleCopy() {
    const text = writeUpsToPlainText(writeUps);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* give up silently */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadWriteUpZip({
        orderNumber: first.orderNumber || orderNumber,
        customerName: first.customerName || "",
        address: first.address || "",
        workOrderNumber: first.workOrderNumber || "",
        writeUps,
        photoUrls,
      });
    } catch {
      alert("Sorry — the download couldn't be built. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  const thStyle = "px-2.5 py-1.5 text-[10px] font-bold tracking-wider uppercase text-white text-left";
  const tdStyle = "px-2.5 py-2 text-xs border-b border-border";

  return (
    <div className="min-h-screen bg-background">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body, .min-h-screen { background: white !important; }
          * { color-adjust: exact; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      {/* Top bar */}
      <div className="no-print sticky top-0 bg-background z-20 border-b border-border px-3 py-2 flex items-center justify-between">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-primary">
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border disabled:opacity-60"
            style={{ borderColor: copied ? "#16a34a" : ACCENT_TEXT, color: copied ? "#16a34a" : ACCENT_TEXT }}
            title="Copy write-up text for the internal system"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border disabled:opacity-60"
            style={{ borderColor: ACCENT_TEXT, color: ACCENT_TEXT }}
            title="Download the write-up PDF and all photos as a zip"
          >
            {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {downloading ? "Preparing…" : "Download"}
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 text-sm font-medium text-white px-3 py-1.5 rounded-lg"
            style={{ background: ACCENT_TEXT }}
          >
            <Printer className="w-4 h-4" />
            Print
          </button>
        </div>
      </div>

      <div className="max-w-[900px] mx-auto px-4 py-6">
        {/* Header */}
        <div className="pb-4 mb-6" style={{ borderBottom: `3px solid ${ACCENT}` }}>
          <div className="flex justify-between items-start">
            <div>
              <div
                className="inline-flex items-center gap-1.5 text-white text-xs font-bold tracking-widest uppercase px-2 py-1 rounded"
                style={{ background: ACCENT_TEXT }}
              >
                <Wrench className="w-3.5 h-3.5" />
                Field Work Order
              </div>
              <div className="text-xs text-muted mt-2">
                {openCount} open issue{openCount !== 1 ? "s" : ""} · {sections.length} write-up
                {sections.length !== 1 ? "s" : ""}
              </div>
              <div className="text-[11px] font-semibold mt-1" style={{ color: ACCENT_TEXT }}>
                ISSUES TO FIX — NOT A NEW INSTALL
              </div>
            </div>
            <div className="text-right text-sm leading-relaxed">
              <div className="font-bold text-foreground">{first.customerName || "—"}</div>
              <div className="text-muted">{first.address || "—"}</div>
              <div className="text-muted">PO# {first.orderNumber || "—"}</div>
              {first.workOrderNumber && (
                <div className="text-xs text-muted">WO# {first.workOrderNumber}</div>
              )}
            </div>
          </div>
        </div>

        {/* One block per write-up submission — same order as the new-write-up screen */}
        {sections.map((sec) => {
          // Whole-job note → what's wrong / financing / paint (matches the create flow).
          let background = "";
          let financing = "";
          let paint = "";
          const unitNotes: { unitLabel: string | null; text: string }[] = [];
          for (const n of sec.notes) {
            if (n.unitLabel) {
              unitNotes.push(n);
              continue;
            }
            const rest: string[] = [];
            for (const seg of n.text.split("\n\n")) {
              if (seg.startsWith("Financing notes: ")) financing = seg.slice("Financing notes: ".length);
              else if (seg.startsWith("Paint & stain notes: ")) paint = seg.slice("Paint & stain notes: ".length);
              else rest.push(seg);
            }
            const bg = rest.join("\n\n").trim();
            if (bg) background = background ? `${background}\n\n${bg}` : bg;
          }
          const lbl = "text-[10px] font-bold uppercase tracking-wide text-muted mb-1";
          return (
          <div key={sec.key} className="mb-8">
            {/* Section header */}
            <div
              className="text-white text-[11px] font-bold tracking-wider uppercase px-3.5 py-1.5 flex items-center justify-between"
              style={{ background: "#1a1a1a" }}
            >
              <span>Write-up {sec.index} of {sections.length}</span>
              <span className="opacity-80 normal-case font-medium">
                {sec.createdByName} · {format(parseISO(sec.createdAt), "M/d/yy")}
                {sec.updatedByName ? ` · edited ${format(parseISO(sec.updatedAt), "M/d/yy")} by ${sec.updatedByName}` : ""}
                {sec.status === "closed" ? " · CLOSED" : ""}
              </span>
            </div>
            <div className="border-b-2 px-3.5 py-3 space-y-3" style={{ borderColor: ACCENT }}>
              {/* 1. What's wrong + financing/paint + unit notes */}
              {background && (
                <div>
                  <div className={lbl}>What&apos;s wrong</div>
                  <div className="text-sm whitespace-pre-wrap">{background}</div>
                </div>
              )}
              {financing && (
                <div>
                  <div className={lbl}>Financing notes</div>
                  <div className="text-sm">{financing}</div>
                </div>
              )}
              {paint && (
                <div>
                  <div className={lbl}>Paint &amp; stain notes</div>
                  <div className="text-sm">{paint}</div>
                </div>
              )}
              {unitNotes.map((n, i) => (
                <div key={i} className="text-sm text-foreground whitespace-pre-wrap">
                  <span className={`${lbl} block`}>{n.unitLabel} note</span>
                  {n.text}
                </div>
              ))}

              {/* 2. Units affected — added products + spec corrections */}
              {sec.newProducts.map((np, i) => (
                <div key={i}>
                  <div className={lbl}>
                    Added product (not in original order){np.unitLabel ? ` · ${np.unitLabel}` : ""}
                  </div>
                  <div className="text-sm">
                    <span className="font-bold">{np.product.type || "—"}</span>
                    {np.product.size ? ` · ${np.product.size}` : ""}
                  </div>
                  <div className="text-xs text-muted">
                    {[
                      np.product.exteriorColor && `Ext: ${np.product.exteriorColor}`,
                      np.product.interiorColor && `Int: ${np.product.interiorColor}`,
                      np.product.intFinish && `Finish: ${np.product.intFinish}`,
                      np.product.details,
                      np.product.frame && `Frame: ${np.product.frame}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
              ))}
              {sec.specChanges.length > 0 && (
                <div>
                  <div className={lbl}>Spec corrections</div>
                  {sec.specChanges.map((c, i) => (
                    <div key={i} className="text-sm">
                      <span className="text-muted">
                        {c.unitLabel ? `${c.unitLabel} · ` : ""}
                        {c.field}:
                      </span>{" "}
                      <span className="line-through text-muted">{c.oldValue || "—"}</span>
                      {" → "}
                      <span className="font-semibold" style={{ color: ACCENT_TEXT }}>
                        {c.newValue}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* 3. Work to complete — numbered, completed items collected below */}
              {(sec.outstanding.length > 0 || sec.completed.length > 0) && (
                <div>
                  <div className={lbl}>Work to complete</div>
                  {sec.outstanding.length > 0 ? (
                    <ul className="space-y-1.5">
                      {sec.outstanding.map((it) => (
                        <li key={it.seq} className="text-sm flex items-start gap-2">
                          <span className="font-mono text-xs font-bold shrink-0 mt-0.5" style={{ color: ACCENT_TEXT }}>
                            {padSeq(it.seq)}
                          </span>
                          <span className="flex-1">
                            {it.label}
                            {it.units.length > 0 && <span className="text-muted"> — {it.units.join(", ")}</span>}
                            {it.notes && <span className="block text-xs text-muted">{it.notes}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-green-700 font-medium">All work completed ✓</p>
                  )}
                  {sec.completed.length > 0 && (
                    <div className="mt-3 pt-2 border-t border-border">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-green-700 mb-1">
                        Completed
                      </div>
                      <ul className="space-y-1">
                        {sec.completed.map((it) => (
                          <li key={it.seq} className="text-sm flex items-start gap-2 text-muted">
                            <span className="font-mono text-xs font-bold shrink-0 mt-0.5">{padSeq(it.seq)}</span>
                            <span className="text-green-700 shrink-0">✓</span>
                            <span className="line-through flex-1">
                              {it.label}
                              {it.units.length > 0 ? ` — ${it.units.join(", ")}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 4. This write-up's own material / trim list */}
            {sec.materials.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr style={{ background: "#1a1a1a" }}>
                      <th className={thStyle} style={{ width: 55 }}>
                        QTY: {sec.totalPcs}
                      </th>
                      <th className={thStyle} style={{ width: 55 }}>
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
                    {sec.materials.map((m, i) => (
                      <tr key={i} className={i % 2 === 0 ? "bg-surface" : "bg-background"}>
                        <td className={`${tdStyle} font-bold`}>
                          {m.qty} {m.unit}
                        </td>
                        <td className={`${tdStyle} text-muted`}>{m.unitLabel || "—"}</td>
                        <td className={`${tdStyle} font-semibold`}>{m.item || "—"}</td>
                        <td className={`${tdStyle} text-muted`}>{m.color || "—"}</td>
                        <td className={`${tdStyle} text-muted`}>{m.species || "—"}</td>
                        <td className={`${tdStyle} text-muted font-mono text-[11px]`}>{m.lengths || "—"}</td>
                        <td className={`${tdStyle} font-bold text-[11px]`} style={{ color: ACCENT_TEXT }}>
                          {m.vendor || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="border-b-2" style={{ borderColor: ACCENT }} />
              </div>
            )}

            {/* 5. Photos */}
            {sec.photos.length > 0 && (
              <div className="mt-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">
                  Photos ({sec.photos.length})
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {sec.photos.map((p) => (
                    <a
                      key={p.path}
                      href={photoUrls[p.path] || undefined}
                      target="_blank"
                      rel="noreferrer"
                      title={p.name}
                      className="block aspect-square rounded-lg overflow-hidden border border-border bg-surface"
                    >
                      {photoUrls[p.path] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photoUrls[p.path]} alt={p.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="flex items-center justify-center w-full h-full text-[10px] text-muted">
                          {p.name}
                        </span>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
          );
        })}

        {/* Footer */}
        <div className="mt-8 pt-4 border-t border-border flex justify-between text-xs text-muted">
          <span>Field Work Order | {first.address || ""}</span>
          <span>#{first.orderNumber}</span>
        </div>
      </div>
    </div>
  );
}
