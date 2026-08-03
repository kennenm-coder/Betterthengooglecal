import { parse } from "csv-parse/sync";

export interface AccountRow {
  account_name: string;
  order_number: string;
  address: string;
  job_close_date: string;
}

const COL = {
  ACCOUNT_NAME: 0,
  ORDER_NUMBER: 1,
  ADDRESS: 2,
  JOB_CLOSE_DATE: 3,
} as const;

function val(row: string[], col: number): string {
  return (row[col] ?? "").trim();
}

function parseDate(raw: string): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function validateHeaders(headerRow: string[]): boolean {
  const h = headerRow.map((s) => s.trim().toLowerCase());
  return h.includes("account name") && h.includes("address");
}

export function isAccountsCsv(csvText: string): boolean {
  const firstLine = csvText.split("\n")[0] || "";
  const lower = firstLine.toLowerCase();
  return (
    lower.includes("account name") &&
    !lower.includes("work order number")
  );
}

export function parseAccountsCsv(csvText: string): AccountRow[] {
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
  const accounts: AccountRow[] = [];

  for (const row of dataRows) {
    const accountName = val(row, COL.ACCOUNT_NAME);
    const address = val(row, COL.ADDRESS);
    if (!accountName && !address) continue;

    accounts.push({
      account_name: accountName,
      order_number: val(row, COL.ORDER_NUMBER),
      address,
      job_close_date: parseDate(val(row, COL.JOB_CLOSE_DATE)) || "",
    });
  }

  return accounts;
}
