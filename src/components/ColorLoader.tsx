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

function applyColors(colors: WorkOrderColors) {
  const root = document.documentElement;
  root.style.setProperty("--install", colors.install);
  root.style.setProperty("--service", colors.service);
  root.style.setProperty("--jsv", colors.jsv);
}

export { DEFAULTS as DEFAULT_COLORS };

export default function ColorLoader() {
  useEffect(() => {
    applyColors(getStoredColors());
  }, []);

  return null;
}
