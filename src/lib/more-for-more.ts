// More for More bonus sheets — the lead's half, the office's half, and the
// math. Rates, labels and row order are copied from the paper sheet
// ("More for More Progam Bonus Sheet Rev 2", kept in docs/more-for-more/), and
// the Excel download fills that same sheet cell for cell, so the order of
// UNIT_ITEMS and DEDUCTIONS below matches its rows. Change one, change both.
//
// The database side is migration 045: lead_data and office_data are the two
// JSON halves, and a trigger stops a lead from touching office_data. The
// numbers in UNIT_ITEMS are only the defaults now: payroll edits the live
// rates on the settings page (047), and each sheet keeps the copy it was
// saved with (lead_data.rates).

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

// ─── Rates (editable on the More for More settings page, 047) ───────────────

/** Tier 1, 2, 3. `null` = blank on the sheet = that tier doesn't get this job (no bonus). */
export type RateRow = [number | null, number | null, number | null];

export interface MfmRates {
  items: Record<UnitKey, { lead: RateRow; apprentice: RateRow }>;
  /** Additional Jobs pay, per job. */
  additionalJob: { lead: number; apprentice: number };
  /** JIP Bonus amounts. */
  jip: {
    installRelated: { lead: number; apprentice: number };
    little: { lead: number; apprentice: number };
  };
}

/** The paper sheet's numbers: what applies until payroll changes them. */
export const DEFAULT_RATES: MfmRates = {
  items: Object.fromEntries(
    UNIT_ITEMS.map((i) => [i.key, { lead: [...i.lead] as RateRow, apprentice: [...i.apprentice] as RateRow }])
  ) as MfmRates["items"],
  additionalJob: { lead: 50, apprentice: 25 },
  jip: {
    installRelated: { lead: 100, apprentice: 50 },
    little: { lead: 25, apprentice: 0 },
  },
};

function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function rateRow(v: unknown, fallback: RateRow): RateRow {
  if (!Array.isArray(v)) return [...fallback] as RateRow;
  return [0, 1, 2].map((i) => {
    const x = v[i];
    if (x === null || x === "") return null;
    const n = typeof x === "number" ? x : Number(x);
    return Number.isFinite(n) && n >= 0 ? n : fallback[i];
  }) as RateRow;
}

/**
 * A complete, sane rate table from whatever was stored: anything missing or
 * not a number falls back to the paper sheet's value, key by key.
 */
export function normalizeRates(r: unknown): MfmRates {
  const src = (r && typeof r === "object" ? r : {}) as Partial<MfmRates>;
  const items = {} as MfmRates["items"];
  for (const it of UNIT_ITEMS) {
    const d = DEFAULT_RATES.items[it.key];
    const s = src.items?.[it.key];
    items[it.key] = { lead: rateRow(s?.lead, d.lead), apprentice: rateRow(s?.apprentice, d.apprentice) };
  }
  const aj = src.additionalJob || ({} as Partial<MfmRates["additionalJob"]>);
  const ji = src.jip || ({} as Partial<MfmRates["jip"]>);
  const D = DEFAULT_RATES;
  return {
    items,
    additionalJob: { lead: num(aj.lead, D.additionalJob.lead), apprentice: num(aj.apprentice, D.additionalJob.apprentice) },
    jip: {
      installRelated: {
        lead: num(ji.installRelated?.lead, D.jip.installRelated.lead),
        apprentice: num(ji.installRelated?.apprentice, D.jip.installRelated.apprentice),
      },
      little: {
        lead: num(ji.little?.lead, D.jip.little.lead),
        apprentice: num(ji.little?.apprentice, D.jip.little.apprentice),
      },
    },
  };
}

/**
 * The rate a person earns per unit at their tier.
 *
 * A blank rate means leads at that tier don't get that kind of job, so there
 * is no bonus for it (Kennen, 2026-11-06). On the paper sheet only Tier 1
 * leads are sent on bays/bows: a Tier 1 lead earns $150 a bay, a Tier 2 or 3
 * lead $0. Never borrow another tier's rate.
 */
export function rateFor(rates: MfmRates, key: UnitKey, isLead: boolean, tier: Tier | null): number {
  if (!tier) return 0;
  const row = isLead ? rates.items[key].lead : rates.items[key].apprentice;
  return row[tier - 1] ?? 0;
}

/**
 * The tiers that DO have a rate for this unit, when this person's tier has
 * none — e.g. [1] for a Tier 2 lead looking at Bay/Bow. Empty when their tier
 * has a rate (or no tier is picked yet). Drives the "Tier 1 leads only" note.
 */
export function tiersWithRate(rates: MfmRates, key: UnitKey, isLead: boolean, tier: Tier | null): Tier[] {
  if (!tier) return [];
  const row = isLead ? rates.items[key].lead : rates.items[key].apprentice;
  if (row[tier - 1] != null) return [];
  return ([1, 2, 3] as Tier[]).filter((t) => row[t - 1] != null);
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
  /** Additional Jobs: one job name per extra job (lead fills, office may fix). */
  additionalJobs: string[];
  /** JIP Bonus lines that apply (lead fills, office may fix). */
  jipInstallRelated: boolean;
  jipLittle: boolean;
  /** Where the starting quantities came from, so the form can say so. */
  qtySource?: "material-list" | "rforce" | null;
  /**
   * The rates in effect when the lead last saved this sheet. Pay is always
   * worked out from these, so changing a rate in settings never changes a
   * sheet already filled in. Absent on sheets saved before 047.
   */
  rates?: MfmRates;
}

/** The office's half. Index 0 = lead, 1 and 2 = apprentices. */
export interface OfficeData {
  /** Per person: deduction key → percent. */
  deductions: Record<string, number>[];
  /**
   * Legacy: Additional Jobs and JIP were office fields before leads filled
   * them (046). Read only as a fallback for sheets saved that way.
   */
  additionalJobs?: string[];
  jipInstallRelated?: boolean;
  jipLittle?: boolean;
  nps: string;
  dateReceived: string;
  entered8020: boolean;
  payrollDate: string;
  reviewedWithLead: boolean;
  officeNote: string;
}

/**
 * draft     — the lead saved it in progress; not with payroll yet.
 * submitted — waiting on payroll.
 * rejected  — payroll sent it back with a reason; the lead must fix it.
 * completed — payroll finished it.
 */
export type MfmStatus = "draft" | "submitted" | "rejected" | "completed";

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
  /** Set when payroll sends it back (046). Kept after a resubmit, as history. */
  reject_reason?: string | null;
  rejected_at?: string | null;
  rejected_by?: string | null;
  rejected_by_name?: string | null;
  /** When the lead dismissed the "completed" notice. */
  lead_ack_at?: string | null;
  /** Typed in by payroll from a paper sheet (048). */
  on_paper?: boolean;
}

export function emptyLeadData(leadName = ""): LeadData {
  return {
    leadName,
    leadTier: null,
    leadQty: {},
    apprentices: [],
    installerNote: "",
    additionalJobs: [],
    jipInstallRelated: false,
    jipLittle: false,
    qtySource: null,
  };
}

export function emptyOfficeData(): OfficeData {
  return {
    deductions: [{}, {}, {}],
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
  return merged;
}

export function normalizeLead(l: Partial<LeadData> | null | undefined): LeadData {
  const base = emptyLeadData();
  const merged = { ...base, ...(l || {}) } as LeadData;
  merged.leadQty = { ...(merged.leadQty || {}) };
  merged.additionalJobs = Array.isArray(merged.additionalJobs) ? merged.additionalJobs : [];
  merged.jipInstallRelated = !!merged.jipInstallRelated;
  merged.jipLittle = !!merged.jipLittle;
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
 * Additional Jobs and JIP for a sheet: the lead's answers, or the office's on
 * sheets saved before leads filled them.
 */
export function extrasOf(leadIn: LeadData, officeIn?: Partial<OfficeData> | null) {
  const lead = normalizeLead(leadIn);
  const office = officeIn || {};
  const legacyJobs = Array.isArray(office.additionalJobs) ? office.additionalJobs : [];
  return {
    additionalJobs: (lead.additionalJobs.length ? lead.additionalJobs : legacyJobs).filter((j) => j.trim()),
    jipInstallRelated: lead.jipInstallRelated || !!office.jipInstallRelated,
    jipLittle: lead.jipLittle || !!office.jipLittle,
  };
}

/**
 * Everyone on the sheet with their totals. Units × tier rate gives each row,
 * rows add to a subtotal. Additional Jobs and the JIP bonus (both filled by
 * the lead) add on top, so the lead's total includes them. Payroll's
 * deduction % comes off the unit subtotal only.
 *
 * Rates: the sheet's own saved copy when it has one; otherwise `currentRates`
 * (today's settings) — a sheet being filled in for the first time, or one
 * saved before rates were saved on sheets; otherwise the paper sheet's.
 */
export function calcSheet(
  leadIn: LeadData,
  officeIn?: Partial<OfficeData> | null,
  currentRates?: MfmRates | null
): {
  people: PersonCalc[];
  /** What the lead is submitting: units + additional jobs + JIP, before deductions. */
  leadTotal: number;
  finalTotal: number;
  /** The rates this sheet was worked out with. */
  rates: MfmRates;
} {
  const lead = normalizeLead(leadIn);
  const office = normalizeOffice(officeIn);
  const extras = extrasOf(lead, officeIn);
  const rates = normalizeRates(lead.rates ?? currentRates ?? null);
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
      const v = round2(q * rateFor(rates, item.key, isLead, e.tier));
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
    const jobs = extras.additionalJobs.length;
    const who = isLead ? "lead" : "apprentice";
    const additionalJobs = jobs * rates.additionalJob[who];
    const jip =
      (extras.jipInstallRelated ? rates.jip.installRelated[who] : 0) +
      (extras.jipLittle ? rates.jip.little[who] : 0);
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
    leadTotal: round2(people.reduce((s, p) => s + p.subtotal + p.additionalJobs + p.jip, 0)),
    finalTotal: round2(people.reduce((s, p) => s + p.pay, 0)),
    rates,
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

/**
 * The lead saves progress ("draft") or submits to payroll ("submitted"), new
 * or existing. The database trigger keeps payroll's answers and does the
 * bookkeeping (submit count, dates) — see migration 046.
 */
export async function submitLeadSheet(input: {
  id?: string | null;
  job: JobSnapshot;
  lead: LeadData;
  createdByName: string;
  status: "draft" | "submitted";
  /** Today's rates from settings. Every lead save stamps them on the sheet. */
  currentRates: MfmRates;
}): Promise<MoreForMore> {
  const lead: LeadData = { ...input.lead, rates: normalizeRates(input.currentRates) };
  const { leadTotal } = calcSheet(lead);
  const row = {
    ...input.job,
    lead_data: lead,
    lead_total: leadTotal,
    status: input.status,
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
  currentRates: MfmRates;
}): Promise<MoreForMore> {
  // Payroll keeps the sheet's own rates; an older sheet without any gets today's.
  const lead: LeadData = { ...input.lead, rates: input.lead.rates ?? normalizeRates(input.currentRates) };
  const { leadTotal, finalTotal } = calcSheet(lead, input.office);
  const patch: Record<string, unknown> = {
    lead_data: lead,
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

/**
 * Payroll types in a sheet a lead handed in on paper. It is saved under
 * payroll's login (the database sets created_by), so created_by_name carries
 * the lead's name — that's what lists and the Excel group by.
 */
export async function createOfficeSheet(input: {
  job: JobSnapshot;
  lead: LeadData;
  office: OfficeData;
  complete: boolean;
  byEmail: string;
  byName: string;
  currentRates: MfmRates;
}): Promise<MoreForMore> {
  const lead: LeadData = { ...input.lead, rates: normalizeRates(input.currentRates) };
  const { leadTotal, finalTotal } = calcSheet(lead, input.office);
  const row: Record<string, unknown> = {
    ...input.job,
    sheet_type: "bonus",
    lead_data: lead,
    office_data: input.office,
    lead_total: leadTotal,
    final_total: finalTotal,
    status: input.complete ? "completed" : "submitted",
    created_by_name: lead.leadName.trim() || input.byName || null,
    on_paper: true,
  };
  if (input.complete) {
    row.completed_at = new Date().toISOString();
    row.completed_by = input.byEmail;
    row.completed_by_name = input.byName || null;
  }
  const { data, error } = await db().from(TABLE).insert(row).select("*").single();
  if (error) {
    if (/duplicate key|uq_mfm_job_per_lead/i.test(error.message)) {
      throw new Error("You already typed in a sheet for this job. Open it from the list to edit it.");
    }
    throw new Error(error.message);
  }
  return fromRow(data);
}

// ─── Per-job flags (048) ────────────────────────────────────────────────────

/** Payroll's marks on a job: a paper sheet came in; (admin) excluded. */
export interface JobFlag {
  order_number: string;
  paper: boolean;
  excluded: boolean;
}

/** Every flagged job, keyed by order number. Empty before 048 runs. */
export async function fetchJobFlags(): Promise<Map<string, JobFlag>> {
  const out = new Map<string, JobFlag>();
  const s = getSupabase();
  if (!s) return out;
  // Paged: once old deals are excluded in bulk there can be thousands.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await s
      .from("more_for_more_jobs")
      .select("order_number, paper, excluded")
      .range(from, from + 999);
    if (error || !data) break;
    for (const r of data) out.set(r.order_number, { order_number: r.order_number, paper: !!r.paper, excluded: !!r.excluded });
    if (data.length < 1000) break;
  }
  return out;
}

/**
 * Set flags on one or many jobs. `excluded` only sticks for an admin (the
 * database ignores it from anyone else).
 */
export async function setJobFlags(
  orderNumbers: string[],
  patch: Partial<Pick<JobFlag, "paper" | "excluded">>,
  current: Map<string, JobFlag>
): Promise<JobFlag[]> {
  const rows = orderNumbers.map((n) => {
    const cur = current.get(n);
    return {
      order_number: n,
      paper: patch.paper ?? cur?.paper ?? false,
      excluded: patch.excluded ?? cur?.excluded ?? false,
    };
  });
  const saved: JobFlag[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await db()
      .from("more_for_more_jobs")
      .upsert(rows.slice(i, i + 500), { onConflict: "order_number" })
      .select("order_number, paper, excluded");
    if (error) throw new Error(error.message);
    for (const r of data || []) saved.push({ order_number: r.order_number, paper: !!r.paper, excluded: !!r.excluded });
  }
  return saved;
}

/** Payroll sends a sheet back to the lead with a reason. */
export async function rejectSheet(input: {
  sheet: MoreForMore;
  lead: LeadData;
  office: OfficeData;
  reason: string;
  byName: string;
  currentRates: MfmRates;
}): Promise<MoreForMore> {
  const lead: LeadData = { ...input.lead, rates: input.lead.rates ?? normalizeRates(input.currentRates) };
  const { leadTotal, finalTotal } = calcSheet(lead, input.office);
  const { data, error } = await db()
    .from(TABLE)
    .update({
      lead_data: lead,
      office_data: input.office,
      lead_total: leadTotal,
      final_total: finalTotal,
      status: "rejected",
      reject_reason: input.reason.trim(),
      rejected_by_name: input.byName || null,
    })
    .eq("id", input.sheet.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return fromRow(data);
}

/** The lead dismisses a "completed" notice. Changes nothing else (046 trigger). */
export async function ackSheet(id: string): Promise<void> {
  const { error } = await db().from(TABLE).update({ lead_ack_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Does this sheet have a notice its lead hasn't dealt with? Sent back: until
 * they resubmit. Completed: until they dismiss it.
 */
export function noticeKind(s: MoreForMore): "rejected" | "completed" | null {
  if (s.status === "rejected") return "rejected";
  if (s.status === "completed" && s.completed_at && (!s.lead_ack_at || s.lead_ack_at < s.completed_at)) {
    return "completed";
  }
  return null;
}

export async function deleteMoreForMore(id: string): Promise<void> {
  const { error } = await db().from(TABLE).delete().eq("id", id);
  if (error) throw new Error(error.message);
}
