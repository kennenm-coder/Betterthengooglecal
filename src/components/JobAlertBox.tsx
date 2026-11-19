"use client";

import { useEffect, useState } from "react";
import { AlarmClock, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { appointmentDate, reminderStatus } from "@/lib/job-alert-dates";
import { deleteJobAlert, saveJobAlert, watchJobAlerts, type JobAlert } from "@/lib/job-alerts-store";
import type { WorkOrder } from "@/lib/types";

/**
 * The Job Alert pop-up's contents (opened from the alarm-clock button on the
 * job card; field managers and admins only — the caller gates it). Shows every
 * note already on the job with who wrote it. Your own notes have Edit and
 * Delete; anyone can Add a new note (a person can keep several). Everyone sees
 * all notes; you can only change your own. The daily cron buzzes every field
 * manager and admin 5 business days before and the business day before.
 * Migrations 064 + 065 + 066.
 */
export default function JobAlertBox({ order }: { order: WorkOrder }) {
  const { user, name } = useAuth();
  const me = (user?.email || "").toLowerCase();
  const appt = appointmentDate(order.scheduledStart);

  const [alerts, setAlerts] = useState<JobAlert[] | null>(null);
  /** null = not editing, "new" = adding, otherwise the id of the note being edited. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => watchJobAlerts(order.id, setAlerts), [order.id]);

  // The buzzes are per job, so any note's record of them speaks for the job.
  const sent5 = (alerts || []).find((a) => a.sent5ForDate === appt)?.sent5ForDate ?? null;
  const sent1 = (alerts || []).find((a) => a.sent1ForDate === appt)?.sent1ForDate ?? null;
  const status = reminderStatus(appt, sent5, sent1);

  function startEdit(id: string, note: string) {
    setDraft(note);
    setError("");
    setConfirmDelete(null);
    setEditing(id);
  }

  async function save() {
    if (!draft.trim()) {
      setError("Type a note first.");
      return;
    }
    setBusy(true);
    setError("");
    const res = await saveJobAlert({
      workOrderId: order.id,
      orderNumber: order.orderNumber,
      note: draft,
      email: me,
      name: name || "",
      id: editing && editing !== "new" ? editing : undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ? `Couldn't save: ${res.error}` : "Couldn't save. Try again.");
      return;
    }
    setEditing(null);
  }

  async function remove(id: string) {
    setBusy(true);
    const ok = await deleteJobAlert(id, order.id);
    setBusy(false);
    setConfirmDelete(null);
    if (!ok) setError("Couldn't delete. Try again.");
  }

  const editor = (
    <div className="space-y-2">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        autoFocus
        placeholder="e.g. Bring the long ladder. Customer has a dog. Confirm the trim came in."
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-base resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/50"
      />
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 text-white disabled:opacity-60"
        >
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Save
        </button>
        <button
          onClick={() => setEditing(null)}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-3">
      <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
        <AlarmClock className="w-3.5 h-3.5" />
        <span className="text-xs font-semibold uppercase tracking-wide flex-1">Job Alert</span>
      </div>

      {alerts === null ? (
        <p className="text-xs text-muted flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading…
        </p>
      ) : (
        <>
          {alerts.length === 0 && editing !== "new" && (
            <p className="text-sm text-muted">No notes on this job yet.</p>
          )}

          {alerts.map((a) => {
            const mine = a.createdBy.toLowerCase() === me;
            return (
              <div key={a.id} className="border-t border-amber-500/20 pt-2 first:border-t-0 first:pt-0">
                <p className="text-[11px] font-semibold text-muted">{mine ? "You" : a.createdByName}</p>
                {editing === a.id ? (
                  editor
                ) : (
                  <>
                    <p className="text-sm whitespace-pre-wrap">{a.note}</p>
                    {mine && (
                      <div className="flex items-center gap-3 mt-1">
                        <button
                          onClick={() => startEdit(a.id, a.note)}
                          className="flex items-center gap-1 text-xs font-medium text-primary"
                        >
                          <Pencil className="w-3 h-3" /> Edit
                        </button>
                        {confirmDelete === a.id ? (
                          <span className="flex items-center gap-2 text-xs">
                            <button onClick={() => remove(a.id)} disabled={busy} className="font-semibold text-danger">
                              Yes, delete
                            </button>
                            <button onClick={() => setConfirmDelete(null)} className="text-muted">
                              Keep
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(a.id)}
                            className="flex items-center gap-1 text-xs font-medium text-danger"
                          >
                            <Trash2 className="w-3 h-3" /> Delete
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}

          {editing === "new" ? (
            <div className="border-t border-amber-500/20 pt-2 first:border-t-0 first:pt-0">{editor}</div>
          ) : (
            <button
              onClick={() => startEdit("new", "")}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-amber-500/50 px-3 py-2 text-sm font-medium text-amber-700 dark:text-amber-400"
            >
              <Plus className="w-4 h-4" /> Add a note
            </button>
          )}

          {error && <p className="text-xs text-danger">{error}</p>}
          <p className="text-[11px] text-muted">{status}</p>
        </>
      )}
    </div>
  );
}
