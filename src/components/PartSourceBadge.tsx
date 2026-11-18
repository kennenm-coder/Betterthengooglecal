// ─── WHERE A PART COMES FROM ────────────────────────────────────────────────
// One short, coloured tag per catalog section, so a list that mixes sections
// (write-up photo catalog, parts search, Manage Catalogs) says at a glance which
// catalog each part belongs to. The mapping lives here only — the photo
// catalog, the write-up's parts search and the catalog screen all use it.
//
//   Location Parts -> "Location"  (grey)
//   Renewal Parts  -> "Renewal"   (blue)
//   IQ Parts       -> "IQ"        (violet)
//   anything else  -> its own name, truncated  (teal)
//
// Solid backgrounds with white text (all well past 4.5:1) so the tag reads on
// top of a photo as well as on a plain card, in light and dark.

import { DEFAULT_PART_SECTION } from "@/lib/work-order-store";

const KNOWN: Record<string, { label: string; tone: string }> = {
  [DEFAULT_PART_SECTION]: { label: "Location", tone: "bg-gray-700" },
  "Renewal Parts": { label: "Renewal", tone: "bg-blue-700" },
  "IQ Parts": { label: "IQ", tone: "bg-violet-700" },
};

/** The short label for a section: "Location", "Renewal", "IQ", else its own name. */
export function sourceLabel(section: string | null | undefined): string {
  const s = (section || "").trim() || DEFAULT_PART_SECTION;
  return KNOWN[s]?.label ?? s;
}

/** A small solid tag for a part's section. `corner` pins it to the top-left of
 *  the (relative) photo it sits on; otherwise it flows inline. */
export function PartSourceBadge({
  section,
  corner,
  className = "",
}: {
  section: string | null | undefined;
  corner?: boolean;
  className?: string;
}) {
  const s = (section || "").trim() || DEFAULT_PART_SECTION;
  const tone = KNOWN[s]?.tone ?? "bg-teal-700";
  return (
    <span
      title={s}
      className={`${
        corner ? "absolute top-1.5 left-1.5 max-w-[calc(100%-0.75rem)] z-[1]" : "inline-block max-w-[9rem] align-middle"
      } truncate rounded-full ${tone} px-2 py-0.5 text-[11px] font-bold leading-none normal-case tracking-normal text-white shadow-sm ${className}`}
    >
      {sourceLabel(s)}
    </span>
  );
}
