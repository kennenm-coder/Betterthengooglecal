import { WorkOrder } from "./types";

export function searchOrders(orders: WorkOrder[], query: string): WorkOrder[] {
  const q = query.toLowerCase().trim();
  if (!q) return orders;

  return orders.filter((o) => {
    return (
      o.customerName.toLowerCase().includes(q) ||
      o.contactName.toLowerCase().includes(q) ||
      o.workOrderNumber.includes(q) ||
      o.orderNumber.includes(q) ||
      o.address.toLowerCase().includes(q) ||
      o.salesRep.toLowerCase().includes(q) ||
      o.installer.toLowerCase().includes(q) ||
      o.serviceRep.toLowerCase().includes(q) ||
      o.email.toLowerCase().includes(q)
    );
  });
}
