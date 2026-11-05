"use client";

// The More for More form. One component, two modes:
//   lead   — the install lead on their phone: names, tiers, units, a note.
//            Submitting shows them their total.
//   office — payroll: everything the lead filled (editable), plus deductions,
//            JIP bonus, additional jobs, NPS, Office Only and the final pay.
// Rates and the math live in lib/more-for-more; this file only draws them.

import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  X,
  Minus,
  Plus,
  Loader2,
  Check,
  UserPlus,
  Trash2,
  FileDown,
  FileSpreadsheet,
  Printer,
  Info,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import type { WorkOrder } from "@/lib/types";
import {
  ADDITIONAL_JOB_RATE,
  calcSheet,
  DEDUCTIONS,
  deleteMoreForMore,
  emptyLeadData,
  JIP_BONUS,
  money,
  normalizeLead,
  normalizeOffice,
  rateFor,
  saveOfficeSheet,
  submitLeadSheet,
  suggestQty,
  UNIT_ITEMS,
  type ApprenticeEntry,
  type JobSnapshot,
  type LeadData,
  type MoreForMore,
  type OfficeData,
  type Qty,
  type Tier,
  type UnitKey,
} from "@/lib/more-for-more";

interface Props {
  mode: "lead" | "office";
  job: JobSnapshot;
  /** The work order, when known — used to pre-fill a new sheet's units. */
  order?: WorkOrder | null;
  sheet?: MoreForMore | null;
  onClose: () => void;
  onSaved: (sheet: MoreForMore) => void;
  onDeleted?: (id: string) => void;
}

function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : format(d, "MMM d, yyyy");
}

function TierPicker({ value, onChange }: { value: Tier | null; onChange: (t: Tier) => void }) {
  return (
    <div className="flex gap-1.5">
      {([1, 2, 3] as Tier[]).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
            value === t ? "border-rba-green bg-rba-green text-white" : "border-border bg-surface text-foreground"
          }`}
        >
          Tier {t}
        </button>
      ))}
    </div>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center rounded-lg border border-border bg-surface shrink-0">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, value - 1))}
        className="p-2 text-muted active:scale-95 disabled:opacity-30"
        disabled={value <= 0}
        aria-label="Less"
      >
        <Minus className="w-4 h-4" />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={value || ""}
        placeholder="0"
        onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        className="w-11 bg-transparent text-center text-base font-semibold tabular-nums focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        className="p-2 text-muted active:scale-95"
        aria-label="More"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

function UnitsEditor({
  qty,
  onChange,
  isLead,
  tier,
}: {
  qty: Qty;
  onChange: (q: Qty) => void;
  isLead: boolean;
  tier: Tier | null;
}) {
  return (
    <div className="divide-y divide-border rounded-lg border border-border">
      {UNIT_ITEMS.map((item) => {
        const n = Number(qty[item.key]) || 0;
        const rate = rateFor(item, isLead, tier);
        return (
          <div key={item.key} className="flex items-center gap-2 px-3 py-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium leading-tight">{item.label}</p>
              <p className="text-[11px] text-muted tabular-nums">
                {tier ? `${money(rate)} each` : "pick a tier"}
                {n > 0 && tier ? <span className="text-foreground"> · {money(n * rate)}</span> : null}
              </p>
            </div>
            <Stepper value={n} onChange={(v) => onChange({ ...qty, [item.key as UnitKey]: v })} />
          </div>
        );
      })}
    </div>
  );
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

const inputCls =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary";

export default function MoreForMoreForm({ mode, job, order, sheet, onClose, onSaved, onDeleted }: Props) {
  const { name: myName, user } = useAuth();
  const isOffice = mode === "office";

  const [lead, setLead] = useState<LeadData>(() => {
    if (sheet) return normalizeLead(sheet.lead_data);
    const s = suggestQty(order ?? null);
    return { ...emptyLeadData(myName), leadQty: s.qty, qtySource: s.source };
  });
  const [office, setOffice] = useState<OfficeData>(() => {
    const o = normalizeOffice(sheet?.office_data);
    if (isOffice && !o.dateReceived) {
      o.dateReceived = format(new Date(sheet?.submitted_at || Date.now()), "yyyy-MM-dd");
    }
    return o;
  });
  const [saving, setSaving] = useState<"" | "save" | "complete" | "submit" | "delete">("");
  const [busyFile, setBusyFile] = useState<"" | "pdf" | "xlsx" | "print">("");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState<MoreForMore | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const calc = useMemo(() => calcSheet(lead, isOffice ? office : null), [lead, office, isOffice]);

  function setApp(i: number, patch: Partial<ApprenticeEntry>) {
    setLead((l) => ({
      ...l,
      apprentices: l.apprentices.map((a, j) => (j === i ? { ...a, ...patch } : a)),
    }));
  }

  function removeApp(i: number) {
    setLead((l) => ({ ...l, apprentices: l.apprentices.filter((_, j) => j !== i) }));
    // Keep each remaining person's deductions lined up with them.
    setOffice((o) => {
      const d = [...o.deductions];
      d.splice(i + 1, 1);
      while (d.length < 3) d.push({});
      return { ...o, deductions: d };
    });
  }

  function validate(): string | null {
    if (!lead.leadName.trim()) return "Enter the lead's name.";
    if (!lead.leadTier) return "Pick the lead's tier.";
    for (const [i, a] of lead.apprentices.entries()) {
      if (!a.name.trim()) return `Enter apprentice ${i + 1}'s name, or remove them.`;
      if (!a.tier) return `Pick ${a.name.trim()}'s tier.`;
    }
    const anyUnits = Object.values(lead.leadQty).some((v) => Number(v) > 0);
    if (!anyUnits) return "Enter at least one unit.";
    return null;
  }

  async function handleSubmit() {
    const v = validate();
    if (v) return setError(v);
    setError("");
    setSaving("submit");
    try {
      const saved = await submitLeadSheet({
        id: sheet?.id,
        job,
        lead,
        createdByName: sheet?.created_by_name || myName || user?.email || "",
      });
      setSubmitted(saved);
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit.");
    } finally {
      setSaving("");
    }
  }

  async function handleOffice(complete: boolean) {
    if (!sheet) return;
    const v = validate();
    if (v) return setError(v);
    setError("");
    setSaving(complete ? "complete" : "save");
    try {
      const saved = await saveOfficeSheet({
        sheet,
        lead,
        office,
        complete,
        byEmail: user?.email?.toLowerCase() || "",
        byName: myName,
      });
      onSaved(saved);
      if (complete || sheet.status === "completed") onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving("");
    }
  }

  async function handleDelete() {
    if (!sheet) return;
    setSaving("delete");
    try {
      await deleteMoreForMore(sheet.id);
      onDeleted?.(sheet.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete.");
      setSaving("");
    }
  }

  /** Downloads reflect what is on screen, saved or not. */
  function currentRecord(): MoreForMore | null {
    if (!sheet) return null;
    return { ...sheet, lead_data: lead, office_data: office };
  }

  async function handleFile(kind: "pdf" | "xlsx" | "print") {
    const rec = currentRecord();
    if (!rec) return;
    setBusyFile(kind);
    try {
      const ex = await import("@/lib/more-for-more-export");
      if (kind === "pdf") await ex.downloadSheetPdf(rec);
      else if (kind === "xlsx") await ex.downloadSheetXlsx(rec);
      else await ex.printSheetPdf(rec);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the file.");
    } finally {
      setBusyFile("");
    }
  }

  // ── After a lead submits: show them what they sent ──
  if (submitted) {
    const done = calcSheet(submitted.lead_data);
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <div className="flex-1 overflow-auto px-4 py-8">
          <div className="max-w-md mx-auto text-center space-y-4">
            <CheckCircle2 className="w-14 h-14 text-rba-green mx-auto" />
            <div>
              <h2 className="text-xl font-semibold">{sheet ? "Resubmitted" : "Submitted"}</h2>
              <p className="text-sm text-muted mt-1">
                {submitted.job_name} · #{submitted.order_number}
              </p>
              <p className="text-sm text-muted">Payroll will finish it from here.</p>
            </div>
            <div className="rounded-xl border border-border divide-y divide-border text-left">
              {done.people.map((p, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{p.name || (i === 0 ? "Lead" : `Apprentice ${i}`)}</p>
                    <p className="text-[11px] text-muted">
                      {i === 0 ? "Lead" : "Apprentice"} · Tier {p.tier}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{money(p.subtotal)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between px-4 py-3 bg-surface">
                <span className="text-sm font-semibold">Total submitted</span>
                <span className="text-lg font-bold tabular-nums text-rba-green">{money(done.leadTotal)}</span>
              </div>
            </div>
            <p className="text-[11px] text-muted">
              Before deductions, additional jobs and JIP bonus, which payroll adds.
            </p>
          </div>
        </div>
        <div className="border-t border-border p-3 safe-area-bottom">
          <button
            onClick={onClose}
            className="w-full max-w-md mx-auto block rounded-lg bg-rba-green py-3 text-white font-semibold"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  const people = calc.people;
  const wasCompleted = sheet?.status === "completed";

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <header className="border-b border-border px-3 py-2.5 flex items-center gap-2">
        <button onClick={onClose} className="p-1.5 rounded-full hover:bg-surface" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold leading-tight truncate">More for More</h2>
          <p className="text-xs text-muted truncate">
            {job.job_name || "Job"} · #{job.order_number}
          </p>
        </div>
        {isOffice && sheet && (
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => handleFile("pdf")}
              className="p-2 rounded-full hover:bg-surface text-muted"
              title="Download PDF"
              disabled={!!busyFile}
            >
              {busyFile === "pdf" ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <FileDown className="w-4.5 h-4.5" />}
            </button>
            <button
              onClick={() => handleFile("xlsx")}
              className="p-2 rounded-full hover:bg-surface text-muted"
              title="Download Excel (the bonus sheet, filled in)"
              disabled={!!busyFile}
            >
              {busyFile === "xlsx" ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <FileSpreadsheet className="w-4.5 h-4.5" />}
            </button>
            <button
              onClick={() => handleFile("print")}
              className="p-2 rounded-full hover:bg-surface text-muted hidden sm:block"
              title="Print"
              disabled={!!busyFile}
            >
              {busyFile === "print" ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <Printer className="w-4.5 h-4.5" />}
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto w-full px-4 py-4 space-y-6">
          {/* Job */}
          <div className="rounded-xl border border-border bg-surface px-4 py-3 text-sm space-y-0.5">
            <p className="font-semibold">{job.job_name || "—"}</p>
            <p className="text-muted">
              Job #{job.order_number}
              {job.install_date ? ` · ${fmtDay(job.install_date)}` : ""}
              {job.crew_name ? ` · ${job.crew_name}` : ""}
            </p>
            {job.address && <p className="text-muted truncate">{job.address}</p>}
            {sheet && (
              <p className="text-[11px] text-muted pt-1">
                Submitted by {sheet.created_by_name || sheet.created_by} {fmtDay(sheet.submitted_at)}
                {sheet.submit_count > 1 ? ` · resubmitted ${sheet.submit_count - 1}×` : ""}
                {wasCompleted && sheet.completed_at ? ` · completed ${fmtDay(sheet.completed_at)}` : ""}
              </p>
            )}
          </div>

          {!isOffice && wasCompleted && (
            <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <RotateCcw className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Payroll already finished this one. Resubmitting sends it back to them to check again.</span>
            </div>
          )}

          {/* Lead */}
          <Section title="Lead">
            <input
              className={inputCls}
              value={lead.leadName}
              onChange={(e) => setLead({ ...lead, leadName: e.target.value })}
              placeholder="Lead name"
              autoComplete="name"
            />
            <TierPicker value={lead.leadTier} onChange={(t) => setLead({ ...lead, leadTier: t })} />
          </Section>

          <Section title="Units installed">
            {lead.qtySource && !sheet && (
              <div className="flex gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {lead.qtySource === "material-list"
                    ? "Filled in from this job's material list. Check every line before you submit."
                    : "Rough start from rForce's counts (every window as an insert, every patio door as a glider). Fix anything that's off."}
                </span>
              </div>
            )}
            <UnitsEditor
              qty={lead.leadQty}
              onChange={(q) => setLead({ ...lead, leadQty: q })}
              isLead
              tier={lead.leadTier}
            />
          </Section>

          {/* Apprentices */}
          <Section
            title="Apprentices"
            right={
              lead.apprentices.length < 2 ? (
                <button
                  type="button"
                  onClick={() =>
                    setLead({
                      ...lead,
                      apprentices: [...lead.apprentices, { name: "", tier: null, sameAsLead: true, qty: {} }],
                    })
                  }
                  className="flex items-center gap-1 text-xs font-medium text-rba-green"
                >
                  <UserPlus className="w-3.5 h-3.5" /> Add apprentice
                </button>
              ) : null
            }
          >
            {lead.apprentices.length === 0 && (
              <p className="text-sm text-muted">No apprentice on this job.</p>
            )}
            {lead.apprentices.map((a, i) => (
              <div key={i} className="rounded-xl border border-border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    className={inputCls}
                    value={a.name}
                    onChange={(e) => setApp(i, { name: e.target.value })}
                    placeholder={`Apprentice ${i + 1} name`}
                  />
                  <button
                    type="button"
                    onClick={() => removeApp(i)}
                    className="p-2 rounded-full text-muted hover:text-danger hover:bg-danger/10"
                    aria-label="Remove apprentice"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <TierPicker value={a.tier} onChange={(t) => setApp(i, { tier: t })} />
                <label className="flex items-center gap-2 text-sm py-1">
                  <input
                    type="checkbox"
                    checked={a.sameAsLead}
                    onChange={(e) =>
                      setApp(i, {
                        sameAsLead: e.target.checked,
                        qty: e.target.checked ? a.qty : { ...lead.leadQty },
                      })
                    }
                    className="w-4 h-4 accent-[var(--color-rba-green,#15803d)]"
                  />
                  Did the same units as the lead
                </label>
                {!a.sameAsLead && (
                  <UnitsEditor qty={a.qty} onChange={(q) => setApp(i, { qty: q })} isLead={false} tier={a.tier} />
                )}
                <p className="text-xs text-muted text-right tabular-nums">
                  Subtotal {money(people[i + 1]?.subtotal)}
                </p>
              </div>
            ))}
          </Section>

          <Section title={isOffice ? "Installer note" : "Notes"}>
            <textarea
              className={`${inputCls} min-h-[80px]`}
              value={lead.installerNote}
              onChange={(e) => setLead({ ...lead, installerNote: e.target.value })}
              placeholder="Anything payroll should know (optional)"
            />
          </Section>

          {/* What the lead is submitting */}
          <div className="rounded-xl border border-border divide-y divide-border">
            {people.map((p, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2">
                <span className="text-sm truncate">
                  {p.name || (i === 0 ? "Lead" : `Apprentice ${i}`)}
                  <span className="text-muted"> · {i === 0 ? "Lead" : "Apprentice"}{p.tier ? ` T${p.tier}` : ""}</span>
                </span>
                <span className="text-sm font-medium tabular-nums">{money(p.subtotal)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-4 py-2.5 bg-surface">
              <span className="text-sm font-semibold">{isOffice ? "Submitted total" : "Your total"}</span>
              <span className="text-base font-bold tabular-nums">{money(calc.leadTotal)}</span>
            </div>
          </div>

          {/* ── Office ── */}
          {isOffice && (
            <>
              <div className="border-t-2 border-rba-green pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-rba-green">Office</p>
              </div>

              <Section title="NPS score">
                <input
                  className={inputCls}
                  inputMode="numeric"
                  value={office.nps}
                  onChange={(e) => setOffice({ ...office, nps: e.target.value })}
                  placeholder="Optional"
                />
              </Section>

              <Section title="Deductions">
                {people.map((p, i) => {
                  const ded = office.deductions[i] || {};
                  const setPct = (key: string, pct: number | null) => {
                    const next = [...office.deductions];
                    const mine = { ...(next[i] || {}) };
                    if (!pct) delete mine[key];
                    else mine[key] = pct;
                    next[i] = mine;
                    setOffice({ ...office, deductions: next });
                  };
                  return (
                    <div key={i} className="rounded-xl border border-border">
                      <div className="flex items-center justify-between px-3 py-2 bg-surface rounded-t-xl">
                        <span className="text-sm font-medium truncate">
                          {p.name || (i === 0 ? "Lead" : `Apprentice ${i}`)}
                        </span>
                        <span className={`text-xs tabular-nums ${p.deductionPct ? "text-danger font-semibold" : "text-muted"}`}>
                          {p.deductionPct}% · −{money(p.deductionAmt)}
                        </span>
                      </div>
                      <div className="divide-y divide-border">
                        {DEDUCTIONS.map((d) => {
                          const val = Number(ded[d.key]) || 0;
                          return (
                            <div key={d.key} className="flex items-center gap-2 px-3 py-1.5">
                              <button
                                type="button"
                                onClick={() => setPct(d.key, val ? null : d.pct ?? 0)}
                                className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${
                                  val ? "bg-danger border-danger text-white" : "border-border"
                                }`}
                                aria-label={d.label}
                              >
                                {val ? <Check className="w-3.5 h-3.5" /> : null}
                              </button>
                              <span className="flex-1 min-w-0 text-sm leading-tight">
                                {d.label}
                                <span className="text-muted text-xs"> {d.hint || (d.pct != null ? `${d.pct}%` : "")}</span>
                              </span>
                              <div className="flex items-center gap-0.5 shrink-0">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  max={100}
                                  value={val || ""}
                                  placeholder="0"
                                  onChange={(e) =>
                                    setPct(d.key, Math.min(100, Math.max(0, Number(e.target.value) || 0)))
                                  }
                                  className="w-14 rounded-md border border-border bg-surface px-1.5 py-1 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-primary"
                                />
                                <span className="text-xs text-muted">%</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </Section>

              <Section
                title="Additional jobs"
                right={
                  <button
                    type="button"
                    onClick={() => setOffice({ ...office, additionalJobs: [...office.additionalJobs, ""] })}
                    className="flex items-center gap-1 text-xs font-medium text-rba-green"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add job
                  </button>
                }
              >
                <p className="text-[11px] text-muted">
                  {money(ADDITIONAL_JOB_RATE.lead)} lead · {money(ADDITIONAL_JOB_RATE.apprentice)} each apprentice, per job.
                </p>
                {office.additionalJobs.map((j, k) => (
                  <div key={k} className="flex items-center gap-2">
                    <input
                      className={inputCls}
                      value={j}
                      onChange={(e) => {
                        const next = [...office.additionalJobs];
                        next[k] = e.target.value;
                        setOffice({ ...office, additionalJobs: next });
                      }}
                      placeholder="Job name"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setOffice({ ...office, additionalJobs: office.additionalJobs.filter((_, x) => x !== k) })
                      }
                      className="p-2 rounded-full text-muted hover:text-danger hover:bg-danger/10"
                      aria-label="Remove job"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </Section>

              <Section title="JIP bonus">
                <div className="rounded-xl border border-border divide-y divide-border">
                  {(
                    [
                      ["jipInstallRelated", "Install Related", JIP_BONUS.installRelated],
                      ["jipLittle", "Little JIP", JIP_BONUS.little],
                    ] as const
                  ).map(([key, label, amt]) => (
                    <label key={key} className="flex items-center gap-3 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={office[key]}
                        onChange={(e) => setOffice({ ...office, [key]: e.target.checked })}
                        className="w-4 h-4"
                      />
                      <span className="flex-1 text-sm">{label}</span>
                      <span className="text-xs text-muted tabular-nums">
                        Lead {money(amt.lead)} · App {money(amt.apprentice)}
                      </span>
                    </label>
                  ))}
                </div>
              </Section>

              <Section title="Office only">
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="text-xs text-muted">Date received</span>
                    <input
                      type="date"
                      className={inputCls}
                      value={office.dateReceived}
                      onChange={(e) => setOffice({ ...office, dateReceived: e.target.value })}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-muted">Payroll date</span>
                    <input
                      type="date"
                      className={inputCls}
                      value={office.payrollDate}
                      onChange={(e) => setOffice({ ...office, payrollDate: e.target.value })}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={office.entered8020}
                      onChange={(e) => setOffice({ ...office, entered8020: e.target.checked })}
                      className="w-4 h-4"
                    />
                    80/20 entered
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={office.reviewedWithLead}
                      onChange={(e) => setOffice({ ...office, reviewedWithLead: e.target.checked })}
                      className="w-4 h-4"
                    />
                    Job reviewed with lead
                  </label>
                </div>
              </Section>

              <Section title="Office note">
                <textarea
                  className={`${inputCls} min-h-[70px]`}
                  value={office.officeNote}
                  onChange={(e) => setOffice({ ...office, officeNote: e.target.value })}
                  placeholder="Goes in Additional Notes on the sheet, under the installer's note"
                />
              </Section>

              {/* Final pay */}
              <div className="rounded-xl border-2 border-rba-green overflow-hidden">
                <div className="px-4 py-2 bg-rba-green/10 text-xs font-semibold uppercase tracking-wide text-rba-green">
                  Final pay
                </div>
                <div className="divide-y divide-border">
                  {people.map((p, i) => (
                    <div key={i} className="px-4 py-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium truncate">{p.name || (i === 0 ? "Lead" : `Apprentice ${i}`)}</span>
                        <span className="font-bold tabular-nums">{money(p.pay)}</span>
                      </div>
                      <p className="text-[11px] text-muted tabular-nums">
                        {money(p.subtotal)}
                        {p.deductionAmt ? ` − ${money(p.deductionAmt)} (${p.deductionPct}%)` : ""}
                        {p.additionalJobs ? ` + ${money(p.additionalJobs)} jobs` : ""}
                        {p.jip ? ` + ${money(p.jip)} JIP` : ""}
                      </p>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-4 py-2.5 bg-surface">
                    <span className="text-sm font-semibold">Total pay</span>
                    <span className="text-lg font-bold tabular-nums text-rba-green">{money(calc.finalTotal)}</span>
                  </div>
                </div>
              </div>

              {sheet && (
                <div className="pt-2">
                  {confirmDelete ? (
                    <div className="flex items-center gap-2 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2">
                      <span className="flex-1 text-sm">Delete this More for More for good?</span>
                      <button onClick={() => setConfirmDelete(false)} className="text-sm px-2 py-1 text-muted">
                        Cancel
                      </button>
                      <button
                        onClick={handleDelete}
                        disabled={!!saving}
                        className="text-sm px-3 py-1 rounded-md bg-danger text-white font-medium"
                      >
                        {saving === "delete" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      className="flex items-center gap-1.5 text-xs text-muted hover:text-danger"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete this sheet
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          <div className="h-2" />
        </div>
      </div>

      <footer className="border-t border-border bg-background px-3 py-2.5 safe-area-bottom">
        <div className="max-w-2xl mx-auto space-y-2">
          {error && <p className="text-sm text-danger">{error}</p>}
          {isOffice ? (
            <div className="flex gap-2">
              {wasCompleted ? (
                <button
                  onClick={() => handleOffice(false)}
                  disabled={!!saving}
                  className="flex-1 rounded-lg bg-rba-green py-3 text-white font-semibold disabled:opacity-60"
                >
                  {saving === "save" ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Save changes"}
                </button>
              ) : (
                <>
                  <button
                    onClick={() => handleOffice(false)}
                    disabled={!!saving}
                    className="flex-1 rounded-lg border border-border py-3 font-semibold disabled:opacity-60"
                  >
                    {saving === "save" ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Save"}
                  </button>
                  <button
                    onClick={() => handleOffice(true)}
                    disabled={!!saving}
                    className="flex-[2] rounded-lg bg-rba-green py-3 text-white font-semibold disabled:opacity-60"
                  >
                    {saving === "complete" ? (
                      <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                    ) : (
                      `Complete · ${money(calc.finalTotal)}`
                    )}
                  </button>
                </>
              )}
            </div>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!!saving}
              className="w-full rounded-lg bg-rba-green py-3 text-white font-semibold disabled:opacity-60"
            >
              {saving === "submit" ? (
                <Loader2 className="w-5 h-5 animate-spin mx-auto" />
              ) : (
                `${sheet ? "Resubmit" : "Submit"} · ${money(calc.leadTotal)}`
              )}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
