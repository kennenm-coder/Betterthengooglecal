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
