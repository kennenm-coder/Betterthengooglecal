// Client-side export of a field write-up doc: a text PDF of the write-up plus
// all of its photos as image files, bundled into a single .zip. jspdf and jszip
// are dynamically imported so they only load when the user hits Download.

import type { FieldWorkOrder } from "./types";

export interface WriteUpExportInput {
  orderNumber: string;
  customerName: string;
  address: string;
  workOrderNumber: string;
  writeUps: FieldWorkOrder[];
  /** photo path → signed URL (already resolved by the doc page). */
  photoUrls: Record<string, string>;
}

const GOLD: [number, number, number] = [234, 179, 8];
const DARK: [number, number, number] = [26, 26, 26];
const MUTED: [number, number, number] = [110, 110, 110];
const BLACK: [number, number, number] = [17, 17, 17];

function slug(s: string): string {
  return (s || "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "file";
}

/** Downscale a photo blob to a small JPEG data URL for embedding in the PDF. */
async function makeThumb(blob: Blob, maxDim = 520, quality = 0.6): Promise<string | null> {
  if (typeof document === "undefined") return null;
  try {
    const url = URL.createObjectURL(blob);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    URL.revokeObjectURL(url);
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return null;
  }
}

async function buildPdf(input: WriteUpExportInput, thumbs: Map<string, string>): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  const M = 40;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - M * 2;
  let y = M;

  const setColor = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const setFill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);

  function ensure(h: number) {
    if (y + h > pageH - M) {
      doc.addPage();
      y = M;
    }
  }

  function line(
    str: string,
    x: number,
    opts?: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number; align?: "left" | "right" }
  ) {
    const size = opts?.size ?? 10;
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(size);
    setColor(opts?.color ?? BLACK);
    ensure(size + 4);
    doc.text(str, opts?.align === "right" ? x : x, y, { align: opts?.align || "left" });
    y += opts?.gap ?? size + 4;
  }

  function wrapped(str: string, x: number, width: number, opts?: { size?: number; color?: [number, number, number]; bold?: boolean }) {
    const size = opts?.size ?? 10;
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(size);
    setColor(opts?.color ?? BLACK);
    const lines = doc.splitTextToSize(str, width) as string[];
    for (const l of lines) {
      ensure(size + 3);
      doc.text(l, x, y);
      y += size + 3;
    }
  }

  // ── Header ──
  setFill(DARK);
  doc.rect(M, y, contentW, 22, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setColor([255, 255, 255]);
  doc.text("FIELD WORK ORDER — ISSUES TO FIX", M + 8, y + 15);
  y += 32;

  line(input.customerName || "—", M, { size: 14, bold: true });
  if (input.address) line(input.address, M, { size: 10, color: MUTED });
  line(
    `PO# ${input.orderNumber || "—"}${input.workOrderNumber ? `    WO# ${input.workOrderNumber}` : ""}`,
    M,
    { size: 10, color: MUTED }
  );
  const openCount = input.writeUps.filter((w) => w.status !== "closed").length;
  line(
    `${openCount} open issue${openCount !== 1 ? "s" : ""} · ${input.writeUps.length} write-up${input.writeUps.length !== 1 ? "s" : ""}`,
    M,
    { size: 9, color: MUTED, gap: 14 }
  );
  doc.setDrawColor(GOLD[0], GOLD[1], GOLD[2]);
  doc.setLineWidth(2);
  doc.line(M, y, M + contentW, y);
  y += 16;

  // ── Per write-up ──
  for (const w of input.writeUps) {
    ensure(40);
    setFill(DARK);
    doc.rect(M, y, contentW, 18, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    setColor([255, 255, 255]);
    doc.text((w.unitLabel || "Whole job").toUpperCase(), M + 6, y + 12.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    const meta = `${w.createdByName || w.createdBy || ""} · ${new Date(w.createdAt).toLocaleDateString()}${w.status === "closed" ? " · CLOSED" : ""}`;
    doc.text(meta, M + contentW - 6, y + 12.5, { align: "right" });
    y += 26;

    if (w.newProduct) {
      line("ADDED PRODUCT (not in original order)", M, { size: 8, bold: true, color: MUTED, gap: 12 });
      line(`${w.newProduct.type || "—"}${w.newProduct.size ? ` · ${w.newProduct.size}` : ""}`, M, { size: 10, bold: true });
    }

    if (w.lineItems.length > 0) {
      line("WORK TO COMPLETE", M, { size: 8, bold: true, color: MUTED, gap: 12 });
      for (const li of w.lineItems) {
        const mark = li.completed ? "[x]" : "[ ]";
        wrapped(`${mark}  ${li.label}${li.notes ? ` — ${li.notes}` : ""}`, M + 4, contentW - 4, { size: 10 });
      }
    }

    if (w.specChanges.length > 0) {
      line("SPEC CORRECTIONS", M, { size: 8, bold: true, color: MUTED, gap: 12 });
      for (const c of w.specChanges) {
        wrapped(`${c.field}:  ${c.oldValue || "—"}  →  ${c.newValue}`, M + 4, contentW - 4, { size: 10 });
      }
    }

    if (w.notes) {
      line("NOTES", M, { size: 8, bold: true, color: MUTED, gap: 12 });
      wrapped(w.notes, M + 4, contentW - 4, { size: 10 });
    }

    const photoThumbs = w.photos
      .map((p) => thumbs.get(p.path))
      .filter((t): t is string => !!t);
    if (photoThumbs.length > 0) {
      line(`PHOTOS (${w.photos.length}) — full-resolution in the zip`, M, { size: 8, bold: true, color: MUTED, gap: 12 });
      const cols = 4;
      const gap = 6;
      const cw = (contentW - gap * (cols - 1)) / cols;
      let col = 0;
      let rowTop = y;
      let rowH = 0;
      for (let i = 0; i < photoThumbs.length; i++) {
        if (col === 0) {
          ensure(cw + gap); // reserve a row (thumbnails are capped near square)
          rowTop = y;
          rowH = 0;
        }
        const data = photoThumbs[i];
        let iw = cw;
        let ih = cw;
        try {
          const props = doc.getImageProperties(data);
          const aspect = props.height / props.width;
          ih = cw * aspect;
          if (ih > cw) {
            ih = cw;
            iw = cw / aspect;
          }
        } catch {
          /* fall back to square */
        }
        const x = M + col * (cw + gap);
        try {
          doc.addImage(data, "JPEG", x, rowTop, iw, ih);
        } catch {
          /* skip an image jsPDF can't decode */
        }
        rowH = Math.max(rowH, ih);
        col++;
        if (col === cols || i === photoThumbs.length - 1) {
          col = 0;
          y = rowTop + rowH + gap;
        }
      }
    } else if (w.photos.length > 0) {
      line(`Photos: ${w.photos.length} (included in the zip)`, M, { size: 9, color: MUTED });
    }
    y += 8;
  }

  // ── Combined material list ──
  const materials = input.writeUps.flatMap((w) => w.materialItems.map((m) => ({ ...m, unitLabel: w.unitLabel })));
  if (materials.length > 0) {
    ensure(30);
    const cols = [
      { label: "QTY", w: 48 },
      { label: "Unit", w: 48 },
      { label: "Item", w: 130 },
      { label: "Color", w: 78 },
      { label: "Species", w: 66 },
      { label: "Lengths", w: 92 },
      { label: "Vendor", w: contentW - 48 - 48 - 130 - 78 - 66 - 92 },
    ];
    // header row
    setFill(DARK);
    doc.rect(M, y, contentW, 16, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setColor([255, 255, 255]);
    let x = M + 4;
    for (const c of cols) {
      doc.text(c.label.toUpperCase(), x, y + 11);
      x += c.w;
    }
    y += 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    for (const m of materials) {
      ensure(14);
      const cells = [
        `${m.qty} ${m.unit}`,
        m.unitLabel || "—",
        m.item || "—",
        m.color || "—",
        m.species || "—",
        m.lengths || "—",
        m.vendor || "—",
      ];
      x = M + 4;
      for (let i = 0; i < cols.length; i++) {
        setColor(i === 0 ? BLACK : MUTED);
        const clipped = doc.splitTextToSize(String(cells[i]), cols[i].w - 4)[0] as string;
        doc.text(clipped, x, y + 9);
        x += cols[i].w;
      }
      y += 13;
      doc.setDrawColor(230, 230, 230);
      doc.setLineWidth(0.5);
      doc.line(M, y, M + contentW, y);
      y += 2;
    }
  }

  // ── Footer page numbers ──
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setColor(MUTED);
    doc.text(`Field Work Order · #${input.orderNumber}`, M, pageH - 20);
    doc.text(`Page ${i} of ${pages}`, pageW - M, pageH - 20, { align: "right" });
  }

  return doc.output("blob");
}

/** Build the zip (PDF with embedded thumbnails + full-res photos) and hand it to
 *  the browser as a download. Each photo is fetched once: a small thumbnail goes
 *  into the PDF, the original blob goes into the zip. */
export async function downloadWriteUpZip(input: WriteUpExportInput): Promise<void> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const base = `Field-Work-Order-${slug(input.orderNumber)}`;

  // Fetch every photo once; keep the blob (for the zip) and a thumbnail (for the PDF).
  const blobs = new Map<string, Blob>();
  const thumbs = new Map<string, string>();
  for (const w of input.writeUps) {
    for (const p of w.photos) {
      const url = input.photoUrls[p.path];
      if (!url || blobs.has(p.path)) continue;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const blob = await res.blob();
        blobs.set(p.path, blob);
        const thumb = await makeThumb(blob);
        if (thumb) thumbs.set(p.path, thumb);
      } catch {
        /* skip a photo that won't fetch — keep the rest */
      }
    }
  }

  const pdf = await buildPdf(input, thumbs);
  zip.file(`${base}.pdf`, pdf);

  const photos = zip.folder("photos");
  let idx = 0;
  for (const w of input.writeUps) {
    for (const p of w.photos) {
      const blob = blobs.get(p.path);
      if (!blob) continue;
      idx++;
      const name = `${String(idx).padStart(2, "0")}-${slug(w.unitLabel || "whole-job")}-${slug(p.name)}.jpg`;
      photos?.file(name, blob);
    }
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${base}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
