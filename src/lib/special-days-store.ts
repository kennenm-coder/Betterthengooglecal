import { getSupabase } from "./supabase";

/**
 * Special assignments from the scheduling app: a crew blocked for the day as
 * "Special Ops" (weather / standby) or "Office Day". They show on the calendar
 * as tiles with no job information.
 *
 * The scheduling tables are locked to the scheduling roles, so this goes
 * through sched_special_days(), a SECURITY DEFINER function that returns only a
 * date, a crew name and the kind. See supabase/migrations/050_special_assignments.sql.
 */

export type SpecialKind = "special_ops" | "office_day";

export interface SpecialDay {
  /** YYYY-MM-DD */
  date: string;
  crewName: string;
  crewAliases: string[];
  kind: SpecialKind;
  /** The crew's scheduling type (measure_tech, install_in_house, ...). */
  crewType: string | null;
  additionalTypes: string[];
}

interface SpecialDayRow {
  work_date: string;
  crew_name: string;
  crew_aliases: string[] | null;
  kind: string;
  crew_type?: string | null;
  additional_types?: string[] | null;
}

export const SPECIAL_LABEL: Record<SpecialKind, string> = {
  special_ops: "Special Ops",
  office_day: "Office Day",
};

/**
 * Special days for an inclusive date range.
 *
 * Returns an empty list rather than throwing when the function is missing or
 * the caller lacks access — these tiles are an extra, and must never be able to
 * break the calendar underneath them.
 */
export async function fetchSpecialDays(startDate: string, endDate: string): Promise<SpecialDay[]> {
  const sb = getSupabase();
  if (!sb) return [];

  const { data, error } = await sb.rpc("sched_special_days", {
    p_start: startDate,
    p_end: endDate,
  });

  if (error || !data) {
    if (error) console.warn("[special-days] lookup failed:", error.message);
    return [];
  }

  const out: SpecialDay[] = [];
  for (const row of data as SpecialDayRow[]) {
    if (row.kind !== "special_ops" && row.kind !== "office_day") continue;
    out.push({
      // The date can come back as a full timestamp depending on the driver.
      date: String(row.work_date).slice(0, 10),
      crewName: row.crew_name,
      crewAliases: row.crew_aliases ?? [],
      kind: row.kind,
      crewType: row.crew_type ?? null,
      additionalTypes: row.additional_types ?? [],
    });
  }
  return out;
}

function norm(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Does the crew filter (a name picked in the filter panel) match this tile's crew? */
export function specialDayMatchesCrew(day: SpecialDay, crew: string | null): boolean {
  if (!crew) return true;
  const want = norm(crew);
  return [day.crewName, ...day.crewAliases].some((n) => norm(n) === want);
}

/**
 * Is this tile on a measure-tech-only crew? Such a tile belongs to the same
 * audience as Tech Measure appointments (see canSeeMeasureTiles). A crew that
 * also installs or services is shown to everyone, like their jobs would be.
 * If the type is unknown (function not updated yet) the tile is not hidden.
 */
export function isMeasureOnlyCrew(day: SpecialDay): boolean {
  const types = [day.crewType, ...day.additionalTypes].filter((t): t is string => !!t);
  return types.length > 0 && types.every((t) => t === "measure_tech");
}

/** Group by date, keeping a stable order (Special Ops first, then by crew name). */
export function groupSpecialDaysByDate(days: SpecialDay[]): Map<string, SpecialDay[]> {
  const map = new Map<string, SpecialDay[]>();
  for (const d of days) {
    const list = map.get(d.date) ?? [];
    list.push(d);
    map.set(d.date, list);
  }
  for (const list of map.values()) {
    list.sort(
      (a, b) =>
        (a.kind === b.kind ? 0 : a.kind === "special_ops" ? -1 : 1) ||
        a.crewName.localeCompare(b.crewName)
    );
  }
  return map;
}
