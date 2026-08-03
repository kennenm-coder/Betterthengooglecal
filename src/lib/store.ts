import { WorkOrder, MaterialJobData } from "./types";
import { getSupabase } from "./supabase";

// --- Constants ---

const STORAGE_KEY = "rba-field-cal-data";
const STORAGE_TMP_KEY = "rba-field-cal-data-tmp";
const TIMESTAMP_KEY = "rba-field-cal-updated";
const CACHE_META_KEY = "rba-field-cal-meta";
const VISIBLE_TYPES = ["Install", "Service", "Job Site Visit"];
const PAGE_SIZE = 1000;
const WINDOW_DAYS = 90;

// --- Date utilities ---

function toISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function getInitialWindow(): { start: string; end: string } {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - WINDOW_DAYS);
  start.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(end.getDate() + WINDOW_DAYS);
  end.setHours(23, 59, 59, 999);
  return { start: toISODate(start), end: toISODate(end) };
}

export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => resolve());
    } else {
      setTimeout(resolve, 16);
    }
  });
}

// --- Row mapping ---

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

// --- Bounded offline cache ---

export function saveBoundedCache(allOrders: WorkOrder[]): void {
  if (typeof window === "undefined") return;
  const { start, end } = getInitialWindow();
  const bounded = allOrders.filter((o) => {
    if (!o.scheduledStart) return true;
    return o.scheduledStart >= start && o.scheduledStart <= end;
  });

  const json = JSON.stringify(bounded);
  try {
    localStorage.setItem(STORAGE_TMP_KEY, json);
    const check = localStorage.getItem(STORAGE_TMP_KEY);
    if (!check || check.length !== json.length) {
      localStorage.removeItem(STORAGE_TMP_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, json);
    localStorage.removeItem(STORAGE_TMP_KEY);
    localStorage.setItem(TIMESTAMP_KEY, new Date().toISOString());
    localStorage.setItem(CACHE_META_KEY, JSON.stringify({ start, end }));
  } catch {
    try { localStorage.removeItem(STORAGE_TMP_KEY); } catch { /* noop */ }
  }
}

export function loadBoundedCache(): WorkOrder[] {
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

// Keep old names for backward compatibility
export const saveOrdersLocal = saveBoundedCache;
export const loadOrdersLocal = loadBoundedCache;

// --- Paginated Supabase helpers ---

async function paginatedQuery(
  baseBuilder: () => any,
  signal?: AbortSignal
): Promise<WorkOrderRow[]> {
  const rows: WorkOrderRow[] = [];
  let offset = 0;
  while (true) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const { data, error } = await baseBuilder().range(offset, offset + PAGE_SIZE - 1);
    if (error || !data) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

// --- Phase 1: Initial ±90-day window ---

export async function loadInitialWindow(signal?: AbortSignal): Promise<WorkOrder[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { start, end } = getInitialWindow();
  const rows = await paginatedQuery(
    () =>
      supabase
        .from("work_orders")
        .select("*")
        .gte("scheduled_start", start)
        .lte("scheduled_start", end)
        .in("work_order_type", VISIBLE_TYPES)
        .order("scheduled_start", { ascending: true })
        .order("id", { ascending: true }),
    signal
  );
  return rows.map(rowToWorkOrder);
}

// --- Phase A: Unscheduled work orders ---

export async function loadUnscheduled(signal?: AbortSignal): Promise<WorkOrder[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const rows = await paginatedQuery(
    () =>
      supabase
        .from("work_orders")
        .select("*")
        .is("scheduled_start", null)
        .in("work_order_type", VISIBLE_TYPES)
        .order("id", { ascending: true }),
    signal
  );
  return rows.map(rowToWorkOrder);
}

// --- Phase B: Future beyond initial window ---

export async function loadFutureExtended(
  onPage: (orders: WorkOrder[]) => void,
  signal?: AbortSignal
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const { end } = getInitialWindow();
  let offset = 0;
  while (true) {
    if (signal?.aborted) return;
    await yieldToMain();
    if (signal?.aborted) return;
    const { data, error } = await supabase
      .from("work_orders")
      .select("*")
      .gt("scheduled_start", end)
      .in("work_order_type", VISIBLE_TYPES)
      .order("scheduled_start", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error || !data || data.length === 0) break;
    onPage(data.map(rowToWorkOrder));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
}

// --- Phase C: Historical backlog ---

export async function loadHistorical(
  onPage: (orders: WorkOrder[]) => void,
  signal?: AbortSignal
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const { start } = getInitialWindow();
  let offset = 0;
  while (true) {
    if (signal?.aborted) return;
    await yieldToMain();
    if (signal?.aborted) return;
    const { data, error } = await supabase
      .from("work_orders")
      .select("*")
      .lt("scheduled_start", start)
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

// --- On-demand month loading ---

export async function loadMonth(
  year: number,
  month: number,
  signal?: AbortSignal
): Promise<WorkOrder[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${year}-${pad(month)}-01T00:00:00`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = `${nextYear}-${pad(nextMonth)}-01T00:00:00`;

  const rows = await paginatedQuery(
    () =>
      supabase
        .from("work_orders")
        .select("*")
        .gte("scheduled_start", start)
        .lt("scheduled_start", end)
        .in("work_order_type", VISIBLE_TYPES)
        .order("scheduled_start", { ascending: true })
        .order("id", { ascending: true }),
    signal
  );
  return rows.map(rowToWorkOrder);
}

// --- Merge utility ---

export function mergeOrders(existing: WorkOrder[], incoming: WorkOrder[]): WorkOrder[] {
  const map = new Map<string, WorkOrder>();
  for (const o of existing) map.set(o.id, o);
  for (const o of incoming) map.set(o.id, o);
  return Array.from(map.values());
}

// --- Account-name-only update ---

export async function upsertAccountNames(
  orders: WorkOrder[]
): Promise<{ updated: number; skipped: number }> {
  const supabase = getSupabase();
  if (!supabase) return { updated: 0, skipped: 0 };

  const pairs = orders
    .filter((o) => o.id && o.accountName)
    .map((o) => ({ id: o.id, account_name: o.accountName }));

  let updated = 0;
  let skipped = 0;
  const BATCH = 50;

  for (let i = 0; i < pairs.length; i += BATCH) {
    const chunk = pairs.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      chunk.map((p) =>
        supabase
          .from("work_orders")
          .update({ account_name: p.account_name })
          .eq("id", p.id)
      )
    );
    for (const r of results) {
      if (r.status === "fulfilled" && !r.value.error) {
        updated++;
      } else {
        skipped++;
      }
    }
  }
  return { updated, skipped };
}

// --- Upload / upsert ---

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

// --- Material jobs ---

export async function fetchMaterialJobs(): Promise<Map<string, any>> {
  const jobByPO = new Map<string, any>();
  const supabase = getSupabase();
  if (!supabase) return jobByPO;

  const { data, error } = await supabase.from("jobs").select("id, data");
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

export const saveOrders = saveBoundedCache;
export const loadOrders = loadBoundedCache;
