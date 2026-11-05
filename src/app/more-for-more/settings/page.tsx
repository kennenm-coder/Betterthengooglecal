"use client";

// More for More settings — payroll (payroll-admin, admin) only.
//   Rates:  every unit's Tier 1/2/3 bonus for lead and apprentice, plus the
//           Additional Jobs and JIP amounts. Saving changes the rates new
//           saves use; sheets already saved keep the rates they were saved
//           with (lead_data.rates).
//   People: names the form suggests as a lead types. Tapping one fills in
//           their tier. Leads can still type anyone and pick a tier by hand.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, ShieldX, Plus, Trash2, RotateCcw, Check, Users, BadgeDollarSign } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { refreshMfmSettings } from "@/hooks/useMfmSettings";
import { canProcessMoreForMore } from "@/lib/roles";
import {
  DEFAULT_RATES,
  normalizeRates,
  UNIT_ITEMS,
  type MfmRates,
  type RateRow,
  type Tier,
  type UnitKey,
} from "@/lib/more-for-more";
import {
  addMfmPerson,
  deleteMfmPerson,
  fetchMfmPeople,
  fetchMfmRates,
  saveMfmRates,
  updateMfmPerson,
  type MfmPerson,
  type PersonKind,
} from "@/lib/more-for-more-settings";

/**
 * A money box that lets you type freely ("7." on the way to "7.5") and only
 * hands back a number — or null for blank, where blank is allowed.
 */
function RateInput({
  value,
  onChange,
  allowBlank,
  label,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  allowBlank?: boolean;
  label: string;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : value == null ? "" : String(value);
  return (
    <div className="relative flex-1 min-w-0">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted pointer-events-none">$</span>
      <input
        aria-label={label}
        inputMode="decimal"
        value={shown}
        placeholder={allowBlank ? "—" : "0"}
        onFocus={() => {
          setText(value == null ? "" : String(value));
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const t = e.target.value.replace(/[^0-9.]/g, "");
          setText(t);
          if (t === "") onChange(allowBlank ? null : 0);
          else if (Number.isFinite(Number(t))) onChange(Number(t));
        }}
        className="w-full rounded-md border border-border bg-surface pl-5 pr-1.5 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </div>
  );
}

function RateRowInputs({ label, row, onChange }: { label: string; row: RateRow; onChange: (r: RateRow) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-[74px] shrink-0 text-xs text-muted">{label}</span>
      {[0, 1, 2].map((t) => (
        <RateInput
          key={t}
          label={`${label} tier ${t + 1}`}
          value={row[t]}
          allowBlank
          onChange={(v) => {
            const next = [...row] as RateRow;
            next[t] = v;
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}

const KIND_LABEL: Record<PersonKind, string> = { lead: "Lead", apprentice: "Apprentice", either: "Either" };

function PersonRow({
  person,
  onSaved,
  onDeleted,
}: {
  person: MfmPerson;
  onSaved: (p: MfmPerson) => void;
  onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState(person.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);

  async function save(patch: Partial<MfmPerson>) {
    const next = { ...person, ...patch };
    if (!next.name.trim()) {
      setName(person.name);
      return;
    }
    setBusy(true);
    setError("");
    try {
      onSaved(await updateMfmPerson(next));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      setName(person.name);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`px-3 py-2.5 space-y-2 ${person.active ? "" : "opacity-60"}`}>
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() !== person.name && save({ name })}
          className="flex-1 min-w-0 rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          aria-label="Name"
        />
        {busy && <Loader2 className="w-4 h-4 animate-spin text-muted shrink-0" />}
        {confirm ? (
          <>
            <button onClick={() => setConfirm(false)} className="text-xs text-muted px-1">
              Keep
            </button>
            <button
              onClick={async () => {
                setBusy(true);
                try {
                  await deleteMfmPerson(person.id);
                  onDeleted(person.id);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Could not delete.");
                  setBusy(false);
                }
              }}
              className="text-xs rounded-md bg-danger text-white px-2 py-1"
            >
              Delete
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirm(true)}
            className="p-1.5 rounded-full text-muted hover:text-danger hover:bg-danger/10 shrink-0"
            aria-label={`Delete ${person.name}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {([1, 2, 3] as Tier[]).map((t) => (
          <button
            key={t}
            onClick={() => save({ tier: person.tier === t ? null : t })}
            className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
              person.tier === t ? "border-rba-green bg-rba-green text-white" : "border-border text-muted"
            }`}
          >
            Tier {t}
          </button>
        ))}
        <select
          value={person.kind}
          onChange={(e) => save({ kind: e.target.value as PersonKind })}
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
          aria-label="Suggested as"
        >
          {(Object.keys(KIND_LABEL) as PersonKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={person.active} onChange={(e) => save({ active: e.target.checked })} />
          Suggest
        </label>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </li>
  );
}

export default function MoreForMoreSettingsPage() {
  const router = useRouter();
  const { roles, user, loading: authLoading } = useAuth();
  const allowed = canProcessMoreForMore(roles);

  const [saved, setSaved] = useState<MfmRates | null>(null);
  const [rates, setRates] = useState<MfmRates>(normalizeRates(DEFAULT_RATES));
  const [people, setPeople] = useState<MfmPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<PersonKind>("either");
  const [newTier, setNewTier] = useState<Tier | null>(null);
  const [adding, setAdding] = useState(false);
  const [peopleError, setPeopleError] = useState("");
  const [peopleQuery, setPeopleQuery] = useState("");

  useEffect(() => {
    if (!allowed) return;
    let live = true;
    Promise.all([fetchMfmRates(), fetchMfmPeople()])
      .then(([r, p]) => {
        if (!live) return;
        setSaved(r);
        setRates(r);
        setPeople(p);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : "Could not load settings."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [allowed]);

  const dirty = useMemo(() => !!saved && JSON.stringify(saved) !== JSON.stringify(normalizeRates(rates)), [saved, rates]);
  const isDefault = JSON.stringify(normalizeRates(rates)) === JSON.stringify(normalizeRates(DEFAULT_RATES));

  function setItem(key: UnitKey, who: "lead" | "apprentice", row: RateRow) {
    setRates((r) => ({ ...r, items: { ...r.items, [key]: { ...r.items[key], [who]: row } } }));
  }

  async function saveRates() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const r = await saveMfmRates(rates, user?.email?.toLowerCase() || "");
      setSaved(r);
      setRates(r);
      refreshMfmSettings();
      setNotice("Saved. New and edited sheets use these rates; finished ones keep theirs.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the rates.");
    } finally {
      setSaving(false);
    }
  }

  async function addPerson() {
    if (!newName.trim()) return;
    setAdding(true);
    setPeopleError("");
    try {
      const p = await addMfmPerson({ name: newName, kind: newKind, tier: newTier, active: true });
      setPeople((prev) => [...prev, p].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName("");
      setNewTier(null);
      refreshMfmSettings();
    } catch (e) {
      setPeopleError(e instanceof Error ? e.message : "Could not add.");
    } finally {
      setAdding(false);
    }
  }

  const shownPeople = people.filter((p) => !peopleQuery.trim() || p.name.toLowerCase().includes(peopleQuery.trim().toLowerCase()));

  if (authLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="space-y-2">
          <ShieldX className="w-12 h-12 text-muted mx-auto" />
          <p className="font-medium">Payroll only</p>
          <p className="text-sm text-muted">More for More settings are for payroll admins and admins.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <header className="bg-background border-b border-border px-3 py-2.5 flex items-center gap-2 z-20">
        <button
          onClick={() => router.push("/time-off?tab=mfm")}
          className="p-1.5 rounded-full hover:bg-surface"
          aria-label="Back to More for More"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold flex-1 truncate">More for More settings</h1>
      </header>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted" />
          </div>
        ) : (
          <div className="max-w-2xl mx-auto w-full px-4 py-4 space-y-8 pb-28">
            {/* ── Rates ── */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <BadgeDollarSign className="w-4 h-4 text-rba-green" />
                <h2 className="text-sm font-semibold flex-1">Bonus rates</h2>
                {!isDefault && (
                  <button
                    onClick={() => setRates(normalizeRates(DEFAULT_RATES))}
                    className="flex items-center gap-1 text-xs text-muted hover:text-foreground"
                    title="Put every rate back to the paper sheet's numbers (not saved until you press Save)"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Paper sheet&apos;s rates
                  </button>
                )}
              </div>
              <p className="text-xs text-muted">
                Per unit, by tier. Leave a box blank to use the tier to its left (like Bay/Bow on the paper
                sheet). Sheets already saved keep the rates they were saved with.
              </p>

              <div className="flex items-center gap-1.5 px-3 text-[11px] font-medium text-muted">
                <span className="w-[74px] shrink-0" />
                <span className="flex-1 text-center">Tier 1</span>
                <span className="flex-1 text-center">Tier 2</span>
                <span className="flex-1 text-center">Tier 3</span>
              </div>
              <div className="space-y-2">
                {UNIT_ITEMS.map((item) => (
                  <div key={item.key} className="rounded-xl border border-border px-3 py-2.5 space-y-1.5">
                    <p className="text-sm font-medium">{item.label}</p>
                    <RateRowInputs
                      label="Lead"
                      row={rates.items[item.key].lead}
                      onChange={(r) => setItem(item.key, "lead", r)}
                    />
                    <RateRowInputs
                      label="Apprentice"
                      row={rates.items[item.key].apprentice}
                      onChange={(r) => setItem(item.key, "apprentice", r)}
                    />
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-border px-3 py-2.5 space-y-2">
                <p className="text-sm font-medium">Additional jobs (per job)</p>
                <div className="flex items-center gap-1.5">
                  <span className="w-[74px] shrink-0 text-xs text-muted">Lead</span>
                  <RateInput
                    label="Additional job, lead"
                    value={rates.additionalJob.lead}
                    onChange={(v) => setRates((r) => ({ ...r, additionalJob: { ...r.additionalJob, lead: v ?? 0 } }))}
                  />
                  <span className="w-[74px] shrink-0 text-xs text-muted text-right pr-1">Apprentice</span>
                  <RateInput
                    label="Additional job, apprentice"
                    value={rates.additionalJob.apprentice}
                    onChange={(v) =>
                      setRates((r) => ({ ...r, additionalJob: { ...r.additionalJob, apprentice: v ?? 0 } }))
                    }
                  />
                </div>
              </div>

              <div className="rounded-xl border border-border px-3 py-2.5 space-y-2">
                <p className="text-sm font-medium">JIP bonus</p>
                {(
                  [
                    ["installRelated", "Install Related"],
                    ["little", "Little JIP"],
                  ] as const
                ).map(([k, label]) => (
                  <div key={k} className="space-y-1">
                    <p className="text-xs text-muted">{label}</p>
                    <div className="flex items-center gap-1.5">
                      <span className="w-[74px] shrink-0 text-xs text-muted">Lead</span>
                      <RateInput
                        label={`${label}, lead`}
                        value={rates.jip[k].lead}
                        onChange={(v) =>
                          setRates((r) => ({ ...r, jip: { ...r.jip, [k]: { ...r.jip[k], lead: v ?? 0 } } }))
                        }
                      />
                      <span className="w-[74px] shrink-0 text-xs text-muted text-right pr-1">Apprentice</span>
                      <RateInput
                        label={`${label}, apprentice`}
                        value={rates.jip[k].apprentice}
                        onChange={(v) =>
                          setRates((r) => ({ ...r, jip: { ...r.jip, [k]: { ...r.jip[k], apprentice: v ?? 0 } } }))
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* ── People ── */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-rba-green" />
                <h2 className="text-sm font-semibold flex-1">People</h2>
                <span className="text-xs text-muted">{people.length}</span>
              </div>
              <p className="text-xs text-muted">
                Suggested as a lead types a name on the form. Tapping a name fills in their tier. Leads can still
                type anyone and pick a tier themselves. &ldquo;Lead&rdquo; and &ldquo;Apprentice&rdquo; decide
                which box suggests them first.
              </p>

              <div className="rounded-xl border border-border p-3 space-y-2">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addPerson()}
                  placeholder="Name"
                  className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  {([1, 2, 3] as Tier[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setNewTier(newTier === t ? null : t)}
                      className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
                        newTier === t ? "border-rba-green bg-rba-green text-white" : "border-border text-muted"
                      }`}
                    >
                      Tier {t}
                    </button>
                  ))}
                  <select
                    value={newKind}
                    onChange={(e) => setNewKind(e.target.value as PersonKind)}
                    className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                    aria-label="Suggested as"
                  >
                    {(Object.keys(KIND_LABEL) as PersonKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={addPerson}
                    disabled={adding || !newName.trim()}
                    className="ml-auto flex items-center gap-1 rounded-md bg-rba-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    Add
                  </button>
                </div>
                {peopleError && <p className="text-xs text-danger">{peopleError}</p>}
              </div>

              {people.length > 8 && (
                <input
                  value={peopleQuery}
                  onChange={(e) => setPeopleQuery(e.target.value)}
                  placeholder="Find a person"
                  className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm"
                />
              )}

              {people.length === 0 ? (
                <p className="text-sm text-muted">Nobody yet. Add the leads and apprentices above.</p>
              ) : (
                <ul className="rounded-xl border border-border divide-y divide-border">
                  {shownPeople.map((p) => (
                    <PersonRow
                      key={p.id}
                      person={p}
                      onSaved={(np) => {
                        setPeople((prev) => prev.map((x) => (x.id === np.id ? np : x)));
                        refreshMfmSettings();
                      }}
                      onDeleted={(id) => {
                        setPeople((prev) => prev.filter((x) => x.id !== id));
                        refreshMfmSettings();
                      }}
                    />
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>

      {/* Rates save bar: only the rates need a Save; people save as you go. */}
      {!loading && (
        <footer className="border-t border-border bg-background px-3 py-2.5 safe-area-bottom">
          <div className="max-w-2xl mx-auto space-y-1.5">
            {error && <p className="text-sm text-danger">{error}</p>}
            {notice && !dirty && (
              <p className="text-xs text-rba-green flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> {notice}
              </p>
            )}
            <div className="flex gap-2">
              {dirty && (
                <button
                  onClick={() => saved && setRates(saved)}
                  disabled={saving}
                  className="flex-1 rounded-lg border border-border py-3 font-semibold"
                >
                  Undo changes
                </button>
              )}
              <button
                onClick={saveRates}
                disabled={saving || !dirty}
                className="flex-[2] rounded-lg bg-rba-green py-3 text-white font-semibold disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : dirty ? "Save rates" : "Rates saved"}
              </button>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
