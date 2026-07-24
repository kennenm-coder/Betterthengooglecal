import { WorkOrder, MaterialJobData } from "./types";

export function searchOrders(orders: WorkOrder[], query: string): WorkOrder[] {
  const q = query.toLowerCase().trim();
  if (!q) return orders;

  return orders.filter((o) => {
    try {
      return (
        (o.customerName || "").toLowerCase().includes(q) ||
        (o.contactName || "").toLowerCase().includes(q) ||
        (o.workOrderNumber || "").includes(q) ||
        (o.orderNumber || "").includes(q) ||
        (o.address || "").toLowerCase().includes(q) ||
        (o.salesRep || "").toLowerCase().includes(q) ||
        (o.installer || "").toLowerCase().includes(q) ||
        (o.serviceRep || "").toLowerCase().includes(q) ||
        (o.email || "").toLowerCase().includes(q)
      );
    } catch {
      return false;
    }
  });
}

export function searchMaterialJobs(
  jobs: MaterialJobData[],
  query: string
): MaterialJobData[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  return jobs.filter((j) => {
    try {
      const job = j.job;
      return (
        (job.customerName || "").toLowerCase().includes(q) ||
        (job.poNumber || "").toLowerCase().includes(q) ||
        (job.address || "").toLowerCase().includes(q) ||
        (job.techMeasurer || "").toLowerCase().includes(q) ||
        (job.installNotes || "").toLowerCase().includes(q) ||
        j.units.some((u) => (u.type || u.unitType || "").toLowerCase().includes(q))
      );
    } catch {
      return false;
    }
  });
}
