// Job Complete (pure part) — types, built-in questions, answer checks. No
// database or browser imports, so the email route can use it too.
// The data side is in job-complete.ts, which re-exports all of this.
//
// Job Complete — the install lead's "this job is done" report (migration 058).
//
// The lead picks one of three outcomes, answers that outcome's questions and
// adds photos. The questions are built in below (the office's starter set) and
// can be replaced from the NWO Hub: the hub keeps one JSON value per
// (app, key) in hub_app_settings, and this app reads app "calendar" keys
// "job_complete_questions" and "job_complete_recipients". Anything missing or
// malformed there falls back to the built-ins, key by key, so a half-edited
// setting can never leave a lead with an empty form.
//
// Each report stores a COPY of the questions it was filled in with, so
// changing the questions later never rewrites an old report.

import type { WorkOrder } from "./types";


export type JcOutcome = "complete" | "complete_issues" | "not_complete";

export const OUTCOME_ORDER: JcOutcome[] = ["complete", "complete_issues", "not_complete"];

export const OUTCOME_INFO: Record<
  JcOutcome,
  { label: string; detail: string; tag: string; tone: "green" | "amber" | "red" }
> = {
  complete: {
    label: "Complete — everything's done",
    detail: "Finished, paperwork and payment handled. Quick checklist and photos.",
    tag: "JOB COMPLETE",
    tone: "green",
  },
  complete_issues: {
    label: "Complete — but there are issues",
    detail: "Finished, but something needs the office's attention.",
    tag: "COMPLETE · ISSUES",
    tone: "amber",
  },
  not_complete: {
    label: "Not complete",
    detail: "Leaving with work still to do. Say what's left and why.",
    tag: "NOT COMPLETE",
    tone: "red",
  },
};

// ─── Questions ──────────────────────────────────────────────────────────────

export type JcQuestionType = "yesno" | "text" | "longtext" | "number" | "select" | "photo";

export const QUESTION_TYPES: JcQuestionType[] = ["yesno", "text", "longtext", "number", "select", "photo"];

export interface JcQuestion {
  /** Stable key the answer is stored under. */
  id: string;
  type: JcQuestionType;
  title: string;
  /** Small grey line under the title. */
  help?: string;
  required: boolean;
  /** `select` only. */
  options?: string[];
  /** `photo` only: how many the lead must add. */
  minPhotos?: number;
  /** `yesno` only: this answer flags the report for the office. */
  flagIf?: "yes" | "no";
}

export type JcTemplates = Record<JcOutcome, JcQuestion[]>;

/** The office's starter questions. Edited from the NWO Hub once that is wired. */
export const DEFAULT_TEMPLATES: JcTemplates = {
  complete: [
    { id: "collected", type: "yesno", title: "Final payment collected?", required: true, flagIf: "no" },
    { id: "signed", type: "yesno", title: "Completion paperwork signed by the customer?", required: true, flagIf: "no" },
    { id: "walkthrough", type: "yesno", title: "Walked the finished job through with the customer?", required: true, flagIf: "no" },
    { id: "cleanup", type: "yesno", title: "Job site cleaned up and debris hauled?", required: true, flagIf: "no" },
    // Question ids are unique across outcomes unless the question means the
    // same thing in both ("collected"): an answer only carries over when a
    // lead taps Change if it still answers the new form's question.
    { id: "done_photos", type: "photo", title: "Photos of the finished job", help: "Every window and door, inside and out.", required: true, minPhotos: 4 },
    { id: "notes", type: "longtext", title: "Anything else the office should know?", required: false },
  ],
  complete_issues: [
    { id: "what", type: "longtext", title: "What issues did you find?", required: true },
    {
      id: "kind",
      type: "select",
      title: "What kind of issue?",
      required: true,
      options: ["Product damaged or defective", "Wrong size or wrong product", "Wall / frame / structural damage", "Customer concern", "Missing trim or parts", "Other"],
    },
    { id: "customer_knows", type: "yesno", title: "Does the customer know?", required: true },
    { id: "collected", type: "yesno", title: "Final payment collected?", required: true, flagIf: "no" },
    { id: "issue_photos", type: "photo", title: "Photos of the issues", required: true, minPhotos: 1 },
    { id: "needs", type: "longtext", title: "What does it need to get fixed?", required: false },
  ],
  not_complete: [
    { id: "left", type: "longtext", title: "What's left to do?", required: true },
    {
      id: "why",
      type: "select",
      title: "Why wasn't it finished?",
      required: true,
      options: ["Ran out of time", "Missing product or materials", "Weather", "Customer issue", "Found damage or a surprise", "Other"],
    },
    { id: "return", type: "yesno", title: "Does it need a return trip scheduled?", required: true },
    { id: "secure", type: "yesno", title: "Is the site safe and secured?", required: true, flagIf: "no" },
    { id: "state_photos", type: "photo", title: "Photos of where things stand", required: true, minPhotos: 1 },
  ],
};

function cleanQuestion(raw: unknown, i: number): JcQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Partial<JcQuestion>;
  const title = typeof q.title === "string" ? q.title.trim() : "";
  if (!title || !q.type || !QUESTION_TYPES.includes(q.type)) return null;
  const out: JcQuestion = {
    id: typeof q.id === "string" && q.id.trim() ? q.id.trim() : `q${i + 1}`,
    type: q.type,
    title,
    required: q.required !== false,
  };
  if (typeof q.help === "string" && q.help.trim()) out.help = q.help.trim();
  if (q.type === "select") {
    const opts = Array.isArray(q.options) ? q.options.filter((o): o is string => typeof o === "string" && !!o.trim()) : [];
    if (opts.length === 0) return null;
    out.options = opts.map((o) => o.trim());
  }
  if (q.type === "photo") {
    const n = Number(q.minPhotos);
    out.minPhotos = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
  }
  if (q.type === "yesno" && (q.flagIf === "yes" || q.flagIf === "no")) out.flagIf = q.flagIf;
  return out;
}

/** A complete set of questions from whatever was stored: bad outcomes fall back to the built-ins. */
export function normalizeTemplates(raw: unknown): JcTemplates {
  const src = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<JcOutcome, unknown>>;
  const out = {} as JcTemplates;
  for (const o of OUTCOME_ORDER) {
    const list = Array.isArray(src[o]) ? (src[o] as unknown[]) : null;
    const cleaned = list ? list.map(cleanQuestion).filter((q): q is JcQuestion => !!q) : [];
    // De-duplicate ids so one answer never feeds two questions.
    const seen = new Set<string>();
    const unique = cleaned.map((q, i) => {
      let id = q.id;
      while (seen.has(id)) id = `${q.id}_${i}`;
      seen.add(id);
      return { ...q, id };
    });
    out[o] = unique.length > 0 ? unique : DEFAULT_TEMPLATES[o];
  }
  return out;
}

// ─── Answers ────────────────────────────────────────────────────────────────

export interface JcPhoto {
  /** Storage path in the writeup-photos bucket. */
  path: string;
  name: string;
}

export type JcAnswer = string | JcPhoto[];
export type JcAnswers = Record<string, JcAnswer>;

export function photosOf(a: JcAnswer | undefined): JcPhoto[] {
  return Array.isArray(a) ? a : [];
}

function textOf(a: JcAnswer | undefined): string {
  return typeof a === "string" ? a.trim() : "";
}

/** Titles of required questions still unanswered (photo counts included). */
export function missingAnswers(template: JcQuestion[], answers: JcAnswers): string[] {
  const out: string[] = [];
  for (const q of template) {
    if (q.type === "photo") {
      const need = q.required ? Math.max(1, q.minPhotos ?? 1) : 0;
      if (photosOf(answers[q.id]).length < need) {
        out.push(need > 1 ? `${q.title} (at least ${need})` : q.title);
      }
    } else if (q.required && !textOf(answers[q.id])) {
      out.push(q.title);
    }
  }
  return out;
}

/**
 * Does this report need the office to look? Anything but a clean "complete"
 * always does; a "complete" does when a question marked flag-if answers that way.
 */
export function isFlagged(outcome: JcOutcome, template: JcQuestion[], answers: JcAnswers): boolean {
  if (outcome !== "complete") return true;
  return template.some((q) => q.type === "yesno" && q.flagIf && textOf(answers[q.id]) === q.flagIf);
}

/** One answer as plain text (the email, and the office's list). */
export function answerText(q: JcQuestion, a: JcAnswer | undefined): string {
  if (q.type === "photo") {
    const n = photosOf(a).length;
    return n === 0 ? "—" : `${n} photo${n === 1 ? "" : "s"}`;
  }
  const t = textOf(a);
  if (!t) return "—";
  if (q.type === "yesno") return t === "yes" ? "Yes" : t === "no" ? "No" : t;
  return t;
}


// ─── When a Job Complete is due ─────────────────────────────────────────────
//
// A job's report opens on the LAST day it is scheduled (a multi-day install
// arrives as one order spanning days, or several appointments under one order
// number; the last day is the latest of all of them) and stays open from then
// on. It is never open earlier: a crew that is still mid-job has nothing to
// report yet. A crew that runs out of time on the last day files "not
// complete", which is what that outcome is for.

/** Jobs whose last day is before this are never listed as "needed" -- the
 *  list would otherwise open with every install done before the feature
 *  existed. (A lead can still file one for an older job by searching for it.) */
export const JOB_COMPLETE_START = "2026-11-19";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Today as YYYY-MM-DD in this device's local time (the calendar's times are wall-clock). */
export function localToday(now: Date = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

/** The last day an install is scheduled, across every appointment under its order number. */
export function jobLastDay(orders: WorkOrder[], orderNumber: string): string | null {
  let last: string | null = null;
  const see = (v: string | null | undefined) => {
    const day = (v || "").slice(0, 10);
    if (DAY.test(day) && (!last || day > last)) last = day;
  };
  for (const o of orders) {
    if (o.orderNumber !== orderNumber || o.workOrderType !== "Install") continue;
    see(o.scheduledStart);
    see(o.scheduledEnd);
    for (const d of Object.keys(o.dayCrews || {})) see(d);
  }
  return last;
}

/** Every install's last day at once, by order number (one pass, for lists). */
export function jobLastDays(orders: WorkOrder[]): Map<string, string> {
  const out = new Map<string, string>();
  const see = (num: string, v: string | null | undefined) => {
    const day = (v || "").slice(0, 10);
    if (DAY.test(day) && day > (out.get(num) || "")) out.set(num, day);
  };
  for (const o of orders) {
    if (o.workOrderType !== "Install" || !o.orderNumber) continue;
    see(o.orderNumber, o.scheduledStart);
    see(o.orderNumber, o.scheduledEnd);
    for (const d of Object.keys(o.dayCrews || {})) see(o.orderNumber, d);
  }
  return out;
}

/** Has the job reached its last scheduled day (today counts)? */
export function jobCompleteDue(lastDay: string | null, today: string = localToday()): boolean {
  return !!lastDay && lastDay <= today;
}

/** Due, and recent enough to be chased (see JOB_COMPLETE_START). */
export function jobCompleteNeeded(lastDay: string | null, today: string = localToday()): boolean {
  return jobCompleteDue(lastDay, today) && !!lastDay && lastDay >= JOB_COMPLETE_START;
}
