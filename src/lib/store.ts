import { WorkOrder } from "./types";

const STORAGE_KEY = "rba-field-cal-data";
const TIMESTAMP_KEY = "rba-field-cal-updated";

export function saveOrders(orders: WorkOrder[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
  localStorage.setItem(TIMESTAMP_KEY, new Date().toISOString());
}

export function loadOrders(): WorkOrder[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function getLastUpdated(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TIMESTAMP_KEY);
}
