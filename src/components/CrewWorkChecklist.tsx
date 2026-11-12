"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useBackClose } from "@/hooks/useBackClose";
import { format, parseISO } from "date-fns";
import { AlertTriangle, Check, ChevronDown, ChevronRight, ClipboardList, Loader2, RotateCcw, X } from "lucide-react";
import type { FieldWorkOrder, MaterialUnit } from "@/lib/types";
import { crewSetItemsDone, fetchWriteUpsByIds, type WorkSource } from "@/lib/work-order-store";
import { fetchMaterialJobs } from "@/lib/store";
import { groupWriteUpSections, padSeq, type NumberedWorkItem, type WriteUpSection } from "@/lib/writeup-sections";
import { canCheckOffWriteUps, canUndoAnyCheckOff } from "@/lib/roles";
import { useAuth } from "@/hooks/useAuth";
import WriteUpModal, { type CrewMode, type WriteUpTarget } from "./WriteUpModal";

/**
 * "Work to complete" on a service tile (and the Active Write-Ups page): every
 * open work item from the write-ups at this address, grouped by write-up, each
 * with a checkbox. Tapping one gives the crew three choices:
 *
 *   1. Complete, no issues        → checked off, nothing else.
 *   2. Complete, found more issues → a slimmed-down follow-up write-up opens;
 *                                    the item is checked off once it saves.
 *   3. Not complete               → stays open; the crew says why and can add
 *                                    trim / parts / photos to the same write-up.
 *
 * Every check-off records the account that did it. Finished items collapse
 * into a "Completed" list underneath, where the person who checked one (or a
 * field manager) can undo it. Nothing closes on its own: once every item is
 * done the write-up shows "Ready to close" on the Write-Ups page.
 *
 * The saving goes through two database functions (migration 054), so
 * installers can do this without being able to edit a write-up any other way.
 */

/** One checkbox: a single-unit item, or one unit of a multi-unit item. */
interface CheckRow {
  key: string;
  section: WriteUpSection;
  item: NumberedWorkItem;
  /** The unit this box is for — "Whole job" for a whole-job item. */
  unitLabel: string;
  /** Show the unit after the label (multi-unit items, or a single named unit). */
  showUnit: boolean;
  completed: boolean;
  completedBy?: string;
  completedByName?: string;
  completedAt?: string;
  sources: WorkSource[];
}

function rowsOf(section: WriteUpSection): CheckRow[] {
  const out: CheckRow[] = [];
  for (const item of [...section.outstanding, ...section.completed].sort((a, b) => a.seq - b.seq)) {
    for (const u of item.unitStates) {
      out.push({
        key: `${section.key}|${item.seq}|${u.unitLabel}`,
        section,
        item,
        unitLabel: u.unitLabel,
        showUnit: item.unitStates.length > 1 || u.unitLabel !== "Whole job",
        completed: u.completed,
        completedBy: u.completedBy,
        completedByName: u.completedByName,
        completedAt: u.completedAt,
        sources: u.sources,
      });
    }
  }
  return out;
}

function titleOf(r: CheckRow): string {
  return `Write-up ${r.section.index} · ${padSeq(r.item.seq)} ${r.item.label}${r.showUnit ? ` — ${r.unitLabel}` : ""}`;
}

function shortDate(iso?: string): string {
  if (!iso) return "";
  try {
    return format(parseISO(iso), "M/d/yy");
  } catch {
    return "";
  }
}

export default function CrewWorkChecklist({
  ids,
  onChanged,
  heading = "Work to complete",
}: {
  /** Active write-up row ids at this address (from the calendar's index). */
  ids: string[];
  /** After any change — lets the parent refresh its own copy. */
  onChanged?: () => void;
  heading?: string;
}) {
  const { user, roles } = useAuth();
  const canCheck = canCheckOffWriteUps(roles);
  const canUndoAny = canUndoAnyCheckOff(roles);
  const me = (user?.email || "").toLowerCase();
  const idKey = [...ids].sort().join(",");

  const [rows, setRows] = useState<FieldWorkOrder[] | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [choosing, setChoosing] = useState<CheckRow | null>(null);
  const [undoing, setUndoing] = useState<CheckRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<{
    target: WriteUpTarget;
    units: MaterialUnit[];
    crew: CrewMode;
    /** Follow-up: check the item off once the follow-up has saved. */
    afterSave?: WorkSource[];
  } | null>(null);

  const load = useCallback(async () => {
    if (!idKey) {
      setRows([]);
      return;
    }
    const data = await fetchWriteUpsByIds(idKey.split(","));
    setRows(data);
  }, [idKey]);

  useEffect(() => {
    load();
  }, [load]);

  const sections = useMemo(() => (rows ? groupWriteUpSections(rows) : []), [rows]);
  const all = useMemo(() => sections.map((s) => ({ section: s, rows: rowsOf(s) })), [sections]);
  const openGroups = all
    .map((g) => ({ ...g, rows: g.rows.filter((r) => !r.completed) }))
    .filter((g) => g.rows.length > 0);
  const doneRows = all.flatMap((g) => g.rows.filter((r) => r.completed));

  async function refresh() {
    await load();
    onChanged?.();
  }

  async function setDone(r: CheckRow, done: boolean) {
    setBusy(true);
    setError("");
    const res = await crewSetItemsDone(r.sources, done);
    setBusy(false);
    if (!res.ok) {
      setError(res.error || "Couldn't save — try again.");
      return false;
    }
    await refresh();
    return true;
  }

  /** The row the work item's line sits on — gives its stored number. */
  function storedSeq(r: CheckRow): number | undefined {
    const src = r.sources[0];
    const row = rows?.find((w) => w.id === src?.rowId);
    return row?.lineItems[src.index]?.seq;
  }

  function targetOf(r: CheckRow): WriteUpTarget {
    const first = r.section.rows[0];
    return {
      orderNumber: first.orderNumber,
      workOrderNumber: first.workOrderNumber,
      customerName: first.customerName,
      address: first.address,
      materialJob: null,
    };
  }

  async function openForm(r: CheckRow, kind: CrewMode["kind"]) {
    const target = targetOf(r);
    const crew: CrewMode = {
      kind,
      itemTitle: titleOf(r),
      itemKey: r.key,
      sources: r.sources,
      unitLabel: r.unitLabel === "Whole job" ? null : r.unitLabel,
      workSeq: storedSeq(r),
    };
    setChoosing(null);
    setForm({ target, units: [], crew, afterSave: kind === "followup" ? r.sources : undefined });
    // The job's programmed units, so the follow-up can offer unit chips. Not
    // every job has one on file (or is readable by every role); without it the
    // form still works with "Add unit manually".
    if (kind === "followup") {
      fetchMaterialJobs()
        .then((jobs) => {
          const mat = jobs.get(target.orderNumber);
          const units: MaterialUnit[] = Array.isArray(mat?.units) ? mat.units : [];
          if (units.length) setForm((prev) => (prev && prev.crew.itemKey === r.key ? { ...prev, units } : prev));
        })
        .catch(() => {});
    }
  }

  if (rows === null) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted py-1">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading work to complete…
      </div>
    );
  }
  if (all.every((g) => g.rows.length === 0)) return null;

  const box = (r: CheckRow) => {
    const mine = !!r.completedBy && r.completedBy.toLowerCase() === me;
    const undoable = r.completed && (canUndoAny || mine);
    const clickable = canCheck && (!r.completed || undoable);
    return (
      <button
        type="button"
        disabled={!clickable || busy}
        onClick={() => (r.completed ? setUndoing(r) : setChoosing(r))}
        className={`mt-0.5 w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
          r.completed ? "bg-green-600 border-green-600 text-white" : "border-amber-500/70 text-transparent bg-background"
        } ${clickable ? "active:scale-95" : "opacity-60 cursor-default"}`}
        title={r.completed ? (undoable ? "Undo check-off" : "Checked off") : "Check off"}
        aria-label={r.completed ? `Undo ${titleOf(r)}` : `Check off ${titleOf(r)}`}
      >
        <Check className="w-4 h-4" />
      </button>
    );
  };

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex items-center gap-1.5 mb-2 text-amber-700 dark:text-amber-400">
        <ClipboardList className="w-4 h-4" />
        <span className="text-xs font-bold uppercase tracking-wide">{heading}</span>
      </div>

      {openGroups.length === 0 ? (
        <p className="text-sm text-green-700 font-medium">All work checked off ✓ — waiting for the office to close it.</p>
      ) : (
        <div className="space-y-3">
          {openGroups.map((g) => {
            const first = g.section.rows[0];
            return (
              <div key={g.section.key}>
                <div className="text-[11px] font-semibold text-muted mb-1.5">
                  Write-up {g.section.index}
                  {g.section.createdAt ? ` · ${shortDate(g.section.createdAt)}` : ""}
                  {g.section.createdByName ? ` · ${g.section.createdByName}` : ""}
                  {first?.orderNumber ? ` · PO# ${first.orderNumber}` : ""}
                </div>
                <ul className="space-y-2">
                  {g.rows.map((r) => (
                    <li key={r.key} className="flex items-start gap-2.5">
                      {box(r)}
                      <div className="min-w-0 flex-1 text-[15px] leading-snug">
                        <span className="font-mono text-xs font-bold text-amber-700 mr-1">{padSeq(r.item.seq)}</span>
                        {r.item.label}
                        {r.showUnit && <span className="text-muted"> — {r.unitLabel}</span>}
                        {r.item.notes && <span className="block text-xs text-muted">{r.item.notes}</span>}
                        {r.item.attempts.map((a) => (
                          <span key={`${a.at}|${a.by}`} className="block text-xs text-danger">
                            Not complete · {a.byName || a.by} {shortDate(a.at)} — {a.reason}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {doneRows.length > 0 && (
        <div className="mt-3 pt-2 border-t border-amber-500/20">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="flex items-center gap-1 text-xs font-semibold text-green-700"
          >
            {showDone ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Completed ({doneRows.length})
          </button>
          {showDone && (
            <ul className="mt-2 space-y-2">
              {doneRows.map((r) => (
                <li key={r.key} className="flex items-start gap-2.5">
                  {box(r)}
                  <div className="min-w-0 flex-1 text-sm text-muted">
                    <span className="line-through">
                      W{r.section.index} · {padSeq(r.item.seq)} {r.item.label}
                      {r.showUnit ? ` — ${r.unitLabel}` : ""}
                    </span>
                    <span className="block text-[11px] text-green-700">
                      {r.completedByName ? `Done by ${r.completedByName}` : "Done"}
                      {r.completedAt ? ` · ${shortDate(r.completedAt)}` : ""}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-danger flex items-start gap-1">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {/* The three choices */}
      {choosing && (
        <Sheet onClose={() => !busy && setChoosing(null)} title={titleOf(choosing)}>
          <div className="space-y-2.5">
            <ChoiceButton
              tone="green"
              disabled={busy}
              title="Complete — no issues"
              detail="Checks it off. Nothing else to fill out."
              onClick={async () => {
                if (await setDone(choosing, true)) setChoosing(null);
              }}
            />
            <ChoiceButton
              tone="amber"
              disabled={busy}
              title="Complete — found more issues"
              detail="Checks it off and starts a quick follow-up write-up for what you found."
              onClick={() => openForm(choosing, "followup")}
            />
            <ChoiceButton
              tone="red"
              disabled={busy}
              title="Not complete"
              detail="Stays open. Say why, and add anything it now needs."
              onClick={() => openForm(choosing, "notComplete")}
            />
          </div>
          {busy && (
            <p className="mt-3 text-xs text-muted flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…
            </p>
          )}
          {error && <p className="mt-3 text-xs text-danger">{error}</p>}
        </Sheet>
      )}

      {/* Undo */}
      {undoing && (
        <Sheet onClose={() => !busy && setUndoing(null)} title="Undo this check-off?">
          <p className="text-sm">{titleOf(undoing)}</p>
          <p className="text-xs text-muted mt-1">
            {undoing.completedByName ? `Checked off by ${undoing.completedByName}` : "Checked off"}
            {undoing.completedAt ? ` · ${shortDate(undoing.completedAt)}` : ""}. It goes back on the open list.
          </p>
          <div className="flex gap-2 mt-4">
            <button
              type="button"
              onClick={() => setUndoing(null)}
              disabled={busy}
              className="flex-1 py-3 rounded-xl border border-border text-sm font-medium"
            >
              Keep it
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (await setDone(undoing, false)) setUndoing(null);
              }}
              className="flex-1 py-3 rounded-xl bg-amber-500 text-white text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              Undo
            </button>
          </div>
          {error && <p className="mt-3 text-xs text-danger">{error}</p>}
        </Sheet>
      )}

      {form && (
        <WriteUpModal
          order={form.target}
          units={form.units}
          crew={form.crew}
          onSaved={async () => {
            // A follow-up saved: the item it came from is done.
            if (form.afterSave) await crewSetItemsDone(form.afterSave, true);
            await refresh();
          }}
          onClose={() => {
            setForm(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useBackClose(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-background w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 pb-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 mb-3">
          <p className="text-sm font-semibold leading-snug">{title}</p>
          <button type="button" onClick={onClose} className="p-1 -m-1 text-muted" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const CHOICE_TONE = {
  green: "border-green-600/40 bg-green-600/10 text-green-800 dark:text-green-300",
  amber: "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  red: "border-danger/40 bg-danger/5 text-danger",
} as const;

function ChoiceButton({
  tone,
  title,
  detail,
  disabled,
  onClick,
}: {
  tone: keyof typeof CHOICE_TONE;
  title: string;
  detail: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full text-left rounded-xl border-2 px-4 py-3 active:scale-[0.99] transition-transform disabled:opacity-50 ${CHOICE_TONE[tone]}`}
    >
      <span className="block text-base font-semibold">{title}</span>
      <span className="block text-xs opacity-80 mt-0.5">{detail}</span>
    </button>
  );
}
