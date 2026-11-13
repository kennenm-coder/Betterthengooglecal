"use client";

import { Layers } from "lucide-react";
import ShownVendorText from "./ShownVendorText";
import { unionOrderVendors, useOrderVendors } from "@/hooks/useOrderVendors";
import { shownVendor } from "@/lib/trim-order-handoff";
import {
  jobMaterialTotal,
  pcsOf,
  splitMaterialLines,
  writeUpRefs,
  type WriteUpSection,
} from "@/lib/writeup-sections";

/**
 * "Total materials for this job" — every open write-up's still-needed trim and
 * parts merged into one list to order from. Shown after the last write-up, and
 * only when the job has more than one: with a single write-up it would just
 * repeat that write-up's own table.
 *
 * Each write-up's table already drops a line once its work is checked off; this
 * total is built from those same still-needed lines, so it drops with them.
 */
export default function JobMaterialTotal({
  sections,
  vendorColor,
  liveVendors = true,
}: {
  sections: WriteUpSection[];
  /** Vendor column color — matches the surrounding view's accent. */
  vendorColor: string;
  /** Look up the trim orders' vendors (false while a list tile is closed). */
  liveVendors?: boolean;
}) {
  const orderVendors = unionOrderVendors(
    useOrderVendors(
      sections.flatMap((s) => s.rows.map((r) => r.orderNumber)),
      liveVendors && sections.length > 1
    )
  );
  if (sections.length < 2) return null;
  const total = jobMaterialTotal(sections);
  if (total.length === 0) return null;
  const { trim, parts } = splitMaterialLines(total);
  const th = "px-2 py-1 text-[9px] font-bold tracking-wider uppercase text-white text-left";
  const td = "px-2 py-1 text-xs border-b border-border";

  return (
    <div className="px-4 py-3 space-y-3 border-t-2 border-border">
      <div>
        <div className="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5" />
          Total materials for this job
        </div>
        <p className="text-[11px] text-muted mt-0.5">
          Everything still to buy across all open write-ups, with matching lines added together. Installed
          work and closed write-ups are left out. W# shows which write-up each line is from.
        </p>
      </div>

      {trim.length > 0 && (
        <div className="overflow-x-auto">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">Trim / material</div>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-[#1a1a1a]">
                {[`QTY: ${pcsOf(trim)}`, "Unit", "Item", "Color", "Species", "Lengths", "Vendor", "From"].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trim.map((m, i) => (
                <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-surface"}>
                  <td className={`${td} font-bold whitespace-nowrap`}>
                    {m.qty} {m.unit}
                  </td>
                  <td className={`${td} text-muted`}>{m.unitLabel || "—"}</td>
                  <td className={`${td} font-semibold`}>{m.item || "—"}</td>
                  <td className={`${td} text-muted`}>{m.color || "—"}</td>
                  <td className={`${td} text-muted`}>{m.species || "—"}</td>
                  <td className={`${td} text-muted font-mono`}>{m.lengths || "—"}</td>
                  <td className={`${td} font-bold`} style={{ color: vendorColor }}>
                    <ShownVendorText shown={shownVendor(m, orderVendors)} />
                  </td>
                  <td className={`${td} text-muted whitespace-nowrap`}>{writeUpRefs(m.writeUps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {parts.length > 0 && (
        <div className="overflow-x-auto">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">Parts</div>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-[#1a1a1a]">
                {[`QTY: ${pcsOf(parts)}`, "Unit", "Part", "Color", "Size", "Part #", "From"].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {parts.map((m, i) => (
                <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-surface"}>
                  <td className={`${td} font-bold whitespace-nowrap`}>
                    {m.qty} {m.unit}
                  </td>
                  <td className={`${td} text-muted`}>{m.unitLabel || "—"}</td>
                  <td className={`${td} font-semibold`}>{m.item || "—"}</td>
                  <td className={`${td} text-muted`}>{m.color || "—"}</td>
                  <td className={`${td} text-muted`}>{m.size || "—"}</td>
                  <td className={`${td} font-mono font-bold`}>{m.partNumber || "—"}</td>
                  <td className={`${td} text-muted whitespace-nowrap`}>{writeUpRefs(m.writeUps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
