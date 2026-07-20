import { WorkOrder } from "./types";
import { supabase } from "./supabase";

const STORAGE_KEY = "rba-field-cal-data";
const TIMESTAMP_KEY = "rba-field-cal-updated";

export function saveOrdersLocal(orders: WorkOrder[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
  localStorage.setItem(TIMESTAMP_KEY, new Date().toISOString());
}

export function loadOrdersLocal(): WorkOrder[] {
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

// --- Supabase: work_orders table ---

interface WorkOrderRow {
  id: string;
  order_number: string;
  work_order_number: string;
  status: string;
  appointment_status: string;
  customer_name: string;
  address: string;
  booking_date: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  work_order_type: string;
  order_owner: string;
  sales_rep: string;
  tech_measure: string;
  installer: string;
  service_rep: string;
  contact_name: string;
  email: string;
  phones: any;
  uploaded_at: string;
  updated_at: string;
}

function rowToWorkOrder(row: WorkOrderRow): WorkOrder {
  return {
    id: row.id,
    orderNumber: row.order_number || "",
    workOrderNumber: row.work_order_number || "",
    status: row.status || "",
    appointmentStatus: row.appointment_status || "",
    customerName: row.customer_name || "",
    address: row.address || "",
    bookingDate: row.booking_date,
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    workOrderType: (row.work_order_type as WorkOrder["workOrderType"]) || "Install",
    orderOwner: row.order_owner || "",
    salesRep: row.sales_rep || "",
    techMeasure: row.tech_measure || "",
    installer: row.installer || "",
    serviceRep: row.service_rep || "",
    contactName: row.contact_name || "",
    email: row.email || "",
    phones: row.phones || [],
  };
}

function workOrderToRow(wo: WorkOrder) {
  return {
    id: wo.id,
    order_number: wo.orderNumber,
    work_order_number: wo.workOrderNumber,
    status: wo.status,
    appointment_status: wo.appointmentStatus,
    customer_name: wo.customerName,
    address: wo.address,
    booking_date: wo.bookingDate,
    scheduled_start: wo.scheduledStart,
    scheduled_end: wo.scheduledEnd,
    work_order_type: wo.workOrderType,
    order_owner: wo.orderOwner,
    sales_rep: wo.salesRep,
    tech_measure: wo.techMeasure,
    installer: wo.installer,
    service_rep: wo.serviceRep,
    contact_name: wo.contactName,
    email: wo.email,
    phones: wo.phones,
    updated_at: new Date().toISOString(),
  };
}

export async function loadOrdersFromSupabase(): Promise<WorkOrder[]> {
  const { data, error } = await supabase
    .from("work_orders")
    .select("*")
    .order("scheduled_start", { ascending: true });

  if (error || !data) return [];
  return data.map(rowToWorkOrder);
}

export async function upsertWorkOrders(orders: WorkOrder[]): Promise<boolean> {
  const rows = orders.map(workOrderToRow);
  const { error } = await supabase
    .from("work_orders")
    .upsert(rows, { onConflict: "id" });
  return !error;
}

export async function fetchMaterialJobs(): Promise<Map<string, any>> {
  const { data, error } = await supabase
    .from("jobs")
    .select("id, data");

  const jobByPO = new Map<string, any>();
  if (error || !data) return jobByPO;

  for (const row of data) {
    const d = row.data;
    if (d && d.submitted && d.job?.poNumber) {
      jobByPO.set(d.job.poNumber, {
        id: d.id,
        job: d.job,
        units: d.units || [],
        globalTrim: d.globalTrim || {},
        submitted: d.submitted,
        status: d.status || "submitted",
        savedAt: d.savedAt || "",
      });
    }
  }
  return jobByPO;
}

export function enrichWithMaterials(
  orders: WorkOrder[],
  jobByPO: Map<string, any>
): WorkOrder[] {
  return orders.map((wo) => ({
    ...wo,
    materialJob: jobByPO.get(wo.orderNumber) || null,
  }));
}

// Keep old exports as aliases for backwards compat during migration
export const saveOrders = saveOrdersLocal;
export const loadOrders = loadOrdersLocal;
