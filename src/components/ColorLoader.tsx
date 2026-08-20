"use client";

import { useEffect } from "react";

const DEFAULTS = {
  install: "#1a73e8",
  service: "#e8710a",
  jsv: "#9334e6",
};

export type WorkOrderColors = typeof DEFAULTS;

const STORAGE_KEY = "rba-wo-colors";

export function getStoredColors(): WorkOrderColors {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function saveColors(colors: WorkOrderColors) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
  applyColors(colors);
}

export function resetColors() {
  localStorage.removeItem(STORAGE_KEY);
  applyColors(DEFAULTS);
}

// Returns "#000000" or "#ffffff" — whichever has better contrast against `hex`.
function contrastText(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = toLinear(parseInt(m[1], 16));
  const g = toLinear(parseInt(m[2], 16));
  const b = toLinear(parseInt(m[3], 16));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Black text stays readable until the background gets fairly light.
  return luminance > 0.45 ? "#000000" : "#ffffff";
}

function applyColors(colors: WorkOrderColors) {
  const root = document.documentElement;
  root.style.setProperty("--install", colors.install);
  root.style.setProperty("--service", colors.service);
  root.style.setProperty("--jsv", colors.jsv);
  root.style.setProperty("--install-text", contrastText(colors.install));
  root.style.setProperty("--service-text", contrastText(colors.service));
  root.style.setProperty("--jsv-text", contrastText(colors.jsv));
}

export { DEFAULTS as DEFAULT_COLORS };

export default function ColorLoader() {
  useEffect(() => {
    applyColors(getStoredColors());
  }, []);

  return null;
}
