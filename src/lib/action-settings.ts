import { ActionPerson, ActionLogEntry } from "./types";

const ACTION_TYPES_KEY = "rba-action-types";
const ACTION_PEOPLE_KEY = "rba-action-people";
const ACTION_LOG_KEY = "rba-action-log";

const DEFAULT_ACTION_TYPES = ["Call", "Note", "Action Item"];

export function getActionTypes(): string[] {
  if (typeof window === "undefined") return DEFAULT_ACTION_TYPES;
  const raw = localStorage.getItem(ACTION_TYPES_KEY);
  if (!raw) return DEFAULT_ACTION_TYPES;
  try {
    const parsed = JSON.parse(raw);
    return parsed.length > 0 ? parsed : DEFAULT_ACTION_TYPES;
  } catch {
    return DEFAULT_ACTION_TYPES;
  }
}

export function setActionTypes(types: string[]): void {
  localStorage.setItem(ACTION_TYPES_KEY, JSON.stringify(types));
}

export function getActionPeople(): ActionPerson[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(ACTION_PEOPLE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function setActionPeople(people: ActionPerson[]): void {
  localStorage.setItem(ACTION_PEOPLE_KEY, JSON.stringify(people));
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
