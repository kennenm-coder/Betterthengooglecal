// More for More settings (migration 047): the live bonus rates and the people
// the form suggests by name. Payroll (admin, payroll-admin) edits the rates on
// /more-for-more/settings. The people are also the Crews & Tiers table (057),
// which payroll AND the More for More Submitter edit. Everyone allowlisted
// reads both.

import { getSupabase } from "./supabase";
import { DEFAULT_RATES, normalizeRates, type MfmRates, type Tier } from "./more-for-more";

export type PersonKind = "lead" | "apprentice" | "either";

export interface MfmPerson {
  id: string;
  name: string;
  kind: PersonKind;
  tier: Tier | null;
  active: boolean;
  /**
   * The login this person is linked to (049): every installer / installer-
   * lead account is added and kept in step automatically. Null for someone
   * payroll typed in who has no account.
   */
  email?: string | null;
  /** Their usual lead (057): who they ride with. A lead's crew points at them. */
  leadId?: string | null;
  /** Training (057): on the crew, but no bonus on a sheet. */
  training?: boolean;
  /** A subcontractor crew (057). A tag for now. */
  subcontractor?: boolean;
}

function db() {
  const s = getSupabase();
  if (!s) throw new Error("Not connected to the database.");
  return s;
}

/**
 * Today's rates. Falls back to the paper sheet's when nothing is saved — or
 * when the settings table is not there yet, so the form keeps working.
 */
export async function fetchMfmRates(): Promise<MfmRates> {
  const { data, error } = await db().from("more_for_more_settings").select("rates").eq("id", 1).maybeSingle();
  if (error || !data) return normalizeRates(DEFAULT_RATES);
  return normalizeRates(data.rates);
}

export async function saveMfmRates(rates: MfmRates, byEmail: string): Promise<MfmRates> {
  const clean = normalizeRates(rates);
  const { data, error } = await db()
    .from("more_for_more_settings")
    .update({ rates: clean, updated_at: new Date().toISOString(), updated_by: byEmail || null })
    .eq("id", 1)
    .select("rates")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("The settings row is missing. Run migration 047 in Supabase.");
  return normalizeRates(data.rates);
}

function toPerson(r: Record<string, unknown>): MfmPerson {
  const t = Number(r.tier);
  return {
    id: String(r.id),
    name: String(r.name || ""),
    kind: (["lead", "apprentice", "either"].includes(String(r.kind)) ? r.kind : "either") as PersonKind,
    tier: t === 1 || t === 2 || t === 3 ? (t as Tier) : null,
    active: r.active !== false,
    email: typeof r.email === "string" && r.email ? r.email.toLowerCase() : null,
    leadId: typeof r.lead_id === "string" && r.lead_id ? r.lead_id : null,
    training: r.training === true,
    subcontractor: r.subcontractor === true,
  };
}

/** The columns a save writes. Crew fields only once 057 has added them. */
function personRow(p: Omit<MfmPerson, "id">) {
  return {
    name: p.name.trim(),
    kind: p.kind,
    // Training means no tier; a tier means not training.
    tier: p.training ? null : p.tier,
    active: p.active,
    ...(p.leadId !== undefined ? { lead_id: p.leadId } : {}),
    ...(p.training !== undefined ? { training: p.training } : {}),
    ...(p.subcontractor !== undefined ? { subcontractor: p.subcontractor } : {}),
  };
}

/** A lead's crew: everyone whose usual lead is them, active only, A-Z. */
export function crewOf(people: MfmPerson[], leadId: string): MfmPerson[] {
  return people
    .filter((p) => p.active && p.leadId === leadId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Everyone on the list, A→Z. Brings it up to date with the accounts first
 * (049: new installer / installer-lead logins join, names follow the
 * account). The sync failing — say before 049 runs — just skips that step.
 * Empty if the table is not there yet.
 */
export async function fetchMfmPeople(): Promise<MfmPerson[]> {
  await db().rpc("mfm_sync_people").then(
    () => undefined,
    () => undefined
  );
  const { data, error } = await db().from("more_for_more_people").select("*").order("name");
  if (error) return [];
  return (data || []).map(toPerson);
}

function friendly(message: string): string {
  return /uq_mfm_people_name|duplicate key/i.test(message) ? "Someone with that name is already on the list." : message;
}

export async function addMfmPerson(p: Omit<MfmPerson, "id">): Promise<MfmPerson> {
  const { data, error } = await db()
    .from("more_for_more_people")
    .insert(personRow(p))
    .select("*")
    .single();
  if (error) throw new Error(friendly(error.message));
  return toPerson(data);
}

export async function updateMfmPerson(p: MfmPerson): Promise<MfmPerson> {
  const { data, error } = await db()
    .from("more_for_more_people")
    .update({ ...personRow(p), updated_at: new Date().toISOString() })
    .eq("id", p.id)
    .select("*")
    .single();
  if (error) throw new Error(friendly(error.message));
  return toPerson(data);
}

export async function deleteMfmPerson(id: string): Promise<void> {
  const { error } = await db().from("more_for_more_people").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
