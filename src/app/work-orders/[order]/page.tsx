"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FieldWorkOrder } from "@/lib/types";
import { fetchWriteUpsForOrder, getSignedPhotoUrl, writeUpsToPlainText } from "@/lib/work-order-store";
import { downloadWriteUpZip } from "@/lib/writeup-export";
import { useAuth } from "@/hooks/useAuth";
import { ArrowLeft, Loader2, Printer, Wrench, Download, Copy, Check } from "lucide-react";
import { format, parseISO } from "date-fns";

// Work-order accent — the install-instructions doc's green (#6DB344) reskinned
// to gold so the doc reads as "issues to fix", not a new install.
const ACCENT = "#EAB308"; // borders / badges / fills
const ACCENT_TEXT = "#A16207"; // small text (vendor, etc.) for print contrast

export default function WorkOrderDocPage() {
  const params = useParams();
  const router = useRouter();
  const { loading: authLoading } = useAuth();
  const [writeUps, setWriteUps] = useState<FieldWorkOrder[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);

  const orderNumber = decodeURIComponent(String(params.order || ""));
  // Everyone allowlisted can view a write-up doc (read/print/download).

  useEffect(() => {
    if (!orderNumber) return;
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
  }, [orderNumber]);

  if (authLoading || loading) {
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
  const materials = writeUps.flatMap((w) =>
    w.materialItems.map((m) => ({ ...m, unitLabel: w.unitLabel }))
  );
  const totalPcs = materials.reduce((s, m) => s + (m.qty || 0), 0);
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
                {openCount} open issue{openCount !== 1 ? "s" : ""} · {writeUps.length} write-up
                {writeUps.length !== 1 ? "s" : ""}
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

        {/* Per write-up: work to complete + spec corrections + notes */}
        {writeUps.map((w) => (
          <div key={w.id} className="mb-5">
            <div
              className="text-white text-[11px] font-bold tracking-wider uppercase px-3.5 py-1.5 flex items-center justify-between"
              style={{ background: "#1a1a1a" }}
            >
              <span>{w.unitLabel || "Whole job"}</span>
              <span className="opacity-80 normal-case font-medium">
                {w.createdByName || w.createdBy} · {format(parseISO(w.createdAt), "M/d/yy")}
                {w.updatedBy && Math.abs(+parseISO(w.updatedAt) - +parseISO(w.createdAt)) > 60000
                  ? ` · edited ${format(parseISO(w.updatedAt), "M/d/yy")} by ${w.updatedByName || w.updatedBy}`
                  : ""}
                {w.status === "closed" ? " · CLOSED" : ""}
              </span>
            </div>
            <div className="border-b-2 px-3.5 py-3 space-y-2" style={{ borderColor: ACCENT }}>
              {w.newProduct && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">
                    Added product (not in original order)
                  </div>
                  <div className="text-sm">
                    <span className="font-bold">{w.newProduct.type || "—"}</span>
                    {w.newProduct.size ? ` · ${w.newProduct.size}` : ""}
                  </div>
                  <div className="text-xs text-muted">
                    {[
                      w.newProduct.exteriorColor && `Ext: ${w.newProduct.exteriorColor}`,
                      w.newProduct.interiorColor && `Int: ${w.newProduct.interiorColor}`,
                      w.newProduct.intFinish && `Finish: ${w.newProduct.intFinish}`,
                      w.newProduct.details && w.newProduct.details,
                      w.newProduct.frame && `Frame: ${w.newProduct.frame}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
              )}
              {w.lineItems.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">
                    Work to complete
                  </div>
                  <ul className="space-y-1">
                    {w.lineItems.map((li, i) => (
                      <li key={i} className="text-sm flex items-start gap-2">
                        {li.completed ? (
                          <span className="mt-0.5 text-[13px] leading-none text-green-700 shrink-0">✓</span>
                        ) : (
                          <span
                            className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ background: ACCENT }}
                          />
                        )}
                        <span className={li.completed ? "line-through text-muted" : ""}>{li.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {w.specChanges.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">
                    Spec corrections
                  </div>
                  {w.specChanges.map((c, i) => (
                    <div key={i} className="text-sm">
                      <span className="text-muted">{c.field}:</span>{" "}
                      <span className="line-through text-muted">{c.oldValue || "—"}</span>
                      {" → "}
                      <span className="font-semibold" style={{ color: ACCENT_TEXT }}>
                        {c.newValue}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {w.notes && (
                <div className="text-sm text-foreground whitespace-pre-wrap">{w.notes}</div>
              )}

              {w.photos.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">
                    Photos ({w.photos.length})
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {w.photos.map((p) => (
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

              {w.lineItems.length === 0 &&
                w.specChanges.length === 0 &&
                !w.notes &&
                !w.newProduct &&
                w.photos.length === 0 && (
                  <div className="text-sm text-muted">See material list below.</div>
                )}
            </div>
          </div>
        ))}

        {/* Combined material / trim list — install-instructions style, gold */}
        {materials.length > 0 && (
          <div className="mb-5 overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr style={{ background: "#1a1a1a" }}>
                  <th className={thStyle} style={{ width: 55 }}>
                    QTY: {totalPcs}
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
                {materials.map((m, i) => (
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

        {/* Footer */}
        <div className="mt-8 pt-4 border-t border-border flex justify-between text-xs text-muted">
          <span>Field Work Order | {first.address || ""}</span>
          <span>#{first.orderNumber}</span>
        </div>
      </div>
    </div>
  );
}
