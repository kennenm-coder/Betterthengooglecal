// Job Complete — data side (migration 058). The types, built-in questions and
// answer checks live in job-complete-core.ts and are re-exported from here, so
// pages import everything from "@/lib/job-complete".

import { getSupabase } from "./supabase";
import { compressImage, uploadWriteUpPhoto } from "./work-order-store";
import { snapshotOf } from "./more-for-more";
import type { WorkOrder } from "./types";
import {
  DEFAULT_TEMPLATES,
  isFlagged,
  normalizeTemplates,
  type JcAnswers,
  type JcOutcome,
  type JcPhoto,
  type JcQuestion,
  type JcTemplates,
} from "./job-complete-core";

export * from "./job-complete-core";

const HUB_APP = "calendar";
let templateCache: { at: number; value: JcTemplates } | null = null;

/** The questions in force right now: the hub's if set, else the built-ins. Never throws. */
export async function loadTemplates(): Promise<JcTemplates> {
  if (templateCache && Date.now() - templateCache.at < 5 * 60_000) return templateCache.value;
  let value = DEFAULT_TEMPLATES;
  try {
    const supabase = getSupabase();
    if (supabase) {
      const { data } = await supabase
        .from("hub_app_settings")
        .select("value")
        .eq("app_slug", HUB_APP)
        .eq("key", "job_complete_questions")
        .maybeSingle();
      if (data?.value) value = normalizeTemplates(data.value);
    }
  } catch {
    /* fall back to the built-ins */
  }
  templateCache = { at: Date.now(), value };
  return value;
}

// ─── Reports ────────────────────────────────────────────────────────────────

export interface JobCompletion {
  id: string;
  order_number: string;
  work_order_number: string | null;
  job_name: string;
  address: string | null;
  install_date: string | null;
  crew_name: string | null;
  outcome: JcOutcome;
  flagged: boolean;
  template: JcQuestion[];
  answers: JcAnswers;
  review_status: "new" | "reviewed";
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  emailed_at: string | null;
  email_error: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  submitted_at: string;
  submit_count: number;
  updated_at: string;
}

/** What a tile needs to draw its tag. */
export interface JcTag {
  id: string;
  outcome: JcOutcome;
  flagged: boolean;
  review_status: "new" | "reviewed";
}

const SEVERITY: Record<JcOutcome, number> = { not_complete: 3, complete_issues: 2, complete: 1 };

/** The tag a job shows when it has several reports: the most serious wins, then the newest. */
export function worseTag(a: JcTag | undefined, b: JcTag): JcTag {
  if (!a) return b;
  const sa = SEVERITY[a.outcome] + (a.flagged ? 0.5 : 0);
  const sb = SEVERITY[b.outcome] + (b.flagged ? 0.5 : 0);
  // A tie goes to `b`, the newer one.
  return sb >= sa ? b : a;
}

/** Every recent report as a thin index by order number — one tag per job. */
export async function fetchCompletionTags(): Promise<Map<string, JcTag>> {
  const supabase = getSupabase();
  if (!supabase) return new Map();
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("job_completions")
    .select("id, order_number, outcome, flagged, review_status")
    .gte("created_at", since)
    // NEWEST first, so if there are ever more than the limit it's the oldest
    // that fall off -- never the jobs on this week's calendar.
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);
  const map = new Map<string, JcTag>();
  // Walk oldest to newest so that on a tie the newer report wins (worseTag).
  for (const r of [...(data || [])].reverse()) {
    const tag: JcTag = { id: r.id, outcome: r.outcome, flagged: !!r.flagged, review_status: r.review_status };
    const prev = map.get(r.order_number);
    map.set(r.order_number, worseTag(prev, tag));
  }
  return map;
}

function toCompletion(r: Record<string, unknown>): JobCompletion {
  const row = r as unknown as JobCompletion;
  return {
    ...row,
    template: Array.isArray(row.template) ? row.template : [],
    answers: row.answers && typeof row.answers === "object" ? row.answers : {},
  };
}

/** Full reports for the office list, newest first. */
export async function fetchCompletions(limit = 300): Promise<JobCompletion[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("job_completions")
    .select("*")
    .order("submitted_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data || []).map(toCompletion);
}

/** This login's own report for a job, if they already filed one. */
export async function fetchMyCompletion(orderNumber: string, email: string): Promise<JobCompletion | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("job_completions")
    .select("*")
    .eq("order_number", orderNumber)
    .eq("created_by", email.toLowerCase())
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toCompletion(data) : null;
}

export interface SaveInput {
  order: WorkOrder;
  crew: string | null;
  outcome: JcOutcome;
  template: JcQuestion[];
  answers: JcAnswers;
  byName: string | null;
  /** The lead's existing report on this job, when they are editing it. */
  existingId?: string | null;
}

/** File (or re-file) a report. Returns the saved row. */
export async function saveCompletion(input: SaveInput): Promise<JobCompletion> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Not connected — try again.");
  const snap = snapshotOf(input.order, input.crew);
  // Keep only answers to the questions on THIS outcome's form. Answers typed
  // under another outcome before the lead tapped "Change" are left behind.
  const ids = new Set(input.template.map((q) => q.id));
  const answers: JcAnswers = Object.fromEntries(Object.entries(input.answers).filter(([k]) => ids.has(k)));
  const body = {
    ...snap,
    outcome: input.outcome,
    flagged: isFlagged(input.outcome, input.template, answers),
    template: input.template,
    answers,
    created_by_name: input.byName || null,
  };
  const q = input.existingId
    ? supabase.from("job_completions").update(body).eq("id", input.existingId)
    : supabase.from("job_completions").insert(body);
  const { data, error } = await q.select("*").single();
  if (error) {
    // One report per lead per job (058). Only reached if the check for an
    // existing one failed when the form opened (say, a dropped signal).
    if (error.code === "23505") {
      throw new Error("You already filed a report for this job. Close this and open it again to update that one.");
    }
    throw new Error(error.message);
  }
  return toCompletion(data);
}

/**
 * Office: mark a flagged report reviewed (or put it back). The database
 * stamps who and when from the login (059); only the display name is ours.
 */
export async function setReviewed(id: string, reviewed: boolean, byName: string | null) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Not connected — try again.");
  const { error } = await supabase
    .from("job_completions")
    .update(reviewed ? { review_status: "reviewed", reviewed_by_name: byName } : { review_status: "new" })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Ask the server to email the right people about a report. The server works
 * out the recipients and the wording itself from the saved row, so nothing
 * the phone sends can pick who gets mailed. Best effort: the report is saved
 * either way.
 */
export async function requestCompletionEmail(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/job-complete/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) return { ok: true };
    const j = await res.json().catch(() => ({}));
    return { ok: false, error: typeof j?.error === "string" ? j.error : "The email didn't send." };
  } catch {
    return { ok: false, error: "The email didn't send." };
  }
}

/** Compress and upload one photo for a report; null when the upload failed. */
export async function uploadCompletionPhoto(orderNumber: string, file: File, n: number): Promise<JcPhoto | null> {
  const blob = await compressImage(file).catch(() => file as Blob);
  const path = await uploadWriteUpPhoto(orderNumber, "job-complete", blob, n);
  return path ? { path, name: `Job complete photo ${n + 1}` } : null;
}
