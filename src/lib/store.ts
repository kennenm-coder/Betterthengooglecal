import { WorkOrder, MaterialJobData } from "./types";
import { getSupabase } from "./supabase";

const STORAGE_KEY = "rba-field-cal-data";
const TIMESTAMP_KEY = "rba-field-cal-updated";

export function saveOrdersLocal(orders: WorkOrder[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
    localStorage.setItem(TIMESTAMP_KEY, new Date().toISOString());
  } catch {
    // localStorage quota exceeded — clear stale data and retry once
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
      localStorage.setItem(TIMESTAMP_KEY, new Date().toISOString());
    } catch {
      // Still too large — skip local caching
    }
  }
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
  service_description: string;
  primary_resource: string;
  description: string;
  combined_retail_total: number;
  product_count: number;
  total_units: number;
  windows: number;
  patio_doors: number;
  doors: number;
  order_alerts: string;
  account_name: string;
  uploaded_at: string;
  updated_at: string;
}

function stripUtcSuffix(iso: string | null): string | null {
  if (!iso) return null;
  return iso.replace(/Z$/, "").replace(/[+-]\d{2}:\d{2}$/, "");
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
    scheduledStart: stripUtcSuffix(row.scheduled_start),
    scheduledEnd: stripUtcSuffix(row.scheduled_end),
    workOrderType: row.work_order_type || "Install",
    orderOwner: row.order_owner || "",
    salesRep: row.sales_rep || "",
    techMeasure: row.tech_measure || "",
    installer: row.installer || "",
    serviceRep: row.service_rep || "",
    contactName: row.contact_name || "",
    email: row.email || "",
    phones: row.phones || [],
    serviceDescription: row.service_description || "",
    primaryResource: row.primary_resource || "",
    description: row.description || "",
    combinedRetailTotal: row.combined_retail_total || 0,
    productCount: row.product_count || 0,
    totalUnits: row.total_units || 0,
    windows: row.windows || 0,
    patioDoors: row.patio_doors || 0,
    doors: row.doors || 0,
    orderAlerts: row.order_alerts || "",
    accountName: row.account_name || "",
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
    service_description: wo.serviceDescription || "",
    primary_resource: wo.primaryResource || "",
    description: wo.description || "",
    combined_retail_total: wo.combinedRetailTotal || 0,
    product_count: wo.productCount || 0,
    total_units: wo.totalUnits || 0,
    windows: wo.windows || 0,
    patio_doors: wo.patioDoors || 0,
    doors: wo.doors || 0,
    order_alerts: wo.orderAlerts || "",
    account_name: wo.accountName || "",
    updated_at: new Date().toISOString(),
  };
}

const VISIBLE_TYPES = ["Install", "Service", "Job Site Visit"];
const PAGE_SIZE = 1000;

function startOfCurrentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01T00:00:00`;
}

async function paginatedQuery(
  query: any,
  signal?: AbortSignal
): Promise<WorkOrderRow[]> {
  const rows: WorkOrderRow[] = [];
  let offset = 0;
  while (true) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
    if (error || !data) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

export async function loadCurrentAndFuture(signal?: AbortSignal): Promise<WorkOrder[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const boundary = startOfCurrentMonth();
  const query = supabase
    .from("work_orders")
    .select("*")
    .gte("scheduled_start", boundary)
    .in("work_order_type", VISIBLE_TYPES)
    .order("scheduled_start", { ascending: true })
    .order("id", { ascending: true });

  const rows = await paginatedQuery(query, signal);
  return rows.map(rowToWorkOrder);
}

export async function loadUnscheduled(signal?: AbortSignal): Promise<WorkOrder[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const query = supabase
    .from("work_orders")
    .select("*")
    .is("scheduled_start", null)
    .in("work_order_type", VISIBLE_TYPES)
    .order("id", { ascending: true });

  const rows = await paginatedQuery(query, signal);
  return rows.map(rowToWorkOrder);
}

export async function loadHistorical(
  onPage: (orders: WorkOrder[]) => void,
  signal?: AbortSignal
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const boundary = startOfCurrentMonth();
  let offset = 0;
  while (true) {
    if (signal?.aborted) return;
    const { data, error } = await supabase
      .from("work_orders")
      .select("*")
      .lt("scheduled_start", boundary)
      .in("work_order_type", VISIBLE_TYPES)
      .order("scheduled_start", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error || !data || data.length === 0) break;
    onPage(data.map(rowToWorkOrder));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
}

export function mergeOrders(existing: WorkOrder[], incoming: WorkOrder[]): WorkOrder[] {
  const map = new Map<string, WorkOrder>();
  for (const o of existing) map.set(o.id, o);
  for (const o of incoming) map.set(o.id, o);
  return Array.from(map.values());
}

export async function loadOrdersFromSupabase(): Promise<WorkOrder[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("work_orders")
    .select("*")
    .order("scheduled_start", { ascending: true })
    .range(0, 49999);

  if (error || !data) return [];
  return data.map(rowToWorkOrder);
}

export async function upsertWorkOrders(orders: WorkOrder[]): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;

  const rows = orders.map(workOrderToRow);
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from("work_orders")
      .upsert(chunk, { onConflict: "id" });
    if (error) return false;
  }
  return true;
}

export async function fetchMaterialJobs(): Promise<Map<string, any>> {
  const jobByPO = new Map<string, any>();
  const supabase = getSupabase();
  if (!supabase) return jobByPO;

  const { data, error } = await supabase
    .from("jobs")
    .select("id, data");

  if (error || !data) return jobByPO;

  for (const row of data) {
    try {
      const d = row.data;
      if (d && d.submitted && d.job?.poNumber) {
        const job = d.job;
        jobByPO.set(job.poNumber, {
          id: row.id,
          job: {
            ...job,
            customerName: job.customerName || "",
            address: job.address || "",
            poNumber: job.poNumber || "",
            techMeasurer: job.techMeasurer || "",
            installNotes: job.installNotes || "",
            date: job.date || "",
            prefinishNotes: job.prefinishNotes || "",
            extraMaterials: job.extraMaterials || [],
            additionalMaterials: job.additionalMaterials || [],
            universalFinish: job.universalFinish || "",
          },
          units: d.units || [],
          globalTrim: d.globalTrim || {},
          submitted: d.submitted,
          status: d.status || "submitted",
          savedAt: d.savedAt || "",
        });
      }
    } catch {
      // Skip malformed rows
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

export async function fetchAllMaterialJobs(): Promise<MaterialJobData[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase.from("jobs").select("id, data");

  if (error || !data) return [];

  const jobs: MaterialJobData[] = [];
  for (const row of data) {
    try {
      const d = row.data;
      if (d && d.job?.poNumber) {
        const job = d.job;
        jobs.push({
          id: row.id,
          job: {
            ...job,
            customerName: job.customerName || "",
            address: job.address || "",
            poNumber: job.poNumber || "",
            techMeasurer: job.techMeasurer || "",
            installNotes: job.installNotes || "",
            date: job.date || "",
            prefinishNotes: job.prefinishNotes || "",
            extraMaterials: job.extraMaterials || [],
            additionalMaterials: job.additionalMaterials || [],
            universalFinish: job.universalFinish || "",
          },
          units: d.units || [],
          globalTrim: d.globalTrim || {},
          submitted: d.submitted ?? false,
          status: d.status || "draft",
          savedAt: d.savedAt || "",
        });
      }
    } catch {
      // Skip malformed rows
    }
  }
  return jobs;
}

export const saveOrders = saveOrdersLocal;
export const loadOrders = loadOrdersLocal;
