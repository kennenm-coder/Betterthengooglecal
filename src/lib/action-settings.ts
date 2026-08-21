import { ActionPerson, ActionLogEntry } from "./types";
import { getSupabase } from "./supabase";

const ACTION_LOG_KEY = "rba-action-log";
const DEFAULT_ACTION_TYPES = ["Call", "Note", "Action Item"];

export async function getActionTypes(): Promise<string[]> {
  const supabase = getSupabase();
  if (supabase) {
    const { data } = await supabase
      .from("action_settings")
      .select("value")
      .eq("key", "action_types")
      .single();
    if (data?.value) return data.value as string[];
  }
  return DEFAULT_ACTION_TYPES;
}

export async function setActionTypes(types: string[]): Promise<void> {
  const supabase = getSupabase();
  if (supabase) {
    await supabase
      .from("action_settings")
      .upsert({ key: "action_types", value: types, updated_at: new Date().toISOString() });
  }
}

export async function getActionPeople(): Promise<ActionPerson[]> {
  const supabase = getSupabase();
  if (supabase) {
    const { data } = await supabase
      .from("action_settings")
      .select("value")
      .eq("key", "action_people")
      .single();
    if (data?.value) return data.value as ActionPerson[];
  }
  return [];
}

export async function setActionPeople(people: ActionPerson[]): Promise<void> {
  const supabase = getSupabase();
  if (supabase) {
    await supabase
      .from("action_settings")
      .upsert({ key: "action_people", value: people, updated_at: new Date().toISOString() });
  }
}

// ─── Default email recipients (admin-configurable) ─────────────────────────
// Stored in the action_settings table (allowlisted read, admin write) so they
// can be changed without a deploy. Write-ups support multiple To addresses;
// field notes keep a single inbox that's added alongside the sender's own email.

export const DEFAULT_WRITEUP_EMAIL = "fieldnotes@rbanwo.com";
export const DEFAULT_FIELDNOTES_EMAIL = "fieldnotes@rbanwo.com";

const WRITEUP_EMAIL_KEY = "writeup_email_to";
const FIELDNOTES_EMAIL_KEY = "fieldnotes_email_to";

/** Default To addresses a submitted write-up is emailed to (one or more). */
export async function getWriteUpEmails(): Promise<string[]> {
  const supabase = getSupabase();
  if (supabase) {
    const { data } = await supabase
      .from("action_settings")
      .select("value")
      .eq("key", WRITEUP_EMAIL_KEY)
      .maybeSingle();
    if (Array.isArray(data?.value) && data.value.length) return data.value as string[];
  }
  return [DEFAULT_WRITEUP_EMAIL];
}

export async function setWriteUpEmails(emails: string[]): Promise<void> {
  const supabase = getSupabase();
  if (supabase) {
    await supabase.from("action_settings").upsert({
      key: WRITEUP_EMAIL_KEY,
      value: emails,
      updated_at: new Date().toISOString(),
    });
  }
}

/** The inbox a field note is sent to (added alongside the sender's own email). */
export async function getFieldNotesEmail(): Promise<string> {
  const supabase = getSupabase();
  if (supabase) {
    const { data } = await supabase
      .from("action_settings")
      .select("value")
      .eq("key", FIELDNOTES_EMAIL_KEY)
      .maybeSingle();
    if (typeof data?.value === "string" && data.value) return data.value;
  }
  return DEFAULT_FIELDNOTES_EMAIL;
}

export async function setFieldNotesEmail(email: string): Promise<void> {
  const supabase = getSupabase();
  if (supabase) {
    await supabase.from("action_settings").upsert({
      key: FIELDNOTES_EMAIL_KEY,
      value: email,
      updated_at: new Date().toISOString(),
    });
  }
}

export function getActionLog(): ActionLogEntry[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(ACTION_LOG_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function addActionLog(entry: ActionLogEntry): void {
  const log = getActionLog();
  log.unshift(entry);
  if (log.length > 500) log.length = 500;
  localStorage.setItem(ACTION_LOG_KEY, JSON.stringify(log));
}
