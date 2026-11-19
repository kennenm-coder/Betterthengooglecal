"use client";

import { useEffect, useState } from "react";
import { AlarmClock, Loader2, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { appointmentDate, reminderStatus } from "@/lib/job-alert-dates";
import { deleteJobAlert, fetchJobAlerts, saveJobAlert, type JobAlert } from "@/lib/job-alerts-store";
import type { WorkOrder } from "@/lib/types";

/**
 * Job Alert — above Install Notes on the job card, field managers and admins
 * only (the caller gates it). Leave a note on the appointment; the daily cron
 * buzzes EVERY field manager and admin (phone + bell, no email) 5 business
 * days before and again the business day before, one buzz per job listing
 * every note with who wrote it. Everyone sees all notes; you change only your
 * own. Migrations 064 + 065.
 */
export default function JobAlertBox({ order }: { order: WorkOrder }) {
  const { user, name } = useAuth();
  const me = (user?.email || "").toLowerCase();
  const appt = appointmentDate(order.scheduledStart);

  const [alerts, setAlerts] = useState<JobAlert[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchJobAlerts(order.id).then((rows) => {
      if (!cancelled) setAlerts(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [order.id]);

  const mine = alerts?.find((a) => a.createdBy.toLowerCase() === me) || null;
  const others = (alerts || []).filter((a) => a.createdBy.toLowerCase() !== me);
  // The buzzes are per job, so any note's record of them speaks for the job.
  const sent5 = (alerts || []).find((a) => a.sent5ForDate === appt)?.sent5ForDate ?? null;
  const sent1 = (alerts || []).find((a) => a.sent1ForDate === appt)?.sent1ForDate ?? null;
  const status = reminderStatus(appt, sent5, sent1);

  function startEdit() {
    setDraft(mine?.note || "");
    setError("");
    setEditing(true);
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
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ? `Couldn't save: ${res.error}` : "Couldn't save. Try again.");
      return;
    }
    setEditing(false);
    setAlerts(await fetchJobAlerts(order.id));
  }

  async function remove() {
    if (!mine) return;
    setBusy(true);
    const ok = await deleteJobAlert(mine.id);
    setBusy(false);
    if (!ok) {
      setError("Couldn't delete. Try again.");
      return;
    }
    setEditing(false);
    setAlerts((prev) => (prev || []).filter((a) => a.id !== mine.id));
  }

  return (
    <div className="mt-3 pt-3 border-t border-border">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
          <AlarmClock className="w-3.5 h-3.5" />
          <span className="text-xs font-semibold uppercase tracking-wide flex-1">Job Alert</span>
          {mine && !editing && (
            <button onClick={startEdit} className="p-1 rounded text-muted hover:text-foreground" aria-label="Edit my job alert">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {alerts === null ? (
          <p className="text-xs text-muted flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading…
          </p>
        ) : editing ? (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              autoFocus
              placeholder="e.g. Bring the long ladder. Customer has a dog. Confirm the trim came in."
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-base resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/50"
            />
            <p className="text-[11px] text-muted">{status}</p>
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
                onClick={() => setEditing(false)}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border"
              >
                Cancel
              </button>
              {mine && (
                <button
                  onClick={remove}
                  disabled={busy}
                  className="ml-auto flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-danger"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              )}
            </div>
          </div>
        ) : mine ? (
          <div>
            <p className="text-[11px] font-semibold text-muted">You</p>
            <p className="text-sm whitespace-pre-wrap">{mine.note}</p>
          </div>
        ) : (
          <button
            onClick={startEdit}
            className="w-full text-left text-sm text-muted hover:text-foreground rounded-lg border border-dashed border-border px-3 py-2"
          >
            + Add a note. All field managers get a buzz 5 business days before and the day before.
          </button>
        )}

        {error && <p className="text-xs text-danger">{error}</p>}

        {others.map((a) => (
          <div key={a.id} className="pt-2 border-t border-amber-500/20">
            <p className="text-[11px] font-semibold text-muted">{a.createdByName}</p>
            <p className="text-sm whitespace-pre-wrap">{a.note}</p>
          </div>
        ))}

        {!editing && (alerts?.length ?? 0) > 0 && <p className="text-[11px] text-muted">{status}</p>}
      </div>
    </div>
  );
}
