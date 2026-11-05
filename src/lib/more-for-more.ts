// More for More bonus sheets — the lead's half, the office's half, and the
// math. Rates, labels and row order are copied from the paper sheet
// ("More for More Progam Bonus Sheet Rev 2", kept in docs/more-for-more/), and
// the Excel download fills that same sheet cell for cell, so the order of
// UNIT_ITEMS and DEDUCTIONS below matches its rows. Change one, change both.
//
// The database side is migration 045: lead_data and office_data are the two
// JSON halves, and a trigger stops a lead from touching office_data.

import { getSupabase } from "./supabase";
import type { WorkOrder } from "./types";

export type Tier = 1 | 2 | 3;

/** A unit line on the sheet. `null` rates are blank on the paper sheet. */
export interface UnitItem {
  key: UnitKey;
  label: string;
  lead: [number | null, number | null, number | null];
  apprentice: [number, number, number];
}

export type UnitKey =
  | "insert"
  | "fullFrame"
  | "specialty"
  | "bayBow"
  | "entryDoor"
  | "oversized"
  | "pdGlider"
  | "pdFrench"
  | "pdMulti"
  | "stormDoor";

export const UNIT_ITEMS: UnitItem[] = [
  { key: "insert", label: "Insert", lead: [20, 15, 12], apprentice: [10, 7.5, 5] },
  { key: "fullFrame", label: "Full Frame", lead: [40, 30, 25], apprentice: [20, 15, 10] },
  { key: "specialty", label: "Specialty", lead: [75, 60, null], apprentice: [25, 18, 12] },
  { key: "bayBow", label: "Bay/Bow", lead: [150, null, null], apprentice: [75, 50, 25] },
  { key: "entryDoor", label: "Entry Door", lead: [75, 60, null], apprentice: [35, 20, 10] },
  { key: "oversized", label: 'Oversized (130" U.I.)', lead: [75, 60, 50], apprentice: [25, 18, 12] },
  { key: "pdGlider", label: "PD Glider", lead: [80, 70, null], apprentice: [35, 25, 10] },
  { key: "pdFrench", label: "PD French", lead: [100, null, null], apprentice: [40, 30, 15] },
  { key: "pdMulti", label: "PD Multi Panel", lead: [150, null, null], apprentice: [75, 55, 30] },
  { key: "stormDoor", label: "Storm Door", lead: [10, 10, 10], apprentice: [10, 10, 10] },
];

/**
 * The rate a person earns per unit at their tier.
 *
 * Some lead rates are blank on the paper sheet for tiers 2 and 3 (Bay/Bow has
 * only a Tier 1 rate). Until payroll says otherwise, a blank falls back to the
 * nearest rate to its left — the same tier-1 number a lead would have read off
 * the sheet. Apprentice rates are never blank.
 */
export function rateFor(item: UnitItem, isLead: boolean, tier: Tier | null): number {
  if (!tier) return 0;
  const rates = isLead ? item.lead : item.apprentice;
  for (let i = tier - 1; i >= 0; i--) {
    const r = rates[i];
    if (r != null) return r;
  }
  return 0;
}

export interface Deduction {
  key: string;
  label: string;
  /** The % printed on the sheet; null where the sheet gives none. */
  pct: number | null;
  /** Shown next to the label, e.g. "25-100%". */
  hint?: string;
}

export const DEDUCTIONS: Deduction[] = [
  { key: "callOff", label: "Call Off", pct: 100 },
  { key: "safety", label: "Safety Incidents", pct: 100 },
  { key: "jips", label: "Installation JIPs", pct: 25, hint: "25-100%" },
  { key: "woli", label: "WOLI Incompletion", pct: 25 },
  { key: "truck", label: "Truck & Trailer Not Clean/Loaded", pct: null },
  { key: "timecard", label: "Timecard Corrections", pct: 10 },
  { key: "jobRun", label: "Job Run", pct: 25 },
  { key: "photos", label: "Missing Photos", pct: 10 },
  { key: "late", label: "Late to Work", pct: 100 },
  { key: "uniform", label: "Out of Uniform", pct: 25 },
  { key: "disciplinary", label: "Any Disciplinary Measures", pct: null },
];

/** Additional Jobs pay, per job: lead, then each apprentice. */
export const ADDITIONAL_JOB_RATE = { lead: 50, apprentice: 25 };

/** JIP Bonus amounts from the sheet. */
export const JIP_BONUS = {
  installRelated: { lead: 100, apprentice: 50 },
  little: { lead: 25, apprentice: 0 },
};

export type Qty = Partial<Record<UnitKey, number>>;

export interface ApprenticeEntry {
  name: string;
  tier: Tier | null;
  /** True: did the same units as the lead (the usual case). */
  sameAsLead: boolean;
  qty: Qty;
}

/** The lead's half. */
export interface LeadData {
  leadName: string;
  leadTier: Tier | null;
  leadQty: Qty;
  apprentices: ApprenticeEntry[];
  installerNote: string;
  /** Where the starting quantities came from, so the form can say so. */
  qtySource?: "material-list" | "rforce" | null;
}

/** The office's half. Index 0 = lead, 1 and 2 = apprentices. */
export interface OfficeData {
  /** Per person: deduction key → percent. */
  deductions: Record<string, number>[];
  /** Job names for the Additional Jobs line, one per extra job. */
  additionalJobs: string[];
  jipInstallRelated: boolean;
  jipLittle: boolean;
  nps: string;
  dateReceived: string;
  entered8020: boolean;
  payrollDate: string;
  reviewedWithLead: boolean;
  officeNote: string;
}

export type MfmStatus = "submitted" | "completed";

export interface MoreForMore {
  id: string;
  sheet_type: "bonus" | "invoice";
  order_number: string;
  work_order_number: string | null;
  job_name: string;
  address: string | null;
  install_date: string | null;
  crew_name: string | null;
  status: MfmStatus;
  lead_data: LeadData;
  office_data: Partial<OfficeData>;
  lead_total: number | null;
  final_total: number | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  submitted_at: string;
  submit_count: number;
  updated_at: string;
  completed_at: string | null;
  completed_by: string | null;
  completed_by_name: string | null;
}

export function emptyLeadData(leadName = ""): LeadData {
  return { leadName, leadTier: null, leadQty: {}, apprentices: [], installerNote: "", qtySource: null };
}

export function emptyOfficeData(): OfficeData {
  return {
    deductions: [{}, {}, {}],
    additionalJobs: [],
    jipInstallRelated: false,
    jipLittle: false,
    nps: "",
    dateReceived: "",
    entered8020: false,
    payrollDate: "",
    reviewedWithLead: false,
    officeNote: "",
  };
}

/** Fill any fields an older or partial record is missing. */
export function normalizeOffice(o: Partial<OfficeData> | null | undefined): OfficeData {
  const base = emptyOfficeData();
  const merged = { ...base, ...(o || {}) } as OfficeData;
  const d = Array.isArray(merged.deductions) ? merged.deductions : [];
  merged.deductions = [0, 1, 2].map((i) => ({ ...(d[i] || {}) }));
  merged.additionalJobs = Array.isArray(merged.additionalJobs) ? merged.additionalJobs : [];
  return merged;
}

export function normalizeLead(l: Partial<LeadData> | null | undefined): LeadData {
  const base = emptyLeadData();
  const merged = { ...base, ...(l || {}) } as LeadData;
  merged.leadQty = { ...(merged.leadQty || {}) };
  merged.apprentices = (Array.isArray(merged.apprentices) ? merged.apprentices : [])
    .slice(0, 2)
    .map((a) => ({
      name: a?.name || "",
      tier: a?.tier ?? null,
      sameAsLead: a?.sameAsLead !== false,
      qty: { ...(a?.qty || {}) },
    }));
  return merged;
}

// ─── The math ───────────────────────────────────────────────────────────────

export interface PersonCalc {
  role: "lead" | "apprentice";
  name: string;
  tier: Tier | null;
  qty: Qty;
  /** Per unit line: qty × rate. */
  lines: Record<UnitKey, number>;
  subtotal: number;
  /** Sum of deduction %, capped at 100. */
  deductionPct: number;
  deductionAmt: number;
  additionalJobs: number;
  jip: number;
  pay: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function personQty(lead: LeadData, appIdx: number | null): Qty {
  if (appIdx == null) return lead.leadQty;
  const a = lead.apprentices[appIdx];
  return a.sameAsLead ? lead.leadQty : a.qty;
}

/**
 * Everyone on the sheet with their totals. Units × tier rate gives each row,
 * rows add to a subtotal (what the lead sees on submit). The office side then
 * takes the deduction % off that subtotal and adds Additional Jobs and the
 * JIP bonus on top.
 */
export function calcSheet(leadIn: LeadData, officeIn?: Partial<OfficeData> | null): {
  people: PersonCalc[];
  leadTotal: number;
  finalTotal: number;
} {
  const lead = normalizeLead(leadIn);
  const office = normalizeOffice(officeIn);
  const people: PersonCalc[] = [];
  const entries: { role: "lead" | "apprentice"; name: string; tier: Tier | null; appIdx: number | null }[] = [
    { role: "lead", name: lead.leadName, tier: lead.leadTier, appIdx: null },
    ...lead.apprentices.map((a, i) => ({ role: "apprentice" as const, name: a.name, tier: a.tier, appIdx: i })),
  ];
  entries.forEach((e, idx) => {
    const isLead = e.role === "lead";
    const qty = personQty(lead, e.appIdx);
    const lines = {} as Record<UnitKey, number>;
    let subtotal = 0;
    for (const item of UNIT_ITEMS) {
      const q = Number(qty[item.key]) || 0;
      const v = round2(q * rateFor(item, isLead, e.tier));
      lines[item.key] = v;
      subtotal += v;
    }
    subtotal = round2(subtotal);
    const ded = office.deductions[idx] || {};
    const deductionPct = Math.min(
      100,
      Object.values(ded).reduce((s, v) => s + (Number(v) || 0), 0)
    );
    const deductionAmt = round2((subtotal * deductionPct) / 100);
    const jobs = office.additionalJobs.filter((j) => j.trim()).length;
    const additionalJobs = jobs * (isLead ? ADDITIONAL_JOB_RATE.lead : ADDITIONAL_JOB_RATE.apprentice);
    const jip =
      (office.jipInstallRelated ? (isLead ? JIP_BONUS.installRelated.lead : JIP_BONUS.installRelated.apprentice) : 0) +
      (office.jipLittle ? (isLead ? JIP_BONUS.little.lead : JIP_BONUS.little.apprentice) : 0);
    people.push({
      role: e.role,
      name: e.name,
      tier: e.tier,
      qty,
      lines,
      subtotal,
      deductionPct,
      deductionAmt,
      additionalJobs,
      jip,
      pay: round2(subtotal - deductionAmt + additionalJobs + jip),
    });
  });
  return {
    people,
    leadTotal: round2(people.reduce((s, p) => s + p.subtotal, 0)),
    finalTotal: round2(people.reduce((s, p) => s + p.pay, 0)),
  };
}

export function money(n: number | null | undefined): string {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// ─── Starting quantities from the job ───────────────────────────────────────

const WINDOW_ABBREVS = new Set(["CS", "CD", "CT", "DG", "PW", "FC", "SPW", "AN", "GL", "GT", "DH", "CAS", "PIC", "SLD", "AWN", "GLD", "SN"]);

function inches(whole: unknown, frac: unknown): number {
  return (Number(whole) || 0) + (Number(frac) || 0);
}

/**
 * Suggested unit counts for a job. The material list knows each unit's type
 * and frame, so it can split insert from full frame and spot bays, patio door
 * styles and oversized units. Without one, rForce's window/patio/door counts
 * are the best guess (every window counted as an insert, every patio door as
 * a glider) and the form says so. The lead always checks and edits them.
 */
export function suggestQty(order: WorkOrder | null): { qty: Qty; source: LeadData["qtySource"] } {
  const units = order?.materialJob?.units;
  if (units && units.length) {
    const q: Qty = {};
    const add = (k: UnitKey, n = 1) => (q[k] = (q[k] || 0) + n);
    for (const u of units) {
      if (u.isMisc) continue;
      const abbrev = String(u.abbrev || u.summaryAbbrev || "").toUpperCase();
      const type = String(u.unitType || u.type || "").toLowerCase();
      const sub = String(u.subType || u.summarySubType || "").toLowerCase();
      const frame = String(u.frame || u.summaryFrameType || "");
      if (abbrev === "BAY" || abbrev === "BOW" || /\bbay\b|\bbow\b/.test(type)) {
        add("bayBow");
        continue;
      }
      if (abbrev === "ED" || abbrev === "IE" || /entry door/.test(type)) {
        add("entryDoor");
        continue;
      }
      if (abbrev === "PTD" || /patio/.test(type)) {
        if (/french|hinged|swing/.test(sub + " " + type)) add("pdFrench");
        else if (/3|4|multi|three|four/.test(sub)) add("pdMulti");
        else add("pdGlider");
        continue;
      }
      if (abbrev === "SPW" || /specialty/.test(type)) add("specialty");
      else if (WINDOW_ABBREVS.has(abbrev) || /window|casement|hung|picture|awning|glider|slider/.test(type)) {
        if (frame === "FF" || /full frame/i.test(frame)) add("fullFrame");
        else add("insert");
      } else continue;
      const ui = inches(u.widthWhole, u.widthFrac) + inches(u.heightWhole, u.heightFrac);
      if (ui > 130) add("oversized");
    }
    if (Object.keys(q).length) return { qty: q, source: "material-list" };
  }
  if (order) {
    const q: Qty = {};
    if (order.windows) q.insert = order.windows;
    if (order.patioDoors) q.pdGlider = order.patioDoors;
    if (order.doors) q.entryDoor = order.doors;
    if (Object.keys(q).length) return { qty: q, source: "rforce" };
  }
  return { qty: {}, source: null };
}

// ─── Store ──────────────────────────────────────────────────────────────────

const TABLE = "more_for_more";

function db() {
  const s = getSupabase();
  if (!s) throw new Error("Not connected to the database.");
  return s;
}

function fromRow(r: any): MoreForMore {
  return {
    ...r,
    lead_data: normalizeLead(r.lead_data),
    office_data: r.office_data || {},
    lead_total: r.lead_total == null ? null : Number(r.lead_total),
    final_total: r.final_total == null ? null : Number(r.final_total),
  };
}

/** Every sheet the caller can see: their own, or all of them for payroll. */
export async function fetchMoreForMores(opts: { mineOnly?: string } = {}): Promise<MoreForMore[]> {
  let q = db().from(TABLE).select("*").eq("sheet_type", "bonus").order("created_at", { ascending: false });
  if (opts.mineOnly) q = q.eq("created_by", opts.mineOnly.toLowerCase());
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map(fromRow);
}

export async function fetchMoreForMore(id: string): Promise<MoreForMore | null> {
  const { data, error } = await db().from(TABLE).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : null;
}

export interface JobSnapshot {
  order_number: string;
  work_order_number: string | null;
  job_name: string;
  address: string | null;
  install_date: string | null;
  crew_name: string | null;
}

export function snapshotOf(order: WorkOrder, crew: string | null): JobSnapshot {
  return {
    order_number: order.orderNumber,
    work_order_number: order.workOrderNumber || null,
    job_name: order.customerName || order.accountName || "",
    address: order.address || null,
    install_date: order.scheduledStart ? order.scheduledStart.slice(0, 10) : null,
    crew_name: crew,
  };
}

/** The lead submits (new) or resubmits (existing). */
export async function submitLeadSheet(input: {
  id?: string | null;
  job: JobSnapshot;
  lead: LeadData;
  createdByName: string;
}): Promise<MoreForMore> {
  const { leadTotal } = calcSheet(input.lead);
  const row = {
    ...input.job,
    lead_data: input.lead,
    lead_total: leadTotal,
    created_by_name: input.createdByName || null,
  };
  const q = input.id
    ? db().from(TABLE).update(row).eq("id", input.id).select("*").single()
    : db().from(TABLE).insert({ ...row, sheet_type: "bonus" }).select("*").single();
  const { data, error } = await q;
  if (error) {
    if (/duplicate key|uq_mfm_job_per_lead/i.test(error.message)) {
      throw new Error("You already have a More for More for this job. Open it from your list to edit it.");
    }
    throw new Error(error.message);
  }
  return fromRow(data);
}

/** Payroll saves their half (and may correct the lead's), optionally completing it. */
export async function saveOfficeSheet(input: {
  sheet: MoreForMore;
  lead: LeadData;
  office: OfficeData;
  complete: boolean;
  byEmail: string;
  byName: string;
}): Promise<MoreForMore> {
  const { leadTotal, finalTotal } = calcSheet(input.lead, input.office);
  const patch: Record<string, unknown> = {
    lead_data: input.lead,
    office_data: input.office,
    lead_total: leadTotal,
    final_total: finalTotal,
  };
  if (input.complete) {
    patch.status = "completed";
    patch.completed_at = new Date().toISOString();
    patch.completed_by = input.byEmail;
    patch.completed_by_name = input.byName || null;
  }
  const { data, error } = await db().from(TABLE).update(patch).eq("id", input.sheet.id).select("*").single();
  if (error) throw new Error(error.message);
  return fromRow(data);
}

export async function deleteMoreForMore(id: string): Promise<void> {
  const { error } = await db().from(TABLE).delete().eq("id", id);
  if (error) throw new Error(error.message);
}
