import { WorkOrder } from "./types";
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  addDays,
  isSameDay,
  format,
  parseISO,
  isWithinInterval,
  differenceInCalendarDays,
} from "date-fns";

function orderSpansDay(order: WorkOrder, date: Date): boolean {
  if (!order.scheduledStart) return false;
  const start = startOfDay(parseISO(order.scheduledStart));
  const end = order.scheduledEnd
    ? startOfDay(parseISO(order.scheduledEnd))
    : start;
  const target = startOfDay(date);
  return target >= start && target <= end;
}

export function getOrdersForDay(orders: WorkOrder[], date: Date): WorkOrder[] {
  return orders.filter((o) => orderSpansDay(o, date));
}

export function getOrdersForWeek(
  orders: WorkOrder[],
  date: Date
): Map<string, WorkOrder[]> {
  const weekStart = startOfWeek(date, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(date, { weekStartsOn: 0 });

  const byDay = new Map<string, WorkOrder[]>();
  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i);
    const key = format(day, "yyyy-MM-dd");
    byDay.set(key, []);
  }

  for (const order of orders) {
    if (!order.scheduledStart) continue;
    for (let i = 0; i < 7; i++) {
      const day = addDays(weekStart, i);
      if (orderSpansDay(order, day)) {
        const key = format(day, "yyyy-MM-dd");
        byDay.get(key)?.push(order);
      }
    }
  }

  return byDay;
}

// For a multi-day order shown on `date`, returns which day of the span this is
// and the total (e.g. { day: 2, total: 5 } -> "Day 2 of 5"). Returns null for
// single-day orders or when the date falls outside the span.
export function multiDayProgress(
  order: WorkOrder,
  date: Date
): { day: number; total: number } | null {
  if (!order.scheduledStart || !order.scheduledEnd) return null;
  const start = startOfDay(parseISO(order.scheduledStart));
  const end = startOfDay(parseISO(order.scheduledEnd));
  const total = differenceInCalendarDays(end, start) + 1;
  if (total <= 1) return null;
  const day = differenceInCalendarDays(startOfDay(date), start) + 1;
  if (day < 1 || day > total) return null;
  return { day, total };
}

export function getHourSlot(order: WorkOrder): number {
  if (!order.scheduledStart) return 8;
  return parseISO(order.scheduledStart).getHours();
}

export function formatTime(iso: string | null): string {
  if (!iso) return "";
  return format(parseISO(iso), "h:mm a");
}

export function formatDateShort(iso: string | null): string {
  if (!iso) return "";
  return format(parseISO(iso), "MMM d, yyyy");
}

// Open a work order in Salesforce. On mobile, deep-link into the Salesforce1
// app (copying the order number to the clipboard as a fallback), then fall back
// to the web console if the app doesn't take over.
export function openSalesforce(workOrderNumber: string, orderNumber: string) {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const webUrl = `https://renewalbyandersen.my.site.com/rForceLEX/s/global-search/${encodeURIComponent(workOrderNumber)}`;

  if (isMobile) {
    navigator.clipboard?.writeText(orderNumber).catch(() => {});
    const appUrl = `salesforce1://search/${encodeURIComponent(workOrderNumber)}`;
    const start = Date.now();
    window.location.href = appUrl;
    setTimeout(() => {
      if (Date.now() - start < 1800) {
        window.open(webUrl, "_blank");
      }
    }, 1500);
  } else {
    window.open(webUrl, "_blank");
  }
}

export function typeColor(type: WorkOrder["workOrderType"]): string {
  switch (type) {
    case "Install":
      return "bg-install";
    case "Service":
      return "bg-service";
    case "Job Site Visit":
      return "bg-jsv";
    default:
      return "bg-primary";
  }
}

// Contrast-aware text color for labels sitting ON the type-colored tile.
// Resolves to black or white via the --*-text CSS vars set in ColorLoader.
export function typeTileText(type: WorkOrder["workOrderType"]): string {
  switch (type) {
    case "Install":
      return "text-install-text";
    case "Service":
      return "text-service-text";
    case "Job Site Visit":
      return "text-jsv-text";
    default:
      return "text-white";
  }
}

export function typeColorText(type: WorkOrder["workOrderType"]): string {
  switch (type) {
    case "Install":
      return "text-install";
    case "Service":
      return "text-service";
    case "Job Site Visit":
      return "text-jsv";
    default:
      return "text-primary";
  }
}
