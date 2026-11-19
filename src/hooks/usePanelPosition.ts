"use client";

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

const MARGIN = 8;
const GAP = 6;

/**
 * Where a drop-down panel under a header button goes so it stays ON SCREEN.
 *
 * The header's bell and inbox buttons aren't at the right edge, so a panel
 * pinned to the button's right side and stretched left ran off the left of a
 * phone. This measures the button and the screen when the panel opens (and
 * on resize / rotate): the panel sits just under the button, as wide as
 * `maxWidth` or the screen allows, slid left or right to keep an 8px margin
 * both sides, and no taller than the room left below it. Hidden until placed
 * so it never flashes at the top-left.
 */
export function usePanelPosition(
  anchor: RefObject<HTMLElement | null>,
  open: boolean,
  maxWidth: number
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ position: "fixed", visibility: "hidden" });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(vw - MARGIN * 2, maxWidth);
      const left = Math.min(Math.max(MARGIN, r.right - width), vw - width - MARGIN);
      const top = r.bottom + GAP;
      setStyle({ position: "fixed", top, left, width, maxHeight: Math.max(160, vh - top - MARGIN * 2) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor, open, maxWidth]);

  return style;
}
