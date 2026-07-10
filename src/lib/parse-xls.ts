import { WorkOrder, PhoneEntry } from "./types";

function normalizePhone(raw: string | null | undefined): string {
  if (!raw || raw.trim() === "") return "";
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

function deduplicatePhones(
  mobile: string | null | undefined,
  home: string | null | undefined,
  business: string | null | undefined
): PhoneEntry[] {
  const seen = new Set<string>();
  const phones: PhoneEntry[] = [];

  const entries: [string, string | null | undefined][] = [
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

function parseDate(raw: string | null | undefined): string | null {
  if (!raw || raw.trim() === "") return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function cell(row: Record<string, string>, key: string): string {
  return decodeHtmlEntities((row[key] ?? "").toString().trim());
}

export function parseXlsHtml(html: string): WorkOrder[] {
  const rows: Record<string, string>[] = [];

  const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return [];

  const tableContent = tableMatch[1];
  const rowMatches = tableContent.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  if (!rowMatches || rowMatches.length < 2) return [];

  const headerRow = rowMatches[0];
  const headers: string[] = [];
  const thMatches = headerRow.match(/<th[^>]*>([\s\S]*?)<\/th>/gi);
  if (thMatches) {
    for (const th of thMatches) {
      const text = th.replace(/<[^>]*>/g, "").trim();
      headers.push(text);
    }
  }

  for (let i = 1; i < rowMatches.length; i++) {
    const tdMatches = rowMatches[i].match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
    if (!tdMatches) continue;
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length && j < tdMatches.length; j++) {
      row[headers[j]] = tdMatches[j].replace(/<[^>]*>/g, "").trim();
    }
    rows.push(row);
  }

  const statusHeaders = headers.filter((h) => h === "Status");
  const secondStatusKey =
    statusHeaders.length > 1 ? "Status" : "Status";

  return rows.map((row, idx): WorkOrder => {
    const tds = Object.values(row);
    const appointmentStatus =
      headers.length > 11 ? (tds[11] ?? "").trim() : cell(row, "Status");

    return {
      id: `${cell(row, "Work Order Number") || idx}`,
      status: cell(row, "Status"),
      orderNumber: cell(row, "Order Number"),
      workOrderNumber: cell(row, "Work Order Number"),
      address: cell(row, "Address"),
      bookingDate: parseDate(cell(row, "Booking Date")),
      customerName: cell(row, "Bill To Contact: Full Name"),
      orderOwner: cell(row, "Order Owner"),
      salesRep: cell(row, "Sales Rep"),
      techMeasure: cell(row, "Primary Tech Measure Name"),
      installer: cell(row, "Primary Installer: Name"),
      serviceRep: cell(row, "Primary Service: Name"),
      appointmentStatus: appointmentStatus || cell(row, "Status"),
      scheduledStart: parseDate(cell(row, "Scheduled Start Time")),
      scheduledEnd: parseDate(cell(row, "Install_Sched_End_Time")),
      contactName: cell(row, "Contact: Full Name"),
      email: cell(row, "Bill to Contact Email"),
      phones: deduplicatePhones(
        cell(row, "Bill to Contact Mobile Phone"),
        cell(row, "Bill to Contact Home Phone"),
        cell(row, "Bill to Contact Business Phone")
      ),
      workOrderType: (cell(row, "Work Order Type") || "Install") as WorkOrder["workOrderType"],
    };
  });
}
