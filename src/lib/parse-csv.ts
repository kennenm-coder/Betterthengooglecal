import { parse } from "csv-parse/sync";
import { WorkOrder, PhoneEntry } from "./types";

// Known column positions — the report has two "Status" columns
// 0  Status (record status, e.g. "Install Scheduled", "Job Closed")
// 1  Order Number
// 2  Work Order Number
// 3  Address
// 4  Booking Date
// 5  Bill To Contact: Full Name
// 6  Order Owner
// 7  Sales Rep
// 8  Primary Tech Measure Name
// 9  Primary Installer: Name
// 10 Primary Service: Name
// 11 Primary Resource Name
// 12 Status (appointment status, e.g. "Scheduled & Assigned", "Appt Complete / Closed")
// 13 Scheduled Start Time
// 14 Install_Sched_End_Time
// 15 Contact: Full Name
// 16 Bill to Contact Email
// 17 Bill to Contact Mobile Phone
// 18 Bill to Contact Home Phone
// 19 Bill to Contact Business Phone
// 20 Service Request Description
// 21 Work Order Type

const COL = {
  RECORD_STATUS: 0,
  ORDER_NUMBER: 1,
  WORK_ORDER_NUMBER: 2,
  ADDRESS: 3,
  BOOKING_DATE: 4,
  CUSTOMER_NAME: 5,
  ORDER_OWNER: 6,
  SALES_REP: 7,
  TECH_MEASURE: 8,
  INSTALLER: 9,
  SERVICE_REP: 10,
  PRIMARY_RESOURCE: 11,
  APPOINTMENT_STATUS: 12,
  SCHEDULED_START: 13,
  SCHEDULED_END: 14,
  CONTACT_NAME: 15,
  EMAIL: 16,
  MOBILE_PHONE: 17,
  HOME_PHONE: 18,
  BUSINESS_PHONE: 19,
  SERVICE_DESCRIPTION: 20,
  WORK_ORDER_TYPE: 21,
} as const;

function val(row: string[], col: number): string {
  return (row[col] ?? "").trim();
}

function parseDate(raw: string): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function normalizePhone(raw: string): string {
  if (!raw) return "";
  return raw.replace(/[\s\-\(\)\.]/g, "");
}

function formatPhone(digits: string): string {
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return digits;
}

function deduplicatePhones(mobile: string, home: string, business: string): PhoneEntry[] {
  const seen = new Set<string>();
  const phones: PhoneEntry[] = [];
  const entries: [string, string][] = [
    ["Mobile", mobile],
    ["Home", home],
    ["Business", business],
  ];
  for (const [label, raw] of entries) {
    const normalized = normalizePhone(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    phones.push({ label, number: formatPhone(normalized) });
  }
  return phones;
}

function validateHeaders(headerRow: string[]): boolean {
  const h = headerRow.map((s) => s.trim().toLowerCase());
  return h.includes("order number") && h.includes("work order number");
}

export function parseCsv(csvText: string): WorkOrder[] {
  const cleaned = csvText.replace(/^﻿/, "");

  let records: string[][];
  try {
    records = parse(cleaned, {
      columns: false,
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
    });
  } catch {
    return [];
  }

  if (records.length < 2) return [];

  const headers = records[0];
  if (!validateHeaders(headers)) return [];

  const dataRows = records.slice(1);
  const orders: WorkOrder[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const woNum = val(row, COL.WORK_ORDER_NUMBER);
    if (!woNum) continue;

    orders.push({
      id: woNum,
      status: val(row, COL.RECORD_STATUS),
      orderNumber: val(row, COL.ORDER_NUMBER),
      workOrderNumber: woNum,
      address: val(row, COL.ADDRESS),
      bookingDate: parseDate(val(row, COL.BOOKING_DATE)),
      customerName: val(row, COL.CUSTOMER_NAME),
      orderOwner: val(row, COL.ORDER_OWNER),
      salesRep: val(row, COL.SALES_REP),
      techMeasure: val(row, COL.TECH_MEASURE),
      installer: val(row, COL.INSTALLER),
      serviceRep: val(row, COL.SERVICE_REP),
      appointmentStatus: val(row, COL.APPOINTMENT_STATUS) || val(row, COL.RECORD_STATUS),
      scheduledStart: parseDate(val(row, COL.SCHEDULED_START)),
      scheduledEnd: parseDate(val(row, COL.SCHEDULED_END)),
      contactName: val(row, COL.CONTACT_NAME),
      email: val(row, COL.EMAIL),
      phones: deduplicatePhones(
        val(row, COL.MOBILE_PHONE),
        val(row, COL.HOME_PHONE),
        val(row, COL.BUSINESS_PHONE)
      ),
      serviceDescription: val(row, COL.SERVICE_DESCRIPTION),
      primaryResource: val(row, COL.PRIMARY_RESOURCE),
      workOrderType: (val(row, COL.WORK_ORDER_TYPE) || "Install") as WorkOrder["workOrderType"],
    });
  }

  return orders;
}
