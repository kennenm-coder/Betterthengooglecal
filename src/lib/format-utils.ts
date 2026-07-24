import { WorkOrder } from "./types";

export function lastFirst(fullName: string): string {
  if (!fullName) return "";
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return fullName;
  const last = parts[parts.length - 1];
  const first = parts.slice(0, -1).join(" ");
  return `${last}, ${first}`;
}

export function crewName(order: WorkOrder): string {
  return order.primaryResource || "";
}

export function sortByNameAlpha(orders: WorkOrder[]): WorkOrder[] {
  return [...orders].sort((a, b) =>
    lastFirst(a.customerName).localeCompare(lastFirst(b.customerName))
  );
}
