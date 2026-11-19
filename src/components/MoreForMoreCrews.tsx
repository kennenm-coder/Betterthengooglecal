"use client";

// Crews & Tiers (migration 057): who rides with whom, and each person's tier.
// Payroll and the More for More Submitter edit it; the form reads it, so a
// sheet started for a lead fills in that lead's crew and their tiers.
//
// The list itself comes from the More for More people (047/049): every Duck
// Force account holding installer or installer-lead is on it, linked by email
// (their name follows the account). Anyone else can be added by hand.

import { useEffect, useMemo, useState } from "react";
import { Loader2, Link2, Plus, Trash2, EyeOff, Eye, Users } from "lucide-react";
import {
  addMfmPerson,
  deleteMfmPerson,
  fetchMfmPeople,
  updateMfmPerson,
  type MfmPerson,
  type PersonKind,
} from "@/lib/more-for-more-settings";
import type { Tier } from "@/lib/more-for-more";

/** One select for Tier 1/2/3, Training, or not set. */
type TierChoice = "" | "1" | "2" | "3" | "training";

function tierChoice(p: Pick<MfmPerson, "tier" | "training">): TierChoice {
  if (p.training) return "training";
  return p.tier ? (String(p.tier) as TierChoice) : "";
}

function fromChoice(c: TierChoice): { tier: Tier | null; training: boolean } {
  if (c === "training") return { tier: null, training: true };
  return { tier: c ? (Number(c) as Tier) : null, training: false };
}

const selectCls =
  "rounded-md border border-border bg-surface px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary";

function TierSelect({ person, onChange }: { person: Pick<MfmPerson, "tier" | "training">; onChange: (c: TierChoice) => void }) {
  const c = tierChoice(person);
  return (
    <select
      value={c}
      onChange={(e) => onChange(e.target.value as TierChoice)}
      className={`${selectCls} ${c === "" ? "text-amber-700 dark:text-amber-400" : ""}`}
      aria-label="Tier"
    >
      <option value="">No tier</option>
      <option value="1">Tier 1</option>
      <option value="2">Tier 2</option>
      <option value="3">Tier 3</option>
      <option value="training">Training</option>
    </select>
  );
}

export default function MoreForMoreCrews() {
  const [people, setPeople] = useState<MfmPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  // Add a person
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<PersonKind>("apprentice");
  const [newTier, setNewTier] = useState<TierChoice>("");
  const [newCrew, setNewCrew] = useState("");

  async function load() {
    setLoading(true);
    try {
      setPeople(await fetchMfmPeople());
    } catch {
      // Weak signal: keep the list that's showing.
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const active = useMemo(() => people.filter((p) => p.active), [people]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  // A crew's head: a lead who rides with nobody, or anyone others ride with.
  const heads = useMemo(() => {
    const ridersOf = new Set(active.map((p) => p.leadId).filter(Boolean) as string[]);
    return active
      .filter((p) => !(p.leadId && byId.get(p.leadId)?.active) && (p.kind === "lead" || ridersOf.has(p.id)))
      .sort((a, b) => Number(!!a.subcontractor) - Number(!!b.subcontractor) || a.name.localeCompare(b.name));
  }, [active, byId]);
  const headIds = useMemo(() => new Set(heads.map((h) => h.id)), [heads]);

  const crewOfHead = (id: string) =>
    active.filter((p) => p.leadId === id && !headIds.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  const loose = active
    .filter((p) => !headIds.has(p.id) && !(p.leadId && headIds.has(p.leadId)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const hidden = people.filter((p) => !p.active).sort((a, b) => a.name.localeCompare(b.name));

  async function save(p: MfmPerson, patch: Partial<MfmPerson>) {
    const next = { ...p, ...patch };
    setBusy(p.id);
    setError("");
    setPeople((prev) => prev.map((x) => (x.id === p.id ? next : x)));
    try {
      const saved = await updateMfmPerson(next);
      setPeople((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      load();
    } finally {
      setBusy(null);
    }
  }

  async function remove(p: MfmPerson) {
    setBusy(p.id);
    setError("");
    try {
      if (p.email) {
        // Linked to an account: the account would just add them back, so hide.
        await save(p, { active: false, leadId: null });
      } else {
        await deleteMfmPerson(p.id);
        setPeople((prev) => prev.filter((x) => x.id !== p.id).map((x) => (x.leadId === p.id ? { ...x, leadId: null } : x)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove.");
    } finally {
      setBusy(null);
    }
  }

  async function add() {
    if (!newName.trim()) return;
    setBusy("new");
    setError("");
    try {
      const t = fromChoice(newTier);
      const p = await addMfmPerson({
        name: newName,
        kind: newKind,
        tier: t.tier,
        training: t.training,
        active: true,
        leadId: newCrew || null,
        subcontractor: false,
      });
      setPeople((prev) => [...prev, p]);
      setNewName("");
      setNewTier("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add.");
    } finally {
      setBusy(null);
    }
  }

  /** A crew member (or someone on no crew): tier, lead/apprentice, which crew. */
  function personRow(p: MfmPerson) {
    return (
      <div key={p.id} className="flex flex-wrap items-center gap-1.5 px-3 py-2">
        <div className="flex-1 min-w-[130px] flex items-center gap-1.5">
          <span className="text-sm truncate">{p.name}</span>
          {p.email && <Link2 className="w-3 h-3 shrink-0 text-muted" aria-label="Has a Duck Force account" />}
        </div>
        <TierSelect person={p} onChange={(c) => save(p, fromChoice(c))} />
        <select
          value={p.kind === "lead" ? "lead" : "apprentice"}
          onChange={(e) => save(p, { kind: e.target.value as PersonKind })}
          className={selectCls}
          aria-label="Lead or apprentice"
        >
          <option value="lead">Lead</option>
          <option value="apprentice">Apprentice</option>
        </select>
        <select
          value={p.leadId && headIds.has(p.leadId) ? p.leadId : ""}
          onChange={(e) => save(p, { leadId: e.target.value || null })}
          className={`${selectCls} max-w-[150px]`}
          aria-label="Crew"
        >
          <option value="">No crew</option>
          {heads
            .filter((h) => h.id !== p.id)
            .map((h) => (
              <option key={h.id} value={h.id}>
                With {h.name}
              </option>
            ))}
        </select>
        <button
          onClick={() => remove(p)}
          disabled={busy === p.id}
          className="p-1.5 rounded-full text-muted hover:text-danger hover:bg-danger/10"
          title={p.email ? "Hide (they have an account, so they'd come back)" : "Remove"}
          aria-label={`Remove ${p.name}`}
        >
          {p.email ? <EyeOff className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="px-3 py-3 space-y-3">
      <p className="text-xs text-muted">
        Each lead&apos;s tier and the people who ride with them. Starting a sheet for a lead fills in their crew and
        tiers. <Link2 className="inline w-3 h-3" /> = has a Duck Force account (name follows the account).
        Training = no bonus on a sheet.
      </p>
      {error && <p className="text-sm text-danger">{error}</p>}

      {heads.map((h) => {
        const crew = crewOfHead(h.id);
        return (
          <div key={h.id} className="rounded-xl border border-border overflow-hidden">
            <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 bg-surface">
              <div className="flex-1 min-w-[130px] flex items-center gap-1.5">
                <Users className="w-4 h-4 shrink-0 text-rba-green" />
                <span className="text-sm font-semibold truncate">{h.name}</span>
                {h.email && <Link2 className="w-3 h-3 shrink-0 text-muted" aria-label="Has a Duck Force account" />}
                {h.subcontractor && (
                  <span className="shrink-0 rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">
                    SUBCONTRACTOR
                  </span>
                )}
              </div>
              <TierSelect person={h} onChange={(c) => save(h, fromChoice(c))} />
              <label className="flex items-center gap-1 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={!!h.subcontractor}
                  onChange={(e) => save(h, { subcontractor: e.target.checked })}
                />
                Sub
              </label>
              <button
                onClick={() => remove(h)}
                disabled={busy === h.id}
                className="p-1.5 rounded-full text-muted hover:text-danger hover:bg-danger/10"
                title={h.email ? "Hide (they have an account, so they'd come back)" : "Remove"}
                aria-label={`Remove ${h.name}`}
              >
                {h.email ? <EyeOff className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
              </button>
            </div>
            {crew.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted">Nobody rides with {h.name} yet.</p>
            ) : (
              <div className="divide-y divide-border">
                {crew.map((p) => personRow(p))}
              </div>
            )}
            {crew.length > 2 && (
              <p className="px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                A sheet has room for two apprentices; the first two (A-Z) fill in.
              </p>
            )}
          </div>
        );
      })}

      {loose.length > 0 && (
        <div className="rounded-xl border border-dashed border-border overflow-hidden">
          <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Not on a crew</p>
          <div className="divide-y divide-border">
            {loose.map((p) => personRow(p))}
          </div>
        </div>
      )}

      {/* Add someone (no account needed; one with an account joins on its own). */}
      <div className="rounded-xl border border-border p-3 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Add a person</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name"
            className="flex-1 min-w-[140px] rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <TierSelect person={fromChoice(newTier)} onChange={setNewTier} />
          <select value={newKind} onChange={(e) => setNewKind(e.target.value as PersonKind)} className={selectCls}>
            <option value="lead">Lead</option>
            <option value="apprentice">Apprentice</option>
          </select>
          <select value={newCrew} onChange={(e) => setNewCrew(e.target.value)} className={`${selectCls} max-w-[150px]`}>
            <option value="">No crew</option>
            {heads.map((h) => (
              <option key={h.id} value={h.id}>
                With {h.name}
              </option>
            ))}
          </select>
          <button
            onClick={add}
            disabled={!newName.trim() || busy === "new"}
            className="flex items-center gap-1 rounded-md bg-rba-green px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === "new" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add
          </button>
        </div>
      </div>

      {hidden.length > 0 && (
        <div>
          <button onClick={() => setShowHidden((v) => !v)} className="text-xs text-muted underline">
            {showHidden ? "Hide" : "Show"} hidden people ({hidden.length})
          </button>
          {showHidden && (
            <ul className="mt-2 rounded-xl border border-border divide-y divide-border">
              {hidden.map((p) => (
                <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm text-muted">
                  <span className="flex-1 truncate">{p.name}</span>
                  <button
                    onClick={() => save(p, { active: true })}
                    disabled={busy === p.id}
                    className="flex items-center gap-1 text-xs hover:text-foreground"
                  >
                    <Eye className="w-3.5 h-3.5" /> Show again
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
