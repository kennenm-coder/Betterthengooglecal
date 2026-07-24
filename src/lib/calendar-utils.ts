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
