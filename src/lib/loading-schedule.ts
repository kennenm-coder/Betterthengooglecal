// Loading schedule: from the day's Install appointments, build a crew loading
// list that assigns each crew an Early Bird or Regular loading slot and renders
// it to a downloadable PNG. Early Bird defaults to the crews with the longest
// drive from the home office (they leave earliest), capped at MAX_EARLY_BIRD;
// the field manager can override any crew's slot before generating the image.

import { WorkOrder } from "./types";
import { getOrdersForDay } from "./calendar-utils";
import { format } from "date-fns";

/** Home office — all crews load and leave from here. */
export const HOME_OFFICE = {
  label: "5959 Angola Rd, Toledo, OH 43615",
  lat: 41.62368,
  lng: -83.66904,
};

/** Only 5 crews can load in the early bird slot. */
export const MAX_EARLY_BIRD = 5;

export const SLOT_TIMES = {
  early: "7:15-7:45",
  regular: "7:45-8:15",
};

export type LoadingShift = "early" | "regular";

/** Appointment types that go on the loading sheet — installers run JIPs
 *  (services) the same as installs, so both are included. */
export const LOADING_TYPES = ["Install", "Service"];

export interface LoadingRow {
  /** Work order id — stable key for toggling/removing. */
  id: string;
  /** Work order type ("Install" | "Service") — shown so a service that
   *  shouldn't be loaded can be spotted and removed. */
  type: string;
  /** Crew / installer name. */
  crew: string;
  /** Customer / job name. */
  job: string;
  /** City pulled from the job address (the "Location" column). */
  location: string;
  /** Straight-line miles from the home office, or null if the job has no coords. */
  distanceMi: number | null;
  shift: LoadingShift;
}

// --- Distance ---

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in miles — a stand-in for drive time to rank crews. */
export function haversineMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// --- Address → city ---

/**
 * Pull the city out of a full address string, e.g.
 * "123 Main St, Findlay, OH 45840" → "Findlay". Falls back to the whole string
 * when it isn't in the expected comma-separated shape.
 */
export function extractCity(address: string): string {
  if (!address) return "";
  const parts = address
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  // Typical shape: [street, city, "ST zip", (country?)]. The city is the part
  // right before the one holding the two-letter state abbreviation.
  const stateIdx = parts.findIndex((p) => /^[A-Za-z]{2}\b/.test(p) && /\d/.test(p));
  if (stateIdx > 0) return parts[stateIdx - 1];
  // Fallback: second segment if present, else the first.
  if (parts.length >= 2) return parts[parts.length - 2];
  return parts[0] || "";
}

// --- Build rows ---

/**
 * Build the loading rows for a given day from the loaded work orders. Only
 * Install appointments are included. Rows are sorted furthest-drive first and
 * the top MAX_EARLY_BIRD (that have coordinates) default to the early bird slot.
 */
export function buildLoadingRows(orders: WorkOrder[], date: Date): LoadingRow[] {
  const appts = getOrdersForDay(orders, date).filter((o) =>
    LOADING_TYPES.includes(o.workOrderType)
  );

  const rows: LoadingRow[] = appts.map((o) => {
    const hasCoords = o.latitude != null && o.longitude != null;
    const distanceMi = hasCoords
      ? haversineMiles(HOME_OFFICE, { lat: o.latitude as number, lng: o.longitude as number })
      : null;
    return {
      id: o.id,
      type: o.workOrderType,
      crew: o.installer || o.primaryResource || o.serviceRep || "Unassigned",
      job: o.customerName || "—",
      location: extractCity(o.address),
      distanceMi,
      shift: "regular",
    };
  });

  // Longest drive first; jobs without coordinates sink to the bottom.
  rows.sort((a, b) => {
    if (a.distanceMi == null && b.distanceMi == null) return 0;
    if (a.distanceMi == null) return 1;
    if (b.distanceMi == null) return -1;
    return b.distanceMi - a.distanceMi;
  });

  rows.forEach((r, i) => {
    r.shift = i < MAX_EARLY_BIRD && r.distanceMi != null ? "early" : "regular";
  });

  return rows;
}

export function countEarly(rows: LoadingRow[]): number {
  return rows.filter((r) => r.shift === "early").length;
}

/** Rows in print order: early bird first (furthest first), then regular. */
export function sortedForRender(rows: LoadingRow[]): LoadingRow[] {
  const rank = (r: LoadingRow) => (r.shift === "early" ? 0 : 1);
  return [...rows].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.distanceMi == null && b.distanceMi == null) return 0;
    if (a.distanceMi == null) return 1;
    if (b.distanceMi == null) return -1;
    return b.distanceMi - a.distanceMi;
  });
}

export function scheduleTitle(date: Date): string {
  return `${format(date, "EEEE MMMM do")} Loading Schedule`;
}

// --- PNG rendering ---

/**
 * Draw the loading schedule to a canvas that mirrors the printed sheet:
 * a title, a Crew / Location / Shift table, and the slot-time legend.
 */
export function renderScheduleCanvas(date: Date, rows: LoadingRow[]): HTMLCanvasElement {
  const ordered = sortedForRender(rows);

  // Layout constants (CSS px; scaled up for a crisp export).
  const scale = 2;
  const width = 720;
  const padX = 24;
  const titleH = 44;
  const headerH = 34;
  const rowH = 30;
  const legendH = 64;
  const height = titleH + headerH + rowH * ordered.length + legendH + 16;

  const cols = [
    { key: "crew", label: "Crew", x: padX, align: "left" as const },
    { key: "location", label: "Location", x: width * 0.5, align: "center" as const },
    { key: "shift", label: "Shift", x: width - padX, align: "right" as const },
  ];

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const GOLD = "#c8961e";
  const DARK = "#1a1a1a";
  const GRID = "#d8d8d8";

  // Title
  ctx.fillStyle = DARK;
  ctx.font = "bold 20px Arial, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(scheduleTitle(date), padX, titleH / 2 + 6);

  let y = titleH;

  // Header row
  ctx.fillStyle = GOLD;
  ctx.font = "bold 14px Arial, sans-serif";
  for (const c of cols) {
    ctx.textAlign = c.align;
    ctx.fillText(c.label, c.x, y + headerH / 2);
  }
  y += headerH;

  // Divider under header
  ctx.strokeStyle = DARK;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padX, y);
  ctx.lineTo(width - padX, y);
  ctx.stroke();

  // Data rows
  ctx.font = "13px Arial, sans-serif";
  for (const row of ordered) {
    const early = row.shift === "early";
    ctx.fillStyle = early ? "#7a5a00" : "#333333";
    ctx.font = early ? "bold 13px Arial, sans-serif" : "13px Arial, sans-serif";

    const cy = y + rowH / 2;
    ctx.textAlign = "left";
    ctx.fillText(clip(ctx, row.crew, width * 0.5 - padX - 12), cols[0].x, cy);
    ctx.textAlign = "center";
    ctx.fillText(clip(ctx, row.location, width * 0.42), cols[1].x, cy);
    ctx.textAlign = "right";
    ctx.fillText(early ? "Early Bird" : "Regular", cols[2].x, cy);

    y += rowH;
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(width - padX, y);
    ctx.stroke();
  }

  // Legend
  y += 20;
  ctx.textAlign = "left";
  ctx.fillStyle = DARK;
  ctx.font = "bold 13px Arial, sans-serif";
  ctx.fillText(`Early Bird ${SLOT_TIMES.early}`, padX, y);
  y += 22;
  ctx.fillText(`Regular ${SLOT_TIMES.regular}`, padX, y);

  return canvas;
}

function clip(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) {
    t = t.slice(0, -1);
  }
  return t + "…";
}

/** Render the schedule and hand the PNG to the browser as a download. */
export function downloadSchedulePng(date: Date, rows: LoadingRow[]): void {
  const canvas = renderScheduleCanvas(date, rows);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Loading-Schedule-${format(date, "yyyy-MM-dd")}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}
